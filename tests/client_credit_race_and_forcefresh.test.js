/**
 * tests/client_credit_race_and_forcefresh.test.js
 * 
 * Verifies:
 * 1. Delayed /api/credits read cannot overwrite newer authoritative balance committed by generation.
 * 2. window.checkCreditBalance({ forceFresh: true }) supersedes in-flight coalesced reads.
 * 3. /api/credits failure results in error state with zero Supabase direct fallback.
 * 4. Static source audit: checkCreditBalance strictly uses /api/credits with zero direct profiles queries.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('\n============================================================');
console.log('🧪 RUNNING CLIENT CREDIT RACE & FORCEFRESH TEST SUITE');
console.log('============================================================\n');

function setupTestEnvironment(customFetch) {
    const elements = new Map();
    const eventListeners = new Map();

    class MockClassList {
        constructor(initial = []) {
            this.classes = new Set(initial);
        }
        add(...cls) { cls.forEach(c => this.classes.add(c)); }
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); }
        toggle(cls, force) {
            if (force === true) this.classes.add(cls);
            else if (force === false) this.classes.delete(cls);
            else if (this.classes.has(cls)) this.classes.delete(cls);
            else this.classes.add(cls);
        }
        contains(cls) { return this.classes.has(cls); }
    }

    class MockElement {
        constructor(id, tag = 'div', initialClasses = []) {
            this.id = id;
            this.tagName = tag.toUpperCase();
            this.classList = new MockClassList(initialClasses);
            this.children = [];
            this.parentNode = null;
            this.value = '';
            this.disabled = false;
            this.checked = true;
            this.textContent = '';
            this.innerHTML = '';
            this.style = {};
            this._listeners = new Map();
        }
        setAttribute(name, val) { this[name] = val; }
        getAttribute(name) { return this[name] || null; }
        removeAttribute(name) { delete this[name]; }
        addEventListener(event, fn) {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push(fn);
        }
        removeEventListener(event, fn) {}
        dispatchEvent(event) {
            const list = this._listeners.get(event.type) || [];
            list.forEach(fn => fn(event));
        }
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        querySelectorAll() { return []; }
        querySelector() { return null; }
        closest() { return null; }
        getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
    }

    function getOrCreate(id, tag = 'div', initialClasses = []) {
        if (!elements.has(id)) {
            elements.set(id, new MockElement(id, tag, initialClasses));
        }
        return elements.get(id);
    }

    getOrCreate('desktopCreditCount', 'span');
    getOrCreate('mobileCreditCount', 'span');
    getOrCreate('hudScoreBadge', 'span');
    getOrCreate('runAnalysisBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    getOrCreate('generateIcebreakerBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    getOrCreate('runAuditBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    getOrCreate('privacyConsent', 'input');
    getOrCreate('termsCheckbox', 'input');
    getOrCreate('toastContainer', 'div');

    let supabaseQueryCount = 0;
    const mockSupabaseClient = {
        auth: {
            getSession: async () => ({
                data: {
                    session: {
                        user: { id: 'usr_race_test_123', email: 'race_test@mywingmanapp.com' },
                        access_token: 'test_token_abc'
                    }
                },
                error: null
            })
        },
        from: (table) => {
            supabaseQueryCount++;
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: { credits: 999 }, error: null })
                    })
                })
            };
        }
    };

    const mockSession = {
        user: { id: 'usr_race_test_123', email: 'race_test@mywingmanapp.com' },
        access_token: 'test_token_abc'
    };

    const toasts = [];
    const windowMock = {
        currentSupabaseUser: mockSession.user,
        currentSupabaseSession: mockSession,
        supabaseClient: mockSupabaseClient,
        showToast: (msg, type) => toasts.push({ msg, type }),
        showNotification: (title, msg, type) => toasts.push({ title, msg, type }),
        getSupabaseAuthHeaders: async () => ({ 'Authorization': 'Bearer ' + mockSession.access_token }),
        openPurchaseModal: () => {},
        openAuthRequiredModal: () => {},
        addEventListener: (event, fn) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(fn);
        },
        removeEventListener: () => {},
        _toasts: toasts,
        getSupabaseQueryCount: () => supabaseQueryCount
    };

    const documentMock = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => new MockElement('dyn_' + Math.random().toString(36).substr(2, 5), tag),
        body: new MockElement('body', 'body'),
        addEventListener: () => {},
        removeEventListener: () => {},
        activeElement: null,
        readyState: 'complete'
    };

    const storageMap = new Map();
    const mockStorage = {
        getItem: (k) => storageMap.get(k) || null,
        setItem: (k, v) => storageMap.set(k, String(v)),
        removeItem: (k) => storageMap.delete(k),
        clear: () => storageMap.clear()
    };

    const sandbox = {
        window: windowMock,
        document: documentMock,
        FileReader: class { readAsDataURL() {} },
        Image: class { constructor() { this.naturalWidth = 100; this.naturalHeight = 100; } set src(v) {} },
        AbortController: AbortController,
        localStorage: mockStorage,
        sessionStorage: mockStorage,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
        Array: Array,
        Set: Set,
        Map: Map,
        Math: Math,
        JSON: JSON,
        Object: Object,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Date: Date,
        RegExp: RegExp,
        Error: Error,
        parseInt: parseInt,
        isNaN: isNaN,
        fetch: customFetch
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = documentMock;
    sandbox.window.localStorage = mockStorage;
    sandbox.window.sessionStorage = mockStorage;
    sandbox.window.fetch = customFetch;
    sandbox.global = sandbox;

    const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(appJsCode, sandbox);

    return { sandbox, elements, mockSupabaseClient, getSupabaseQueryCount: () => supabaseQueryCount };
}

async function runTests() {
    let passed = 0;

    // Test 1: Delayed read cannot overwrite newer authoritative balance committed by generation
    console.log('Test 1: Delayed /api/credits read cannot overwrite newer authoritative balance committed by generation');
    {
        let resolveDelayedRead;
        const delayedReadPromise = new Promise(resolve => {
            resolveDelayedRead = resolve;
        });

        let fetchCallCount = 0;
        const mockFetch = async (url) => {
            fetchCallCount++;
            if (url.includes('/api/credits')) {
                // Wait until manually resolved
                await delayedReadPromise;
                return {
                    ok: true,
                    json: async () => ({ success: true, credits: 50 })
                };
            }
            return { ok: true, json: async () => ({ success: true }) };
        };

        const env = setupTestEnvironment(mockFetch);
        const { window } = env.sandbox;

        // Start delayed balance read A (resolves with stale 50)
        const readAPromise = window.checkCreditBalance();

        // While read A is in-flight, an authoritative AI generation completes with remaining balance 40
        const committed = window.commitAuthoritativeCreditBalance(40);
        assert.strictEqual(committed, 40, 'commitAuthoritativeCreditBalance must return committed amount');

        // Verify UI immediately shows 40 Credits
        const deskEl = env.elements.get('desktopCreditCount');
        assert.strictEqual(deskEl.textContent, '40 Credits', 'UI desktop count should show "40 Credits"');

        // Now delayed read A finishes with old balance 50
        resolveDelayedRead();
        const readAResult = await readAPromise;

        // Verify read A returned stale status
        assert.strictEqual(readAResult.status, 'stale', 'Superseded read must return status "stale"');
        assert.strictEqual(readAResult.credits, 40, 'Stale result must retain current committed balance 40');

        // Verify UI desktop count was NOT reverted to 50
        assert.strictEqual(deskEl.textContent, '40 Credits', 'UI desktop count MUST remain "40 Credits"');

        console.log('  ✓ Stale delayed read (50) was properly discarded, authoritative balance (40) preserved.');
        passed++;
    }

    // Test 2: checkCreditBalance({ forceFresh: true }) supersedes in-flight coalesced reads
    console.log('Test 2: checkCreditBalance({ forceFresh: true }) supersedes in-flight coalesced reads');
    {
        let resolveP1Fetch;
        const p1FetchPromise = new Promise(resolve => {
            resolveP1Fetch = resolve;
        });
        let p1FetchStarted;
        const p1StartedPromise = new Promise(resolve => {
            p1FetchStarted = resolve;
        });

        let callCount = 0;
        const mockFetch = async (url) => {
            callCount++;
            const currentCall = callCount;
            if (currentCall === 1) {
                p1FetchStarted();
                await p1FetchPromise;
                return { ok: true, json: async () => ({ success: true, credits: 100 }) };
            }
            return { ok: true, json: async () => ({ success: true, credits: 250 }) };
        };

        const env = setupTestEnvironment(mockFetch);
        const { window } = env.sandbox;

        // Call 1: Initiates in-flight read
        const p1 = window.checkCreditBalance();
        // Call 2: Normal call coalesces into p1
        const p2 = window.checkCreditBalance();
        assert.strictEqual(p1, p2, 'Normal checkCreditBalance should return coalesced promise');

        // Wait until p1's fetch is actively in flight across the network
        await p1StartedPromise;

        // Call 3: { forceFresh: true } forces a new network fetch and new syncSeq
        const p3 = window.checkCreditBalance({ forceFresh: true });
        assert.notStrictEqual(p1, p3, 'forceFresh: true must return a distinct fresh promise');

        // p3 resolves with 250 immediately
        const freshRes = await p3;
        assert.strictEqual(freshRes.status, 'loaded', 'forceFresh call should have loaded status');
        assert.strictEqual(freshRes.credits, 250, 'forceFresh call should return fresh balance 250');

        const deskEl = env.elements.get('desktopCreditCount');
        assert.strictEqual(deskEl.textContent, '250 Credits', 'UI should show 250 Credits');

        // Now first call finally resolves with older 100
        resolveP1Fetch();
        const staleRes = await p1;

        // p1 returned stale status and UI did NOT revert to 100
        assert.strictEqual(staleRes.status, 'stale', 'Older coalesced read must be marked stale');
        assert.strictEqual(deskEl.textContent, '250 Credits', 'UI must remain 250 Credits after older p1 resolves');

        console.log('  ✓ forceFresh: true successfully bypassed coalescing and prevented sequence regression.');
        passed++;
    }

    // Test 3: /api/credits failure results in error state with zero Supabase direct fallback
    console.log('Test 3: /api/credits failure results in error state with ZERO Supabase fallback');
    {
        const mockFetch = async () => {
            return { ok: false, status: 500, json: async () => ({ success: false, error: 'Internal Server Error' }) };
        };

        const env = setupTestEnvironment(mockFetch);
        const { window } = env.sandbox;

        const result = await window.checkCreditBalance({ forceFresh: true });
        assert.strictEqual(result.success, false, 'checkCreditBalance must return success: false on failure');
        assert.strictEqual(result.status, 'error', 'status should be error');

        // Verify zero direct Supabase queries were attempted
        const sbQueryCount = env.getSupabaseQueryCount();
        assert.strictEqual(sbQueryCount, 0, `ZERO direct Supabase queries allowed, got ${sbQueryCount}`);

        // Verify UI entered error state ('Balance unavailable')
        const deskEl = env.elements.get('desktopCreditCount');
        assert.strictEqual(deskEl.textContent, 'Balance unavailable', 'UI should display "Balance unavailable"');

        console.log('  ✓ /api/credits failure entered error state safely with 0 direct Supabase queries.');
        passed++;
    }

    // Test 4: Static source audit: app.js contains NO direct supabaseClient.from('profiles') in checkCreditBalance
    console.log('Test 4: Static audit verifies zero direct profiles queries in checkCreditBalance');
    {
        const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
        const checkBalanceFnMatch = appCode.match(/window\.checkCreditBalance\s*=\s*function[\s\S]*?(?=\n\s*(?:window\.updateUICredits|window\.commitAuthoritativeCreditBalance|window\.deductUserCreditBalance))/);
        assert.ok(checkBalanceFnMatch, 'Could not locate window.checkCreditBalance function in app.js');

        const fnBody = checkBalanceFnMatch[0];
        assert.strictEqual(fnBody.includes("from('profiles')"), false, 'checkCreditBalance must not query profiles table');
        assert.strictEqual(fnBody.includes('fetchProfileCredits'), false, 'checkCreditBalance must not call fetchProfileCredits');
        assert.ok(fnBody.includes('/api/credits'), 'checkCreditBalance must use /api/credits');
        assert.ok(fnBody.includes('forceFresh'), 'checkCreditBalance must handle forceFresh option');

        console.log('  ✓ Static audit passed: checkCreditBalance strictly uses /api/credits.');
        passed++;
    }

    console.log(`\n============================================================`);
    console.log(`🏁 CLIENT CREDIT RACE & FORCEFRESH: ${passed}/4 PASSED`);
    console.log(`============================================================\n`);
}

runTests().catch(err => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});
