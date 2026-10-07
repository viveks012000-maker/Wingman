/**
 * tests/cached_replay_credit_freshness.test.js
 * 
 * Verifies:
 * 1. cacheCompletedAiResponse sanitizes cached wallet state to { credits: null, creditsVerified: false }.
 * 2. Idempotency replays never expose stale reservation-time or cached balances.
 * 3. Client window.reconcileCreditPayload ignores unverified/null credits from cached replays,
 *    marks status as loading, and triggers checkCreditBalance({ forceFresh: true }).
 * 4. Authoritative balance cannot be reverted by replayed responses.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('\n============================================================');
console.log('🧪 RUNNING CACHED REPLAY CREDIT FRESHNESS TEST SUITE');
console.log('============================================================\n');

// 1. Load Server Module & Test cacheCompletedAiResponse
const server = require('../server.js');
const {
    cacheCompletedAiResponse,
    getCompletedAiResponse,
    completedAiResponses
} = server;

// --- Test 1: cacheCompletedAiResponse sanitizes wallet state ---
console.log('Test 1: cacheCompletedAiResponse sanitizes wallet state to { credits: null, creditsVerified: false }');
{
    const testKey = 'test_idempotency_key_freshness_' + Date.now();
    const originalPayload = {
        credits: 240,
        creditsVerified: true,
        suggestions: ['Hey there!', 'Nice to meet you'],
        analysis: 'Profile looks good'
    };

    cacheCompletedAiResponse(testKey, 200, originalPayload);
    const cachedEntry = getCompletedAiResponse(testKey);

    assert.ok(cachedEntry, 'Expected cached entry to exist');
    assert.strictEqual(cachedEntry.statusCode, 200);
    assert.strictEqual(cachedEntry.data.credits, null, 'Cached credits MUST be sanitized to null');
    assert.strictEqual(cachedEntry.data.creditsVerified, false, 'Cached creditsVerified MUST be sanitized to false');
    assert.deepStrictEqual(cachedEntry.data.suggestions, originalPayload.suggestions, 'Non-credit payload fields must be preserved');
    assert.strictEqual(cachedEntry.data.analysis, originalPayload.analysis, 'Non-credit payload fields must be preserved');

    // Clean up
    completedAiResponses.delete(testKey);
    console.log('  ✓ Verified: Cached payload strips financial balance and sets creditsVerified: false.');
}

// Helper to create client test environment
function setupClientEnv(customFetch) {
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
        user: { id: 'usr_replay_test_999', email: 'replay@test.com' },
        access_token: 'replay_jwt_test'
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

    const fetchHandler = customFetch || (async (url) => {
        if (url.includes('/api/credits')) {
            return { ok: true, json: async () => ({ success: true, credits: 300 }) };
        }
        return { ok: true, json: async () => ({ success: true }) };
    });

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
        fetch: fetchHandler
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = documentMock;
    sandbox.window.localStorage = mockStorage;
    sandbox.window.sessionStorage = mockStorage;
    sandbox.window.fetch = fetchHandler;
    sandbox.global = sandbox;

    const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(appJsCode, sandbox);

    return { sandbox, elements };
}

// --- Test 2: Client environment reconciliation with cached replay payload ---
console.log('\nTest 2: Client reconcileCreditPayload handles unverified cached replay payload safely');
{
    const { sandbox, elements } = setupClientEnv();

    assert.strictEqual(typeof sandbox.window.commitAuthoritativeCreditBalance, 'function');
    assert.strictEqual(typeof sandbox.window.reconcileCreditPayload, 'function');
    assert.strictEqual(typeof sandbox.window.checkCreditBalance, 'function');

    // Instrument checkCreditBalance to monitor calls
    const checkCreditBalanceCalls = [];
    const originalCheck = sandbox.window.checkCreditBalance;
    sandbox.window.checkCreditBalance = function (opts) {
        checkCreditBalanceCalls.push(opts);
        return originalCheck.apply(this, arguments);
    };

    // Commit initial balance
    const committed = sandbox.window.commitAuthoritativeCreditBalance(300);
    assert.strictEqual(committed, 300, 'Authoritative balance committed should be 300');
    assert.strictEqual(elements.get('desktopCreditCount').textContent, '300 Credits');

    // Simulate arrival of an idempotency cached replay payload
    // Replay payload has data, but credits: null, creditsVerified: false
    const replayPayload = {
        suggestions: ['Replayed suggestion 1', 'Replayed suggestion 2'],
        credits: null,
        creditsVerified: false
    };

    checkCreditBalanceCalls.length = 0;
    sandbox.window.reconcileCreditPayload(replayPayload);

    // Assert: UI immediately switches to Syncing… and forceFresh checkCreditBalance is dispatched
    assert.strictEqual(checkCreditBalanceCalls.length, 1, 'checkCreditBalance must be triggered');
    assert.strictEqual(checkCreditBalanceCalls[0]?.forceFresh, true, 'checkCreditBalance must be called with { forceFresh: true }');
    assert.strictEqual(elements.get('desktopCreditCount').textContent, 'Syncing…', 'UI must show Syncing… while fetching authoritative balance');

    console.log('  ✓ Verified: Cached replay payload does not overwrite authoritative balance and triggers forceFresh check.');
}

// --- Test 3: Stale numerical balance with creditsVerified: false is rejected ---
console.log('\nTest 3: Unverified numeric balance (e.g. stale cache) is rejected by reconcileCreditPayload');
{
    const { sandbox, elements } = setupClientEnv();

    const checkCalls = [];
    const originalCheck = sandbox.window.checkCreditBalance;
    sandbox.window.checkCreditBalance = function (opts) {
        checkCalls.push(opts);
        return originalCheck.apply(this, arguments);
    };

    sandbox.window.commitAuthoritativeCreditBalance(200);
    assert.strictEqual(elements.get('desktopCreditCount').textContent, '200 Credits');

    // Payload has a stale number (e.g. 190) but creditsVerified: false
    const stalePayload = {
        credits: 190,
        creditsVerified: false
    };

    checkCalls.length = 0;
    sandbox.window.reconcileCreditPayload(stalePayload);

    // Assert: Balance was NOT set to 190! It is set to Syncing… and calls forceFresh
    assert.notStrictEqual(elements.get('desktopCreditCount').textContent, '190 Credits', 'Stale 190 must not be displayed');
    assert.strictEqual(elements.get('desktopCreditCount').textContent, 'Syncing…');
    assert.strictEqual(checkCalls.length, 1);
    assert.strictEqual(checkCalls[0]?.forceFresh, true);

    console.log('  ✓ Verified: Unverified numeric balance is rejected and fresh sync is scheduled.');
}

// --- Test 4: Static source audit of cacheCompletedAiResponse ---
console.log('\nTest 4: Static source audit of cacheCompletedAiResponse in server.js');
{
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(serverSource.includes('function cacheCompletedAiResponse('), 'server.js must define cacheCompletedAiResponse');
    assert.ok(serverSource.includes('credits: null'), 'cacheCompletedAiResponse must set credits: null');
    assert.ok(serverSource.includes('creditsVerified: false'), 'cacheCompletedAiResponse must set creditsVerified: false');

    console.log('  ✓ Verified: server.js strictly sanitizes cached responses to credits: null, creditsVerified: false.');
}

console.log('\n============================================================');
console.log('🏁 ALL CACHED REPLAY CREDIT FRESHNESS TESTS PASSED');
console.log('============================================================\n');
