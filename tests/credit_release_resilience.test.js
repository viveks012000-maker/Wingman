'use strict';

/**
 * Credit RELEASE transport resilience.
 *
 * release_credits is idempotent at the RPC layer (migration 003 returns
 * 'already_settled_or_released' for replays), so transient transport failures
 * are safe to retry. Mirrors the settlement retry contract:
 *   - exact Supabase RPC URL matching, POST only, string body replay
 *   - retry 429/500/502/503/504 + transport errors, max 3 attempts, bounded backoff
 *   - never retry 400/401/403 deterministic failures
 *   - honor AbortSignal; drain response bodies before retry
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    createCreditSettlementRetryFetch,
    isCreditFinalizationRequest,
    CREDIT_FINALIZATION_RPCS
} = require('../middleware/creditSettlementTransportRetry');

const SUPABASE_URL = 'https://gstnghuhhrxtwjdafufd.supabase.co';
const RELEASE_URL = SUPABASE_URL + '/rest/v1/rpc/release_credits';
const SETTLE_URL = SUPABASE_URL + '/rest/v1/rpc/settle_credits';

function makeResponse(status, body = '') {
    let drained = false;
    return {
        status,
        ok: status >= 200 && status < 300,
        body,
        async arrayBuffer() { drained = true; return Buffer.from(body); },
        async text() { drained = true; return body; },
        get drained() { return drained; }
    };
}

function releaseInit(extra = {}) {
    return {
        method: 'POST',
        headers: { apikey: 'test', Authorization: 'Bearer service-role-test' },
        body: JSON.stringify({ p_user_id: '00000000-0000-0000-0000-000000000001', p_request_id: 'req_release_test' }),
        ...extra
    };
}

async function run() {
    // Idempotency contract: migration 003 must keep release replays non-restoring.
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '003_fix_credit_rpc_coalesce.sql'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.release_credits'), 'migration must replace release_credits');
    assert.ok(migration.includes("'already_settled_or_released', true"), 'release replays must return an idempotent success marker');

    // Matcher: both idempotent finalization RPCs are covered; everything else is untouched.
    assert.ok(isCreditFinalizationRequest(RELEASE_URL, releaseInit(), SUPABASE_URL), 'release_credits must be retry-eligible');
    assert.ok(isCreditFinalizationRequest(SETTLE_URL, releaseInit(), SUPABASE_URL), 'settle_credits must remain retry-eligible');
    assert.ok(!isCreditFinalizationRequest(RELEASE_URL, { method: 'GET', body: '{}' }, SUPABASE_URL), 'GET must never retry');
    assert.ok(!isCreditFinalizationRequest(RELEASE_URL, { method: 'POST' }, SUPABASE_URL), 'bodyless POST must never retry');
    assert.ok(!isCreditFinalizationRequest(SUPABASE_URL + '/rest/v1/rpc/reserve_credits', releaseInit(), SUPABASE_URL), 'reserve_credits must never be retried');
    assert.ok(!isCreditFinalizationRequest('https://evil.example/rest/v1/rpc/release_credits', releaseInit(), SUPABASE_URL), 'foreign hosts must never match');
    assert.deepStrictEqual([...CREDIT_FINALIZATION_RPCS].sort(), ['release_credits', 'settle_credits']);

    // Transport failure then success -> exactly one logical release.
    {
        let calls = 0;
        const fetchImpl = async () => {
            calls += 1;
            if (calls === 1) throw new Error('ECONNRESET');
            return makeResponse(200, '{"success":true}');
        };
        const result = await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit());
        assert.strictEqual(calls, 2, 'must retry after transport failure');
        assert.strictEqual(result.status, 200);
    }

    // 503 then success.
    {
        let calls = 0;
        const fetchImpl = async () => {
            calls += 1;
            return calls === 1 ? makeResponse(503) : makeResponse(200);
        };
        const resp = await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit());
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(calls, 2);
    }

    // 429 then success.
    {
        let calls = 0;
        const fetchImpl = async () => {
            calls += 1;
            return calls === 1 ? makeResponse(429) : makeResponse(200);
        };
        const resp = await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit());
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(calls, 2);
    }

    // Deterministic 400 / 401 / 403 must never retry.
    for (const status of [400, 401, 403]) {
        let calls = 0;
        const fetchImpl = async () => { calls += 1; return makeResponse(status); };
        const resp = await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit());
        assert.strictEqual(resp.status, status);
        assert.strictEqual(calls, 1, `HTTP ${status} must not retry`);
    }

    // All 3 attempts fail -> controlled failure with the last transport error.
    {
        let calls = 0;
        const fetchImpl = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
        let threw = null;
        try { await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit()); }
        catch (e) { threw = e; }
        assert.ok(threw, 'exhausted retries must surface a controlled failure');
        assert.strictEqual(calls, 3, 'exactly maxAttempts attempts');
        assert.ok(/ECONNREFUSED/.test(threw.message));
    }

    // Duplicate release replay: idempotent RPC + retry wrapper must never restore twice.
    {
        let releaseCalls = 0;
        const fetchImpl = async (input, init) => {
            releaseCalls += 1;
            const body = JSON.parse(init.body);
            if (releaseCalls === 1) return makeResponse(504);
            return makeResponse(200, JSON.stringify({ success: true, duplicate: body.p_request_id === 'req_release_test' }));
        };
        const first = await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit());
        const replay = await createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => {} })(RELEASE_URL, releaseInit());
        assert.strictEqual(first.status, 200);
        assert.strictEqual(replay.status, 200);
        assert.strictEqual(JSON.parse(replay.body).duplicate, true, 'replay must report the idempotent duplicate marker');
        assert.ok(releaseCalls >= 2 && releaseCalls <= 4, 'replay path stays bounded');
    }

    // Already-settled transaction: release replay must not restore credits (RPC contract).
    {
        const migration003 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '003_fix_credit_rpc_coalesce.sql'), 'utf8').replace(/\r\n/g, '\n');
        assert.ok(migration003.includes('already settled or already released'), 'release must document non-restoring replays');
        assert.ok(migration003.includes('IF v_pending_amount IS NULL THEN'), 'only pending reservations may be released');
        assert.ok(migration003.includes("'already_settled_or_released', true"), 'replays must return the idempotent marker without restoring');
    }

    // Aborted request stops the retry loop.
    {
        const controller = new AbortController();
        let calls = 0;
        const fetchImpl = async () => { calls += 1; throw new Error('ECONNRESET'); };
        const init = releaseInit({ signal: controller.signal });
        const wrapped = createCreditSettlementRetryFetch(fetchImpl, SUPABASE_URL, { sleep: async () => { controller.abort(); } });
        let threw = null;
        try { await wrapped(RELEASE_URL, init); }
        catch (e) { threw = e; }
        assert.ok(threw && threw.name === 'AbortError', 'abort must surface AbortError');
        assert.strictEqual(calls, 1, 'no further attempts after abort');
    }

    console.log('CREDIT RELEASE RESILIENCE: ALL TESTS PASSED');
}

run().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
});
