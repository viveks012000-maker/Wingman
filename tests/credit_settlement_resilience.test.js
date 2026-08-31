'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    createCreditSettlementRetryFetch,
    isSettlementRequest
} = require('../middleware/creditSettlementTransportRetry');

const SUPABASE_URL = 'https://gstnghuhhrxtwjdafufd.supabase.co';
const SETTLE_URL = SUPABASE_URL + '/rest/v1/rpc/settle_credits';

function makeResponse(status, body = '') {
    let drained = false;
    return {
        status,
        ok: status >= 200 && status < 300,
        async arrayBuffer() { drained = true; return Buffer.from(body); },
        async text() { drained = true; return body; },
        get drained() { return drained; }
    };
}

function settleInit(extra = {}) {
    return {
        method: 'POST',
        headers: { apikey: 'test', Authorization: 'Bearer service-role-test' },
        body: JSON.stringify({ p_user_id: '00000000-0000-0000-0000-000000000001', p_request_id: 'req_test' }),
        ...extra
    };
}

async function run() {
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '008_idempotent_credit_settlement.sql'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.settle_credits'), 'migration must replace settle_credits');
    assert.ok(migration.includes("IF v_status = 'completed' THEN"), 'completed replays must be explicitly handled');
    assert.ok(migration.includes("'already_settled', true"), 'completed replay must return an idempotent success marker');
    assert.ok(migration.includes("IF v_status = 'cancelled' THEN"), 'released reservations must never be silently re-settled');
    assert.ok(migration.includes('SECURITY DEFINER'), 'settlement must retain SECURITY DEFINER');
    assert.ok(migration.includes("SET search_path TO ''"), 'settlement must retain a pinned empty search_path');
    assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.settle_credits(uuid, text) FROM anon'), 'anon must not execute settlement');
    assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.settle_credits(uuid, text) FROM authenticated'), 'authenticated browser role must not execute settlement');

    assert.strictEqual(isSettlementRequest(SETTLE_URL, settleInit(), SUPABASE_URL), true);
    assert.strictEqual(isSettlementRequest(SUPABASE_URL + '/rest/v1/rpc/reserve_credits', settleInit(), SUPABASE_URL), false);
    assert.strictEqual(isSettlementRequest(SETTLE_URL, { method: 'GET' }, SUPABASE_URL), false);
    assert.strictEqual(isSettlementRequest(SETTLE_URL, { method: 'POST' }, SUPABASE_URL), false, 'requests without a replayable body must not be retried');

    {
        let calls = 0;
        const delays = [];
        const wrapped = createCreditSettlementRetryFetch(async () => {
            calls += 1;
            if (calls === 1) throw new TypeError('fetch failed');
            return makeResponse(200, '{"success":true}');
        }, SUPABASE_URL, { sleep: async ms => delays.push(ms) });
        const response = await wrapped(SETTLE_URL, settleInit());
        assert.strictEqual(response.status, 200);
        assert.strictEqual(calls, 2, 'one transient transport error must retry exactly once');
        assert.deepStrictEqual(delays, [150]);
    }

    for (const retryStatus of [429, 500, 502, 503, 504]) {
        let calls = 0;
        const first = makeResponse(retryStatus, 'temporary');
        const wrapped = createCreditSettlementRetryFetch(async () => {
            calls += 1;
            return calls === 1 ? first : makeResponse(200, 'ok');
        }, SUPABASE_URL, { sleep: async () => {} });
        const response = await wrapped(SETTLE_URL, settleInit());
        assert.strictEqual(response.status, 200);
        assert.strictEqual(calls, 2, `HTTP ${retryStatus} must be retryable`);
        assert.strictEqual(first.drained, true, `HTTP ${retryStatus} response must be drained before retry`);
    }

    for (const status of [400, 401, 403, 404]) {
        let calls = 0;
        const wrapped = createCreditSettlementRetryFetch(async () => {
            calls += 1;
            return makeResponse(status, 'permanent');
        }, SUPABASE_URL, { sleep: async () => {} });
        const response = await wrapped(SETTLE_URL, settleInit());
        assert.strictEqual(response.status, status);
        assert.strictEqual(calls, 1, `HTTP ${status} must not retry`);
    }

    {
        let calls = 0;
        const wrapped = createCreditSettlementRetryFetch(async () => {
            calls += 1;
            return makeResponse(503, 'reserve failure');
        }, SUPABASE_URL, { sleep: async () => {} });
        const response = await wrapped(SUPABASE_URL + '/rest/v1/rpc/reserve_credits', settleInit());
        assert.strictEqual(response.status, 503);
        assert.strictEqual(calls, 1, 'non-settlement RPCs must pass through untouched');
    }

    {
        let calls = 0;
        const controller = new AbortController();
        controller.abort();
        const wrapped = createCreditSettlementRetryFetch(async () => {
            calls += 1;
            return makeResponse(200);
        }, SUPABASE_URL, { sleep: async () => {} });
        await assert.rejects(
            () => wrapped(SETTLE_URL, settleInit({ signal: controller.signal })),
            err => err && err.name === 'AbortError'
        );
        assert.strictEqual(calls, 0, 'pre-aborted settlement must never be sent');
    }

    {
        let calls = 0;
        const wrapped = createCreditSettlementRetryFetch(async () => {
            calls += 1;
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
        }, SUPABASE_URL, { sleep: async () => {} });
        await assert.rejects(
            () => wrapped(SETTLE_URL, settleInit()),
            err => err && err.name === 'AbortError'
        );
        assert.strictEqual(calls, 1, 'AbortError must not retry');
    }

    console.log('✅ Credit settlement idempotency/retry regression guard passed.');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
