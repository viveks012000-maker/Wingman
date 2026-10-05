'use strict';
/**
 * =========================================================================================
 * REQUEST LIFECYCLE, IN-FLIGHT COALESCING, IDEMPOTENT REPLAY & AUTO LANGUAGE TEST SUITE
 * =========================================================================================
 * Verifies:
 * 1. Two rapid concurrent requests with the SAME idempotency key coalesce into exactly ONE AI call
 *    and return HTTP 200 to both callers with zero double credit deductions.
 * 2. Replay of an already-completed idempotency key returns the cached completed HTTP 200 response
 *    with zero additional AI calls and zero credit deduction.
 * 3. Fresh user actions with a NEW idempotency key succeed immediately with no stale lockouts.
 * 4. Auto English/Hinglish targeting for Bio Optimizer and Icebreaker correctly produces Hinglish
 *    for mixed inputs and English for pure English.
 * =========================================================================================
 */

const assert = require('assert');

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key-for-tests';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'stub-general-key';
process.env.AICREDITS_API_KEY_GENERAL = 'stub-general-key';
process.env.AICREDITS_API_KEY_VISION = 'stub-vision-key';
delete process.env.RAILWAY_ENVIRONMENT;

const AUTH_USER_ID = '99999999-9999-9999-9999-999999999999';

function makeStubAdmin() {
    const state = { rpcCalls: [] };
    const admin = {
        __state: state,
        from(table) {
            const b = {};
            ['select', 'eq', 'is', 'order', 'limit', 'update', 'delete', 'insert'].forEach(m => { b[m] = () => b; });
            b.maybeSingle = async () => {
                if (table === 'user_consents') {
                    return { data: { id: 'consent-row', terms_version: '2026.1', privacy_version: '2026.1', age_18_plus: true, ai_processing_consent: true, withdrawn_at: null }, error: null };
                }
                if (table === 'profiles') return { data: { credits: 500 }, error: null };
                return { data: null, error: null };
            };
            b.then = (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
            return b;
        },
        rpc(name) {
            state.rpcCalls.push({ name, args: arguments[1] });
            if (name === 'reserve_credits') return Promise.resolve({ data: [{ success: true, new_balance: 40, duplicate: false }], error: null });
            if (name === 'settle_credits') return Promise.resolve({ data: { success: true, settled: true }, error: null });
            if (name === 'release_credits') return Promise.resolve({ data: { success: true, settled: true, released: true }, error: null });
            return Promise.resolve({ data: null, error: null });
        },
        auth: { admin: { deleteUser: async () => ({ error: null }) } }
    };
    return admin;
}

const stubAdmin = makeStubAdmin();
const supabaseJsPath = require.resolve('@supabase/supabase-js');
require.cache[supabaseJsPath] = { id: supabaseJsPath, filename: supabaseJsPath, loaded: true, exports: { createClient: () => stubAdmin } };

const request = require('supertest');
const { app } = require('../server');

const calls = [];
let fetchDelayMs = 0;
let mockOutputGenerator = null;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/chat/completions')) return realFetch(input, init);
    const parsedBody = JSON.parse(init.body);
    calls.push(parsedBody);

    if (fetchDelayMs > 0) {
        await new Promise(r => setTimeout(r, fetchDelayMs));
    }

    let content = 'Default mock response';
    if (mockOutputGenerator) {
        content = mockOutputGenerator(parsedBody);
    } else {
        content = JSON.stringify({ options: Array.from({ length: 10 }, (_, i) => `Mock option ${i + 1}`) });
    }

    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
        text: async () => '{}'
    };
};

const AUTH = { 'x-mock-auth': 'true', 'x-test-user-id': AUTH_USER_ID };

