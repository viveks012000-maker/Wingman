/**
 * Tests: Authoritative Supabase Auth & Multi-State Credit Balance Runtime
 * Executes actual application handlers from app.js in a full simulated DOM/runtime environment.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('\n============================================================');
console.log('🧪 RUNNING CREDIT BALANCE & AUTH RUNTIME TESTS');
console.log('============================================================\n');

function setupRuntimeEnvironment(options = {}) {
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
            this.checked = false;
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
        removeEventListener(event, fn) {
            if (this._listeners.has(event)) {
                this._listeners.set(event, this._listeners.get(event).filter(f => f !== fn));
            }
        }
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

    const runAnalysisBtn = getOrCreate('runAnalysisBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    runAnalysisBtn.disabled = true;
    const generateIcebreakerBtn = getOrCreate('generateIcebreakerBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    const runAuditBtn = getOrCreate('runAuditBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    const desktopCreditCount = getOrCreate('desktopCreditCount', 'span');
    const mobileCreditCount = getOrCreate('mobileCreditCount', 'span');
    const hudScoreBadge = getOrCreate('hudScoreBadge', 'span');
    const toastContainer = getOrCreate('toastContainer', 'div');
    const privacyConsent = getOrCreate('privacyConsent', 'input');
    privacyConsent.checked = true;

    const toasts = [];
    let purchaseModalOpenCount = 0;
    let authModalOpenCount = 0;

    let mockSession = options.initialSession !== undefined ? options.initialSession : {
        user: { id: 'test-user-id-300', email: 'test@mywingman.com' },
        access_token: 'valid-test-access-token'
    };

    let getSessionDelay = options.getSessionDelay || 0;

    const mockSupabaseClient = {
        auth: {
            getSession: async () => {
                if (getSessionDelay > 0) {
                    await new Promise(r => setTimeout(r, getSessionDelay));
                }
                if (!mockSession) {
                    return { data: { session: null }, error: null };
                }
                return { data: { session: mockSession }, error: null };
            }
        },
        from: (table) => ({
            select: (cols) => ({
                eq: (col, val) => ({
                    maybeSingle: async () => {
                        if (options.dbProfileError) {
                            return { data: null, error: new Error('DB connection failed') };
                        }
                        if (options.dbProfileMissing) {
                            return { data: null, error: null };
                        }
                        if (options.dbCredits !== undefined) {
                            return { data: { credits: options.dbCredits }, error: null };
                        }
                        return { data: { credits: 300 }, error: null };
                    }
                })
            })
        })
    };

    const windowMock = {
        currentSupabaseUser: mockSession ? mockSession.user : null,
        currentSupabaseSession: mockSession,
        supabaseClient: mockSupabaseClient,
        showToast(msg, type) { toasts.push({ msg, type }); },
        showNotification(title, msg, type) { toasts.push({ title, msg, type }); },
        getSupabaseAuthHeaders: async () => (mockSession && mockSession.access_token ? { 'Authorization': 'Bearer ' + mockSession.access_token } : {}),
        openPurchaseModal: () => { purchaseModalOpenCount++; },
        openAuthRequiredModal: () => { authModalOpenCount++; },
        addEventListener: (event, fn) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(fn);
        },
        removeEventListener: (event, fn) => {},
        _toasts: toasts,
        get purchaseModalOpenCount() { return purchaseModalOpenCount; },
        get authModalOpenCount() { return authModalOpenCount; },
        setSession: (s) => {
            mockSession = s;
            windowMock.currentSupabaseSession = s;
            windowMock.currentSupabaseUser = s ? s.user : null;
        }
    };

    const documentMock = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => new MockElement('dyn_' + Math.random().toString(36).substr(2, 5), tag),
        body: new MockElement('body', 'body'),
        addEventListener: (event, fn) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(fn);
        },
        removeEventListener: (event, fn) => {},
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
    if (options.initialStorage) {
        Object.entries(options.initialStorage).forEach(([k, v]) => mockStorage.setItem(k, v));
    }

    let currentFetch = options.fetchHandler || (async () => ({ ok: true, json: async () => ({ success: true }) }));

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
        fetch: (...args) => currentFetch(...args)
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = documentMock;
    sandbox.window.localStorage = mockStorage;
    sandbox.window.sessionStorage = mockStorage;
    sandbox.window.fetch = (...args) => currentFetch(...args);
    sandbox.global = sandbox;

    const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(appJsCode, sandbox);

    const origShowToast = sandbox.window.showToast;
    sandbox.window.showToast = function(msg, type, append) {
        toasts.push({ msg, type });
        if (typeof origShowToast === 'function') origShowToast(msg, type, append);
    };

    const origOpenPurchase = sandbox.window.openPurchaseModal;
    sandbox.window.openPurchaseModal = function() {
        purchaseModalOpenCount++;
        if (typeof origOpenPurchase === 'function') origOpenPurchase();
    };

    const origOpenAuth = sandbox.window.openAuthRequiredModal;
    sandbox.window.openAuthRequiredModal = function() {
        authModalOpenCount++;
        if (typeof origOpenAuth === 'function') origOpenAuth();
    };

    return {
        sandbox,
        elements,
        windowMock,
        mockStorage,
        setFetch: (fn) => { currentFetch = fn; },
        setDbCredits: (c) => { options.dbCredits = c; }
    };
}

(async function runAllCreditAndAuthTests() {
    // -------------------------------------------------------------------------
    // TEST 1: The Real 300-Credit Live Profile Scenario
    // -------------------------------------------------------------------------
    console.log('▶ [TEST 1] Real 300-Credit Profile Scenario');
    const env1 = setupRuntimeEnvironment({
        initialStorage: { 'wingman_authenticated': 'true' }, // Persistent local flag exists
        dbCredits: 300
    });

    // Check initial state
    assert.strictEqual(env1.sandbox.window.state.credits, null, 'Initial state.credits must be null (unknown), NOT 0');
    assert.strictEqual(env1.sandbox.window.state.creditsStatus, 'idle', 'Initial state.creditsStatus must be idle');

    // User triggers checkCreditBalance
    const balanceResult = await env1.sandbox.window.checkCreditBalance();
    assert.strictEqual(balanceResult.success, true);
    assert.strictEqual(balanceResult.credits, 300);
    assert.strictEqual(env1.sandbox.window.state.credits, 300, 'state.credits must resolve to 300');
    assert.strictEqual(env1.sandbox.window.state.creditsStatus, 'loaded');

    // Test hasSufficientCredits(10) for Analyzer
    const hasEnough = await env1.sandbox.window.hasSufficientCredits(10);
    assert.strictEqual(hasEnough, true, 'hasSufficientCredits(10) must return true for 300 balance');
    assert.strictEqual(env1.windowMock.purchaseModalOpenCount, 0, 'Purchase modal MUST NOT open for 300 credits');
    console.log('✔ Test 1 Passed: 300-credit balance resolves cleanly, passes 10-credit pre-check without purchase modal');

    // -------------------------------------------------------------------------
    // TEST 2: Session Restoration Race / Delayed Session Retrieval
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 2] Session Restoration Race / Delayed Supabase getSession');
    const env2 = setupRuntimeEnvironment({
        initialSession: { user: { id: 'delayed-user' }, access_token: 'delayed-token' },
        getSessionDelay: 20, // 20ms async delay in getSession
        dbCredits: 300
    });
    // Wipe window.currentSupabaseUser initially to simulate pending async restoration
    env2.sandbox.window.currentSupabaseUser = null;
    env2.sandbox.window.currentSupabaseSession = null;

    // Call hasSufficientCredits(10) directly while session is restoring
    const raceResult = await env2.sandbox.window.hasSufficientCredits(10);
    assert.strictEqual(raceResult, true, 'hasSufficientCredits must await authoritative session and return true');
    assert.strictEqual(env2.sandbox.window.state.credits, 300, 'state.credits resolved to 300');
    assert.strictEqual(env2.windowMock.purchaseModalOpenCount, 0, 'Purchase modal MUST NOT open during session restoration');
    console.log('✔ Test 2 Passed: Session restoration race resolved authoritatively without false 0 or purchase modal');

    // -------------------------------------------------------------------------
    // TEST 3: Credit Fetch Network / DB Failure (Unknown/Error is NOT Zero)
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 3] Credit Fetch Failure (Error is NOT Zero)');
    const env3 = setupRuntimeEnvironment({
        dbProfileError: true // DB fails
    });
    // Set fetch fallback to also fail
    env3.setFetch(async () => ({ ok: false, status: 500 }));

    const failResult = await env3.sandbox.window.checkCreditBalance();
    assert.strictEqual(failResult.success, false);
    assert.strictEqual(env3.sandbox.window.state.credits, null, 'state.credits must remain null, NOT converted to 0');
    assert.strictEqual(env3.sandbox.window.state.creditsStatus, 'error');

    const preCheckFail = await env3.sandbox.window.hasSufficientCredits(10);
    assert.strictEqual(preCheckFail, false, 'hasSufficientCredits must return false on sync error');
    assert.strictEqual(env3.windowMock.purchaseModalOpenCount, 0, 'Purchase modal MUST NOT open on credit sync error');

    const lastToast = env3.windowMock._toasts[env3.windowMock._toasts.length - 1];
    assert.strictEqual(lastToast && lastToast.msg.includes('Unable to verify credit balance'), true, 'Must display sync error toast');
    console.log('✔ Test 3 Passed: Credit fetch failure reports sync error and NEVER opens purchase modal');

    // -------------------------------------------------------------------------
    // TEST 4: Genuine Zero Credits Profile
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 4] Genuine Zero Balance Profile (credits = 0)');
    const env4 = setupRuntimeEnvironment({
        dbCredits: 0
    });

    const zeroCheck = await env4.sandbox.window.hasSufficientCredits(10);
    assert.strictEqual(zeroCheck, false);
    assert.strictEqual(env4.sandbox.window.state.credits, 0, 'state.credits confirmed as 0');
    assert.strictEqual(env4.windowMock.purchaseModalOpenCount, 1, 'Purchase modal MUST open when confirmed balance is 0');
    console.log('✔ Test 4 Passed: Confirmed 0 balance correctly opens purchase modal');

    // -------------------------------------------------------------------------
    // TEST 5: Threshold Tests (300, 10, 9, 2, 1, 0)
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 5] Threshold Balance Verification');
    // Balance = 9
    const env9 = setupRuntimeEnvironment({ dbCredits: 9 });
    assert.strictEqual(await env9.sandbox.window.hasSufficientCredits(10), false, 'Balance 9: 10-cost feature must fail');
    assert.strictEqual(env9.windowMock.purchaseModalOpenCount, 1, 'Balance 9: opens purchase modal for 10-cost');
    assert.strictEqual(await env9.sandbox.window.hasSufficientCredits(2), true, 'Balance 9: 2-cost feature (Practice) must PASS');
    console.log('✔ Balance = 9: Analyzer/Icebreaker/Bio fail (open purchase modal), Practice PASSES');

    // Balance = 10
    const env10 = setupRuntimeEnvironment({ dbCredits: 10 });
    assert.strictEqual(await env10.sandbox.window.hasSufficientCredits(10), true, 'Balance 10: 10-cost feature passes');
    assert.strictEqual(await env10.sandbox.window.hasSufficientCredits(2), true, 'Balance 10: 2-cost feature passes');
    assert.strictEqual(env10.windowMock.purchaseModalOpenCount, 0, 'Balance 10: purchase modal never opens');
    console.log('✔ Balance = 10: All 4 features pass without purchase modal');

    // Balance = 2
    const env2b = setupRuntimeEnvironment({ dbCredits: 2 });
    assert.strictEqual(await env2b.sandbox.window.hasSufficientCredits(2), true, 'Balance 2: 2-cost practice passes');
    assert.strictEqual(await env2b.sandbox.window.hasSufficientCredits(10), false, 'Balance 2: 10-cost feature fails');
    console.log('✔ Balance = 2: Practice passes, 10-credit features fail');

    // Balance = 1
    const env1b = setupRuntimeEnvironment({ dbCredits: 1 });
    assert.strictEqual(await env1b.sandbox.window.hasSufficientCredits(2), false, 'Balance 1: 2-cost practice fails');
    assert.strictEqual(await env1b.sandbox.window.hasSufficientCredits(10), false, 'Balance 1: 10-cost feature fails');
    console.log('✔ Balance = 1: All features fail and open purchase modal');

    // -------------------------------------------------------------------------
    // TEST 6: /api/credits Parsing Integrity ({ credits: 300, data: { credits_inr: 30 } })
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 6] /api/credits JSON Parsing Integrity');
    const envApi = setupRuntimeEnvironment();
    // Simulate Supabase direct query unavailable so it falls back to /api/credits
    envApi.sandbox.window.supabaseClient = null;
    envApi.setFetch(async (url) => {
        if (typeof url === 'string' && url.includes('/api/credits')) {
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    credits: 300,
                    data: { credits_inr: 30 }
                })
            };
        }
        return { ok: true, json: async () => ({}) };
    });

    const apiSync = await envApi.sandbox.window.checkCreditBalance();
    assert.strictEqual(apiSync.success, true);
    assert.strictEqual(apiSync.credits, 300, 'Must parse top-level credits = 300');
    assert.strictEqual(envApi.sandbox.window.state.credits, 300, 'state.credits must be 300, NOT 30 or 0');
    console.log('✔ Test 6 Passed: /api/credits parses top-level credits = 300 (never 30 or 0)');

    // -------------------------------------------------------------------------
    // TEST 7: Persisted Flag Alone Does NOT Authenticate
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 7] Persisted Flag Alone Does NOT Authenticate');
    const envUnauth = setupRuntimeEnvironment({
        initialStorage: { 'wingman_authenticated': 'true', 'wingman_user_authenticated': 'true' },
        initialSession: null // No active Supabase session
    });
    envUnauth.sandbox.window.currentSupabaseUser = null;
    envUnauth.sandbox.window.currentSupabaseSession = null;

    const isAuth = await envUnauth.sandbox.window.isUserAuthenticated();
    assert.strictEqual(isAuth, false, 'isUserAuthenticated must return false when no real Supabase session exists');

    const authPreCheck = await envUnauth.sandbox.window.hasSufficientCredits(10);
    assert.strictEqual(authPreCheck, false);
    assert.strictEqual(envUnauth.windowMock.purchaseModalOpenCount, 0, 'Unauthenticated user MUST NOT see purchase modal');
    assert.strictEqual(envUnauth.windowMock.authModalOpenCount, 1, 'Unauthenticated user MUST see auth modal');
    console.log('✔ Test 7 Passed: Persisted flags alone do not authenticate; auth modal opens, purchase modal does not');

    // -------------------------------------------------------------------------
    // TEST 8: Auth User Exists, Profile Missing -> Explicit PROFILE_MISSING
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 8] Existing Auth User with Missing Profile');
    const envMissing = setupRuntimeEnvironment({
        dbProfileMissing: true
    });
    // Configure fetch fallback for /api/credits to return 404 PROFILE_MISSING
    envMissing.setFetch(async (url) => {
        if (typeof url === 'string' && url.includes('/api/credits')) {
            return {
                ok: false,
                status: 404,
                json: async () => ({ success: false, error: 'PROFILE_MISSING', code: 'PROFILE_MISSING' })
            };
        }
        return { ok: true, json: async () => ({}) };
    });

    const missingResult = await envMissing.sandbox.window.checkCreditBalance();
    assert.strictEqual(missingResult.success, false);
    assert.strictEqual(missingResult.status, 'missing_profile');
    assert.strictEqual(missingResult.code, 'PROFILE_MISSING');
    assert.strictEqual(envMissing.sandbox.window.state.credits, null, 'state.credits must NOT become confirmed zero');
    assert.strictEqual(envMissing.sandbox.window.state.creditsStatus, 'missing_profile');

    const missingPreCheck = await envMissing.sandbox.window.hasSufficientCredits(10);
    assert.strictEqual(missingPreCheck, false, 'Pre-check must fail for missing profile');
    assert.strictEqual(envMissing.windowMock.purchaseModalOpenCount, 0, 'Purchase modal MUST NOT open for missing profile');

    const missingToast = envMissing.windowMock._toasts[envMissing.windowMock._toasts.length - 1];
    assert.strictEqual(missingToast && missingToast.msg.includes('account profile could not be loaded'), true, 'Must show account profile load error toast');
    console.log('✔ Test 8 Passed: Missing profile produces PROFILE_MISSING, state.credits remains null, zero purchase modals');

    // -------------------------------------------------------------------------
    // TEST 9: Error State Distinctions
    // -------------------------------------------------------------------------
    console.log('\n▶ [TEST 9] Clear Distinction Across All Error States');
    // 1. Session unauthenticated/loading -> status 'unauthenticated' / 'idle', credits null
    assert.strictEqual(envUnauth.sandbox.window.state.credits, null);
    // 2. Network/query error -> status 'error', credits null
    assert.strictEqual(env3.sandbox.window.state.creditsStatus, 'error');
    assert.strictEqual(env3.sandbox.window.state.credits, null);
    // 3. Genuine zero -> status 'loaded', credits 0
    assert.strictEqual(env4.sandbox.window.state.creditsStatus, 'loaded');
    assert.strictEqual(env4.sandbox.window.state.credits, 0);
    // 4. Missing profile -> status 'missing_profile', credits null
    assert.strictEqual(envMissing.sandbox.window.state.creditsStatus, 'missing_profile');
    assert.strictEqual(envMissing.sandbox.window.state.credits, null);
    console.log('✔ Test 9 Passed: Session loading, network error, genuine zero, and missing profile are strictly distinguished');

    console.log('\n🎉 ALL CREDIT BALANCE & AUTH RUNTIME TESTS PASSED!\n');
})();
