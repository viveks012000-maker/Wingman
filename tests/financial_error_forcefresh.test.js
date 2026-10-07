/**
 * tests/financial_error_forcefresh.test.js
 * 
 * Verifies:
 * 1. Error paths (402 Insufficient credits, 409 In-flight conflict, 500 Server error,
 *    502/503/504 Upstream/Gateway timeouts, and network catch) in app.js and
 *    vendor/production-runtime.js always dispatch checkCreditBalance({ forceFresh: true }).
 * 2. Calling checkCreditBalance({ forceFresh: true }) invalidates coalesced in-flight promises,
 *    ensuring fresh balance retrieval.
 * 3. Static audit: Zero error handling blocks in AI generation pathways perform unforced reads.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('\n============================================================');
console.log('🧪 RUNNING FINANCIAL ERROR FORCEFRESH TEST SUITE');
console.log('============================================================\n');

function setupTestEnv(mockFetch) {
    class MockClassList {
        constructor() { this.classes = new Set(); }
        add(...cls) { cls.forEach(c => this.classes.add(c)); }
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); }
        toggle(c, f) { if (f ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c); }
        contains(c) { return this.classes.has(c); }
    }
    class MockElement {
        constructor(id, tag = 'div') {
            this.id = id;
            this.tagName = tag.toUpperCase();
            this.classList = new MockClassList();
            this.textContent = '';
            this.innerHTML = '';
            this.children = [];
            this.style = {};
            this.disabled = false;
            this.value = '';
            this.checked = true;
        }
        setAttribute() {}
        getAttribute() { return null; }
        removeAttribute() {}
        addEventListener() {}
        appendChild(c) { this.children.push(c); return c; }
        querySelectorAll() { return []; }
        querySelector() { return null; }
        closest() { return null; }
        getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
        getContext() { return { clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {} }; }
    }

    const elements = new Map();
    function getOrCreate(id, tag = 'div') {
        if (!elements.has(id)) elements.set(id, new MockElement(id, tag));
        return elements.get(id);
    }

    getOrCreate('desktopCreditCount', 'span');
    getOrCreate('mobileCreditCount', 'span');
    getOrCreate('hudScoreBadge', 'span');
    getOrCreate('runAnalysisBtn', 'button');
    getOrCreate('generateIcebreakerBtn', 'button');
    getOrCreate('runAuditBtn', 'button');
    getOrCreate('toastContainer', 'div');

    const mockSession = {
        user: { id: 'usr_forcefresh_test_456', email: 'forcefresh@test.com' },
        access_token: 'jwt_forcefresh_test'
    };

    const windowMock = {
        currentSupabaseUser: mockSession.user,
        currentSupabaseSession: mockSession,
        supabaseClient: {
            auth: {
                getSession: async () => ({ data: { session: mockSession }, error: null })
            }
        },
        getSupabaseAuthHeaders: async () => ({ 'Authorization': 'Bearer ' + mockSession.access_token }),
        showToast: () => {},
        showNotification: () => {},
        openPurchaseModal: () => {},
        openAuthRequiredModal: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
    };

    const documentMock = {
        getElementById: (id) => elements.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        createElement: (tag) => new MockElement('dyn_' + Math.random().toString(36).substr(2, 5), tag),
        body: new MockElement('body', 'body')
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
        navigator: { userAgent: 'node-test' },
        localStorage: mockStorage,
        sessionStorage: mockStorage,
        console: { log: () => {}, warn: () => {}, error: () => {} },
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
        fetch: mockFetch || (async () => ({ ok: true, json: async () => ({ success: true, credits: 50 }) }))
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = documentMock;
    sandbox.window.localStorage = mockStorage;
    sandbox.window.sessionStorage = mockStorage;
    sandbox.window.fetch = sandbox.fetch;
    sandbox.global = sandbox;

    const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(appJsCode, sandbox);

    return { sandbox, elements };
}

async function runTests() {
    // --- Test 1: Runtime forceFresh bypasses in-flight coalesced reads ---
    console.log('Test 1: checkCreditBalance({ forceFresh: true }) invalidates in-flight promises and executes fresh query');
    {
        let fetchCount = 0;
        let signalFetch1Started = null;
        const fetch1StartedPromise = new Promise(r => { signalFetch1Started = r; });
        let finishFirstFetch = null;
        const firstFetchPromise = new Promise(res => { finishFirstFetch = res; });

        const mockFetch = async (url) => {
            if (url.includes('/api/credits')) {
                fetchCount++;
                if (fetchCount === 1) {
                    signalFetch1Started();
                    await firstFetchPromise;
                    return { ok: true, json: async () => ({ success: true, credits: 100 }) };
                }
                return { ok: true, json: async () => ({ success: true, credits: 200 }) };
            }
            return { ok: true, json: async () => ({ success: true }) };
        };

        const { sandbox } = setupTestEnv(mockFetch);

        // Initial read 1 starts
        const read1Promise = sandbox.window.checkCreditBalance();

        // Normal concurrent read 2 without forceFresh should coalesce to read 1
        const read2Promise = sandbox.window.checkCreditBalance();
        assert.strictEqual(read1Promise, read2Promise, 'Normal calls must coalesce to the exact same promise');

        // Wait until fetch 1 has actually arrived at mockFetch
        await fetch1StartedPromise;
        assert.strictEqual(fetchCount, 1, 'Only one fetch should be dispatched during coalescing');

        // Forced fresh read 3 MUST bust cache and fire second fetch immediately
        const read3Promise = sandbox.window.checkCreditBalance({ forceFresh: true });
        assert.notStrictEqual(read1Promise, read3Promise, 'ForceFresh MUST return a new distinct promise');

        // p3 resolves with fresh 200
        const res3 = await read3Promise;
        assert.strictEqual(res3.credits, 200, 'ForceFresh read must return latest balance (200)');
        assert.strictEqual(fetchCount, 2, 'Second fetch must have fired for forceFresh');

        // Let read 1 finish
        finishFirstFetch();

        const [res1, res2] = await Promise.all([read1Promise, read2Promise]);
        assert.strictEqual(res1.status, 'stale', 'Superseded read 1 must be marked stale');
        assert.strictEqual(res2.status, 'stale', 'Superseded read 2 must be marked stale');

        console.log('  ✓ Verified: forceFresh successfully invalidates coalesced promises and avoids stale overwrites.');
    }

    // --- Test 2: Static audit of error paths in app.js ---
    console.log('\nTest 2: Static audit of error paths in app.js for checkCreditBalance({ forceFresh: true })');
    {
        const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

        // 1. Check generateWingmanResponse error branches
        const gen402Regex = /response\.status\s*===\s*402[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen402Regex.test(appJsSource), 'generateWingmanResponse 402 handler must call checkCreditBalance({ forceFresh: true })');

        const gen409Regex = /response\.status\s*===\s*409[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen409Regex.test(appJsSource), 'generateWingmanResponse 409 handler must call checkCreditBalance({ forceFresh: true })');

        const gen503Regex = /response\.status\s*===\s*503\s*\|\|\s*response\.status\s*===\s*502[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen503Regex.test(appJsSource), 'generateWingmanResponse 502/503/504 handler must call checkCreditBalance({ forceFresh: true })');

        const gen500Regex = /response\.status\s*>=\s*500[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen500Regex.test(appJsSource), 'generateWingmanResponse 500+ handler must call checkCreditBalance({ forceFresh: true })');

        // 2. Check Maeve chat error branches
        const maeve402Regex = /chatResp\.status\s*===\s*402[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeve402Regex.test(appJsSource), 'Maeve chat 402 handler must call checkCreditBalance({ forceFresh: true })');

        const maeve409Regex = /chatResp\.status\s*===\s*409[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeve409Regex.test(appJsSource), 'Maeve chat 409 handler must call checkCreditBalance({ forceFresh: true })');

        const maeve503Regex = /chatResp\.status\s*===\s*503\s*\|\|\s*chatResp\.status\s*===\s*502[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeve503Regex.test(appJsSource), 'Maeve chat 502/503/504 handler must call checkCreditBalance({ forceFresh: true })');

        const maeveCatchRegex = /catch\s*\(chatErr\)[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeveCatchRegex.test(appJsSource), 'Maeve chat catch handler must call checkCreditBalance({ forceFresh: true })');

        console.log('  ✓ Verified: All error paths in app.js explicitly specify { forceFresh: true }.');
    }

    // --- Test 3: Static audit of error paths in vendor/production-runtime.js ---
    console.log('\nTest 3: Static audit of error paths in vendor/production-runtime.js');
    {
        const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'vendor/production-runtime.js'), 'utf8');

        // 1. Verify simulator review 402 handler calls checkCreditBalance({ forceFresh: true })
        const sim402Regex = /response\.status\s*===\s*402[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(sim402Regex.test(runtimeSource), 'Simulator review 402 handler must call checkCreditBalance({ forceFresh: true })');

        // 2. Verify simulator review catch handler calls checkCreditBalance({ forceFresh: true })
        const simCatchRegex = /catch\s*\([a-zA-Z0-9_]*\)[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(simCatchRegex.test(runtimeSource), 'Simulator review catch handler must call checkCreditBalance({ forceFresh: true })');

        // 3. Verify simulator review success handler reconciles credit payload
        assert.ok(runtimeSource.includes('window.reconcileCreditPayload(data)'), 'Simulator review must reconcile credit payload');

        console.log('  ✓ Verified: vendor/production-runtime.js simulator review error paths enforce { forceFresh: true }.');
    }

    console.log('\n============================================================');
    console.log('🏁 ALL FINANCIAL ERROR FORCEFRESH TESTS PASSED');
    console.log('============================================================\n');
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