async function runLifecycleSuite() {
    console.log('============================================================');
    console.log('🚀 RUNNING REQUEST LIFECYCLE & IDEMPOTENCY REPLAY TEST SUITE');
    console.log('============================================================');

    const testEndpoints = [
        { name: 'Bio Optimizer', url: '/api/optimize', body: { bioText: 'Loves music and basketball. Weekends on court.' } },
        { name: 'Icebreaker', url: '/api/icebreaker', body: { text: 'Loves music and basketball.' } },
        { name: 'Screenshot Analyzer', url: '/api/analyze', body: { messages: [{ role: 'user', content: 'What should I reply next?' }] } },
        { name: 'Coach Hotline', url: '/api/chat', body: { message: 'What is a good opener for a coffee lover?', scenario: 'Coach Hotline', mode: 'hotline' } }
    ];

    for (const ep of testEndpoints) {
        console.log(`\n--- Testing ${ep.name} ---`);
        calls.length = 0;
        stubAdmin.__state.rpcCalls.length = 0;
        fetchDelayMs = 150; // Delay to guarantee concurrent in-flight overlap

        const sharedKey = `idemp_${ep.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

        // 1. In-Flight Coalescing: Send two rapid requests with identical key
        const p1 = request(app)
            .post(ep.url)
            .set({ ...AUTH, 'x-idempotency-key': sharedKey })
            .send({ ...ep.body, idempotencyKey: sharedKey });

        // Slightly stagger request 2 so request 1 has acquired the lock and entered provider call
        await new Promise(r => setTimeout(r, 20));

        const p2 = request(app)
            .post(ep.url)
            .set({ ...AUTH, 'x-idempotency-key': sharedKey })
            .send({ ...ep.body, idempotencyKey: sharedKey });

        const [res1, res2] = await Promise.all([p1, p2]);

        assert.strictEqual(res1.status, 200, `First request for ${ep.name} must return HTTP 200`);
        assert.strictEqual(res2.status, 200, `Concurrent retry request for ${ep.name} must return HTTP 200`);
        assert.strictEqual(res1.body.success, true);
        assert.strictEqual(res2.body.success, true);

        // Crucial invariant: Exactly 1 model call and 1 credit reserve despite 2 client requests
        assert.strictEqual(calls.length, 1, `In-flight coalescing must result in exactly 1 AI provider call (actual: ${calls.length})`);
        const reserves = stubAdmin.__state.rpcCalls.filter(c => c.name === 'reserve_credits');
        assert.strictEqual(reserves.length, 1, `In-flight coalescing must result in exactly 1 credit reservation (actual: ${reserves.length})`);

        // 2. Completed Replay: A 3rd request with the SAME key after completion
        fetchDelayMs = 0;
        const res3 = await request(app)
            .post(ep.url)
            .set({ ...AUTH, 'x-idempotency-key': sharedKey })
            .send({ ...ep.body, idempotencyKey: sharedKey });

        assert.strictEqual(res3.status, 200, `Completed replay for ${ep.name} must return HTTP 200`);
        assert.strictEqual(res3.body.success, true);
        assert.strictEqual(calls.length, 1, `Completed replay must NOT make an additional AI call (actual: ${calls.length})`);
        assert.strictEqual(stubAdmin.__state.rpcCalls.filter(c => c.name === 'reserve_credits').length, 1, `Completed replay must NOT reserve additional credits`);

        // 3. Fresh user action: Next request with a NEW key succeeds immediately
        const freshKey = `idemp_fresh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const resFresh = await request(app)
            .post(ep.url)
            .set({ ...AUTH, 'x-idempotency-key': freshKey })
            .send({ ...ep.body, idempotencyKey: freshKey });

        assert.strictEqual(resFresh.status, 200, `Fresh action for ${ep.name} must succeed immediately`);
        assert.strictEqual(resFresh.body.success, true);
        assert.strictEqual(calls.length, 2, `Fresh action must make a new AI call`);

        console.log(`✔ Passed: ${ep.name} in-flight coalescing, completed replay, and fresh action isolation verified.`);
    }

    // 4. Test Bio Optimizer and Icebreaker Auto Hinglish Directives
    console.log('\n--- Testing Auto Hinglish and English Directives ---');
    calls.length = 0;

    // Bio: "mera naam sumit hai and i like basketball"
    await request(app)
        .post('/api/optimize')
        .set(AUTH)
        .send({ bioText: 'mera naam sumit hai and i like basketball', languageMode: 'auto', idempotencyKey: `bio_sumit_${Date.now()}` });

    const bioPrompt = calls[calls.length - 1].messages[0].content;
    assert.ok(bioPrompt.includes('[AUTHORITATIVE TARGET DETERMINATION: ROMAN-SCRIPT HINGLISH]'), 'Bio prompt for mixed input must contain Authoritative Hinglish directive');
    assert.ok(!bioPrompt.includes('US/Western dating profile strategist'), 'Bio prompt for Hinglish must NOT contain US/Western lock');

    // Icebreaker: "mera naam sanchi hai and i like basketball bhaut zayada"
    await request(app)
        .post('/api/icebreaker')
        .set(AUTH)
        .send({ text: 'mera naam sanchi hai and i like basketball bhaut zayada', languageMode: 'auto', idempotencyKey: `ice_sanchi_${Date.now()}` });

    const icePrompt = calls[calls.length - 1].messages[0].content;
    assert.ok(icePrompt.includes('[AUTHORITATIVE TARGET DETERMINATION: ROMAN-SCRIPT HINGLISH]'), 'Icebreaker prompt for mixed input must contain Authoritative Hinglish directive');

    // English Bio: "I love hiking in the mountains and trying new coffee places"
    await request(app)
        .post('/api/optimize')
        .set(AUTH)
        .send({ bioText: 'I love hiking in the mountains and trying new coffee places', languageMode: 'auto', idempotencyKey: `bio_eng_${Date.now()}` });

    const engBioPrompt = calls[calls.length - 1].messages[0].content;
    assert.ok(engBioPrompt.includes('[AUTHORITATIVE TARGET DETERMINATION: ENGLISH]'), 'Bio prompt for English input must contain Authoritative English directive');
    assert.ok(engBioPrompt.includes('US/Western'), 'Bio prompt for English must include US/Western targeting');

    console.log('✔ Passed: Auto Hinglish and English directives strictly verified.\n');

    console.log('============================================================');
    console.log('🎉 ALL REQUEST LIFECYCLE & IDEMPOTENCY REPLAY TESTS PASSED!');
    console.log('============================================================');
}

runLifecycleSuite().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
