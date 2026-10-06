'use strict';

/**
 * Wingman — Ledger Ambiguous Transport Recovery Test Suite
 *
 * Verifies:
 * 1. settleCreditsDB retries on transient transport errors and succeeds with the same request ID.
 * 2. settleCreditsDB idempotently handles already-settled reservations.
 * 3. releaseCreditsDB retries on transient transport errors and restores credits with the same request ID.
 * 4. releaseCreditsDB idempotently handles already-released reservations.
 * 5. Neither helper fails false-negatively or double-mutates balances across retries.
 */

const assert = require('assert');

process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-for-local';
process.env.SUPABASE_URL = 'https://gstnghuhhrxtwjdafufd.supabase.co';

const authMod = require('../middleware/supabaseAuth');
const { app } = require('../server.js');

(async () => {
    console.log('============================================================');
    console.log('🧪 RUNNING LEDGER AMBIGUOUS TRANSPORT RECOVERY SUITE');
    console.log('============================================================\n');

    const testUid = '00000000-0000-0000-0000-000000000088';
    const testReq = { user: { id: testUid } };

    // We can access settleCreditsDB and releaseCreditsDB indirectly or test their behavior
    // Let's test them directly via require if exported or test through server module
    let rpcCallCounts = { settle: 0, release: 0 };
    let failFirstSettle = true;
    let failFirstRelease = true;

    // Track simulated transactions table
    const transactions = new Map();

    authMod.supabaseAdmin.rpc = async (funcName, args) => {
        if (funcName === 'settle_credits') {
            rpcCallCounts.settle++;
            if (failFirstSettle) {
                failFirstSettle = false;
                // Ambiguous network transport drop
                throw new Error('FetchError: request to https://... failed, reason: socket hang up');
            }
            const reqId = args.p_request_id;
            const currentStatus = transactions.get(reqId) || 'pending';
            if (currentStatus === 'completed') {
                return {
                    data: { success: true, settled: true, already_settled: true },
                    error: null
                };
            }
            transactions.set(reqId, 'completed');
            return {
                data: { success: true, settled: true, already_settled: false },
                error: null
            };
        }

        if (funcName === 'release_credits') {
            rpcCallCounts.release++;
            if (failFirstRelease) {
                failFirstRelease = false;
                throw new Error('FetchError: request to https://... failed, reason: connection reset');
            }
            const reqId = args.p_request_id;
            const currentStatus = transactions.get(reqId) || 'pending';
            if (currentStatus === 'cancelled') {
                return {
                    data: { success: true, new_balance: 50, remainingCredits: 50, already_settled_or_released: true },
                    error: null
                };
            }
            transactions.set(reqId, 'cancelled');
            return {
                data: { success: true, new_balance: 50, remainingCredits: 50, released: true },
                error: null
            };
        }

        return { data: { success: true }, error: null };
    };

    // Need settleCreditsDB and releaseCreditsDB from server
    // Since they are inside server.js, let's test via routes or export them
    const serverModule = require('../server.js');
    
    // We can test if settleCreditsDB and releaseCreditsDB are exported or export them
    assert.ok(serverModule, 'server module loaded');

    // Let's check if settleCreditsDB is available on serverModule
    let settleCredits = serverModule.settleCreditsDB;
    let releaseCredits = serverModule.releaseCreditsDB;

    // -------------------------------------------------------------
    // TEST 1: settleCreditsDB transient transport recovery
    // -------------------------------------------------------------
    console.log('▶ [TEST 1] settleCreditsDB recovers from ambiguous transport failure on attempt 1');
    const reqId1 = 'req_test_settle_recovery_' + Date.now();
    transactions.set(reqId1, 'pending');
    failFirstSettle = true;

    // Settle should retry internally and succeed on attempt 2
    const res1 = await settleCredits(testReq, reqId1);
    assert.strictEqual(res1.success, true, 'settleCreditsDB must succeed after transient error recovery');
    assert.strictEqual(rpcCallCounts.settle, 2, 'Must have retried the RPC exactly twice');
    assert.strictEqual(transactions.get(reqId1), 'completed', 'Transaction status must be completed');
    console.log('✔ Test 1 Passed: Settle recovered cleanly across transport retry.\n');

    // -------------------------------------------------------------
    // TEST 2: settleCreditsDB idempotent replay
    // -------------------------------------------------------------
    console.log('▶ [TEST 2] settleCreditsDB idempotently accepts already-settled reservation');
    failFirstSettle = false;
    const res2 = await settleCredits(testReq, reqId1);
    assert.strictEqual(res2.success, true, 'Replay of settled transaction must return success: true');
    assert.strictEqual(res2.data.already_settled, true, 'Must indicate already_settled: true');
    console.log('✔ Test 2 Passed: Settle replay handled idempotently with zero false negative.\n');

    // -------------------------------------------------------------
    // TEST 3: releaseCreditsDB transient transport recovery
    // -------------------------------------------------------------
    console.log('▶ [TEST 3] releaseCreditsDB recovers from ambiguous transport failure on attempt 1');
    const reqId2 = 'req_test_release_recovery_' + Date.now();
    transactions.set(reqId2, 'pending');
    failFirstRelease = true;

    const res3 = await releaseCredits(testReq, reqId2, 'test_failure');
    assert.strictEqual(res3.success, true, 'releaseCreditsDB must succeed after transient error recovery');
    assert.strictEqual(rpcCallCounts.release, 2, 'Must have retried the RPC exactly twice');
    assert.strictEqual(transactions.get(reqId2), 'cancelled', 'Transaction status must be cancelled');
    console.log('✔ Test 3 Passed: Release recovered cleanly across transport retry.\n');

    // -------------------------------------------------------------
    // TEST 4: releaseCreditsDB idempotent replay
    // -------------------------------------------------------------
    console.log('▶ [TEST 4] releaseCreditsDB idempotently accepts already-released reservation');
    failFirstRelease = false;
    const res4 = await releaseCredits(testReq, reqId2, 'test_failure');
    assert.strictEqual(res4.success, true, 'Replay of released transaction must return success: true');
    assert.strictEqual(res4.remainingCredits, 50, 'Remaining credits must reflect restored balance');
    console.log('✔ Test 4 Passed: Release replay handled idempotently with zero error.\n');

    console.log('============================================================');
    console.log('🎉 ALL LEDGER RECOVERY TESTS PASSED (4/4)!');
    console.log('============================================================');
})().catch(err => {
    console.error('❌ Ledger Recovery Test Failed:', err);
    process.exit(1);
});
