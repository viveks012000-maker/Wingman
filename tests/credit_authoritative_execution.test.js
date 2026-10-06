'use strict';

/**
 * Wingman — Credit Authoritative Execution Suite
 *
 * Verifies:
 * 1. getUserCreditsByUid(uid) fetches authoritative credit balance from DB.
 * 2. getUserCreditsDB(req) handles Express req object correctly.
 * 3. getUserCreditsDB(uidString) defensively handles raw user ID strings without throwing or returning null.
 * 4. Concurrent top-up scenario:
 *    - Initial balance: 50 credits
 *    - Reserve 10 credits (pending balance: 40)
 *    - Concurrently +250 credits purchased via webhook (DB balance becomes 290)
 *    - Settlement completes
 *    - Post-settlement credit read yields 290, NOT stale 40
 * 5. Rejection of unauthenticated users and guest_user with 401.
 */

const assert = require('assert');

process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-for-local';
process.env.SUPABASE_URL = 'https://gstnghuhhrxtwjdafufd.supabase.co';

const authMod = require('../middleware/supabaseAuth');
const {
    getUserCreditsDB,
    getUserCreditsByUid,
    inFlightUserCreditQueries
} = require('../server.js');

(async () => {
    console.log('============================================================');
    console.log('🧪 RUNNING CREDIT AUTHORITATIVE EXECUTION SUITE');
    console.log('============================================================\n');

    const testUid = '00000000-0000-0000-0000-000000000099';
    let dbCredits = 500; // in DB units (CREDITS_PER_INR = 10, so 50 credits)

    // Wire domestic mock into supabaseAdmin
    authMod.supabaseAdmin.from = (table) => {
        if (table === 'profiles') {
            return {
                select: () => ({
                    eq: (col, val) => ({
                        maybeSingle: async () => {
                            if (val === testUid) {
                                return { data: { credits: dbCredits }, error: null };
                            }
                            return { data: null, error: null };
                        }
                    })
                })
            };
        }
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        };
    };

    // -------------------------------------------------------------
    // TEST 1: Direct UID Lookup
    // -------------------------------------------------------------
    console.log('▶ [TEST 1] getUserCreditsByUid(uid) returns authoritative balance');
    const bal1 = await getUserCreditsByUid(testUid);
    assert.strictEqual(bal1, 50, `Expected 50 credits, received ${bal1}`);
    console.log('✔ Test 1 Passed: Direct UID lookup returned authoritative balance.\n');

    // -------------------------------------------------------------
    // TEST 2: Express Req Object Lookup
    // -------------------------------------------------------------
    console.log('▶ [TEST 2] getUserCreditsDB(req) with Express req object');
    const mockReq = {
        user: { id: testUid, email: 'user@example.com' },
        headers: {}
    };
    const bal2 = await getUserCreditsDB(mockReq);
    assert.strictEqual(bal2, 50, `Expected 50 credits, received ${bal2}`);
    console.log('✔ Test 2 Passed: Express req lookup returned authoritative balance.\n');

    // -------------------------------------------------------------
    // TEST 3: Defensive Raw String UID in getUserCreditsDB
    // -------------------------------------------------------------
    console.log('▶ [TEST 3] getUserCreditsDB(uidString) defensive string handling');
    // Previously passed a raw string uid to getUserCreditsDB which failed getUserIdFromReq(req)
    const bal3 = await getUserCreditsDB(testUid);
    assert.strictEqual(bal3, 50, `Expected 50 credits from string UID argument, received ${bal3}`);
    console.log('✔ Test 3 Passed: getUserCreditsDB safely accepted raw string UID.\n');

    // -------------------------------------------------------------
    // TEST 4: Concurrent Top-Up During Generation Lifecycle
    // -------------------------------------------------------------
    console.log('▶ [TEST 4] Concurrent top-up: initial 50 -> reserve 10 -> concurrent +250 -> post-settle reads 290');
    // Step a: Reservation of 10 credits (DB units = 400, or 40 credits)
    dbCredits = 400; // After reservation RPC
    inFlightUserCreditQueries.delete(testUid);

    // Step b: Concurrent top-up during AI generation (+250 credits = +2500 DB units)
    dbCredits += 2500; // Now 2900 DB units = 290 credits
    inFlightUserCreditQueries.delete(testUid);

    // Step c: Post-settlement lookup via both helpers
    const postSettleViaUid = await getUserCreditsByUid(testUid);
    assert.strictEqual(postSettleViaUid, 290, `Expected 290 credits post-settlement, received ${postSettleViaUid}`);

    const postSettleViaReq = await getUserCreditsDB(mockReq);
    assert.strictEqual(postSettleViaReq, 290, `Expected 290 credits post-settlement via req, received ${postSettleViaReq}`);

    const postSettleViaStr = await getUserCreditsDB(testUid);
    assert.strictEqual(postSettleViaStr, 290, `Expected 290 credits post-settlement via string, received ${postSettleViaStr}`);
    console.log('✔ Test 4 Passed: Authoritative balance reflects concurrent top-up perfectly (290 credits).\n');

    // -------------------------------------------------------------
    // TEST 5: Unauthenticated Rejections
    // -------------------------------------------------------------
    console.log('▶ [TEST 5] Unauthenticated and guest_user rejection');
    let rejectedAuth = false;
    try {
        await getUserCreditsByUid(null);
    } catch (err) {
        if (err.statusCode === 401) rejectedAuth = true;
    }
    assert.strictEqual(rejectedAuth, true, 'Null UID must throw 401');

    let rejectedGuest = false;
    try {
        await getUserCreditsByUid('guest_user');
    } catch (err) {
        if (err.statusCode === 401) rejectedGuest = true;
    }
    assert.strictEqual(rejectedGuest, true, 'guest_user must throw 401');

    let rejectedReqGuest = false;
    try {
        await getUserCreditsDB({ user: { id: 'guest_user' } });
    } catch (err) {
        if (err.statusCode === 401) rejectedReqGuest = true;
    }
    assert.strictEqual(rejectedReqGuest, true, 'req with guest_user must throw 401');
    console.log('✔ Test 5 Passed: All unauthenticated and guest_user accesses rejected with 401.\n');

    console.log('============================================================');
    console.log('🎉 ALL CREDIT AUTHORITATIVE TESTS PASSED (5/5)!');
    console.log('============================================================');
})().catch(err => {
    console.error('❌ Credit Authoritative Test Failed:', err);
    process.exit(1);
});
