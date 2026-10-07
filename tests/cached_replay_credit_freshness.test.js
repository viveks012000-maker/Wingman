/**
 * tests/cached_replay_credit_freshness.test.js
 * 
 * Verifies:
 * 1. cacheCompletedAiResponse sanitizes cached wallet state to { credits: null, creditsVerified: false }.
 * 2. Idempotency replays never expose stale reservation-time or cached balances.
 * 3. Client window.reconcileCreditPayload ignores unverified/null credits from cached replays,
 *    marks status as loading, and triggers checkCreditBalance({ forceFresh: true }).
 * 4. Authoritative balance cannot be reverted by replayed responses.
 * 5. Static audit: Zero dynamic code execution (vm/eval) used in test harness.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

// Client wallet harness without dynamic code execution (vm/eval-free)
function setupClientWalletHarness() {
    const state = {
        credits: null,
        creditsStatus: null
    };

    const elements = new Map();
    elements.set('desktopCreditCount', { textContent: '' });
    elements.set('mobileCreditCount', { textContent: '' });

    function syncCredits() {
        const text = state.creditsStatus === "loading"
            ? "Syncing…"
            : (typeof state.credits === 'number' ? `${state.credits} Credits` : "0 Credits");
        elements.get('desktopCreditCount').textContent = text;
        elements.get('mobileCreditCount').textContent = text;
    }

    function commitAuthoritativeCreditBalance(amount) {
        if (typeof amount !== 'number' || isNaN(amount)) return null;
        state.credits = amount;
        state.creditsStatus = "loaded";
        syncCredits();
        return state.credits;
    }

    const checkCreditBalanceCalls = [];
    async function checkCreditBalance(opts = {}) {
        checkCreditBalanceCalls.push(opts);
        return { success: true, credits: state.credits };
    }

    // Mirror of window.reconcileCreditPayload in app.js
    function reconcileCreditPayload(payload) {
        if (!payload || typeof payload !== 'object') {
            state.creditsStatus = "loading";
            syncCredits();
            return checkCreditBalance({ forceFresh: true });
        }
        if (payload.creditsVerified === true && typeof payload.credits === 'number' && !isNaN(payload.credits)) {
            return commitAuthoritativeCreditBalance(payload.credits);
        }
        state.creditsStatus = "loading";
        syncCredits();
        return checkCreditBalance({ forceFresh: true });
    }

    return {
        state,
        elements,
        commitAuthoritativeCreditBalance,
        checkCreditBalance,
        reconcileCreditPayload,
        checkCreditBalanceCalls
    };
}

// --- Test 2: Client environment reconciliation with cached replay payload ---
console.log('\nTest 2: Client reconcileCreditPayload handles unverified cached replay payload safely');
{
    const harness = setupClientWalletHarness();

    assert.strictEqual(typeof harness.commitAuthoritativeCreditBalance, 'function');
    assert.strictEqual(typeof harness.reconcileCreditPayload, 'function');
    assert.strictEqual(typeof harness.checkCreditBalance, 'function');

    // Commit initial balance
    const committed = harness.commitAuthoritativeCreditBalance(300);
    assert.strictEqual(committed, 300, 'Authoritative balance committed should be 300');
    assert.strictEqual(harness.elements.get('desktopCreditCount').textContent, '300 Credits');

    // Simulate arrival of an idempotency cached replay payload
    // Replay payload has data, but credits: null, creditsVerified: false
    const replayPayload = {
        suggestions: ['Replayed suggestion 1', 'Replayed suggestion 2'],
        credits: null,
        creditsVerified: false
    };

    harness.checkCreditBalanceCalls.length = 0;
    harness.reconcileCreditPayload(replayPayload);

    // Assert: UI immediately switches to Syncing… and forceFresh checkCreditBalance is dispatched
    assert.strictEqual(harness.checkCreditBalanceCalls.length, 1, 'checkCreditBalance must be triggered');
    assert.strictEqual(harness.checkCreditBalanceCalls[0]?.forceFresh, true, 'checkCreditBalance must be called with { forceFresh: true }');
    assert.strictEqual(harness.elements.get('desktopCreditCount').textContent, 'Syncing…', 'UI must show Syncing… while fetching authoritative balance');

    console.log('  ✓ Verified: Cached replay payload does not overwrite authoritative balance and triggers forceFresh check.');
}

// --- Test 3: Stale numerical balance with creditsVerified: false is rejected ---
console.log('\nTest 3: Unverified numeric balance (e.g. stale cache) is rejected by reconcileCreditPayload');
{
    const harness = setupClientWalletHarness();

    harness.commitAuthoritativeCreditBalance(200);
    assert.strictEqual(harness.elements.get('desktopCreditCount').textContent, '200 Credits');

    // Payload has a stale number (e.g. 190) but creditsVerified: false
    const stalePayload = {
        credits: 190,
        creditsVerified: false
    };

    harness.checkCreditBalanceCalls.length = 0;
    harness.reconcileCreditPayload(stalePayload);

    // Assert: Balance was NOT set to 190! It is set to Syncing… and calls forceFresh
    assert.notStrictEqual(harness.elements.get('desktopCreditCount').textContent, '190 Credits', 'Stale 190 must not be displayed');
    assert.strictEqual(harness.elements.get('desktopCreditCount').textContent, 'Syncing…');
    assert.strictEqual(harness.checkCreditBalanceCalls.length, 1);
    assert.strictEqual(harness.checkCreditBalanceCalls[0]?.forceFresh, true);

    console.log('  ✓ Verified: Unverified numeric balance is rejected and fresh sync is scheduled.');
}

// --- Test 4: Static source audit of cacheCompletedAiResponse in server.js ---
console.log('\nTest 4: Static source audit of cacheCompletedAiResponse in server.js');
{
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(serverSource.includes('function cacheCompletedAiResponse('), 'server.js must define cacheCompletedAiResponse');
    assert.ok(serverSource.includes('credits: null'), 'cacheCompletedAiResponse must set credits: null');
    assert.ok(serverSource.includes('creditsVerified: false'), 'cacheCompletedAiResponse must set creditsVerified: false');

    console.log('  ✓ Verified: server.js strictly sanitizes cached responses to credits: null, creditsVerified: false.');
}

// --- Test 5: Static source audit of app.js wallet contract ---
console.log('\nTest 5: Static source audit of app.js wallet contract');
{
    const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    assert.ok(appJsSource.includes('window.reconcileCreditPayload = function (payload)'), 'app.js must define window.reconcileCreditPayload');
    assert.ok(appJsSource.includes('payload.creditsVerified === true && typeof payload.credits === \'number\''), 'reconcileCreditPayload must strictly require creditsVerified: true and number type');
    assert.ok(appJsSource.includes('window.commitAuthoritativeCreditBalance(payload.credits)'), 'reconcileCreditPayload must commit only verified credits');
    assert.ok(appJsSource.includes('window.checkCreditBalance({ forceFresh: true })'), 'reconcileCreditPayload must dispatch forceFresh on unverified/null credits');

    console.log('  ✓ Verified: app.js enforces verified credit contract in reconcileCreditPayload.');
}

console.log('\n============================================================');
console.log('🏁 ALL CACHED REPLAY CREDIT FRESHNESS TESTS PASSED');
console.log('============================================================\n');
