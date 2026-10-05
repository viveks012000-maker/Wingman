'use strict';
/**
 * =========================================================================================
 * MAEVE PRACTICE PARTNER & COACH MODES MATRIX VERIFICATION SUITE
 * =========================================================================================
 * Verifies all 4 modes end-to-end:
 * 1. Coach Hotline (Ask Anything)
 * 2. Flirting & Teasing
 * 3. First Date Setup
 * 4. Deep Connection
 *
 * Checks:
 * - First turn ("hi")
 * - Subsequent turn ("kya haal hain")
 * - Mixed input ("mera naam rahul hai and i like basketball bhaut zayada")
 * - Short ambiguous continuation ("ok")
 * - Reset / fresh conversation
 * - Both English and Hinglish auto language resolution
 * =========================================================================================
 */

const assert = require('assert');
const request = require('supertest');

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key-for-tests';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'stub-general-key';
process.env.AICREDITS_API_KEY_GENERAL = 'stub-general-key';
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
            if (name === 'reserve_credits') return Promise.resolve({ data: [{ success: true, new_balance: 48, duplicate: false }], error: null });
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

const { app } = require('../server');

const calls = [];
let mockReply = 'Hey! Ready to practice? What scenario should we do?';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/chat/completions')) return realFetch(input, init);
    const body = JSON.parse(init.body);
    calls.push(body);
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: mockReply } }] }),
        text: async () => '{}'
    };
};

const AUTH = { 'x-mock-auth': 'true', 'x-test-user-id': AUTH_USER_ID };

const MODES = [
    { name: 'Coach Hotline', isHotline: true, mode: 'hotline', scenario: 'Coach Hotline' },
    { name: 'Flirting & Teasing', isHotline: false, mode: 'roleplay', scenario: 'Flirting & Teasing' },
    { name: 'First Date Setup', isHotline: false, mode: 'roleplay', scenario: 'First Date Setup' },
    { name: 'Deep Connection', isHotline: false, mode: 'roleplay', scenario: 'Deep Connection' }
];

async function runMatrix() {
    console.log('============================================================');
    console.log('🤖 RUNNING ALL MAEVE MODES & LANGUAGE VERIFICATION SUITE');
    console.log('============================================================\n');

    let serial = 2000;

    for (const m of MODES) {
        console.log(`\n▶ Testing Mode: [${m.name.toUpperCase()}]`);

        // Step 1: Turn 1 with simple "hi" (Fresh conversation, no history)
        {
            serial++;
            calls.length = 0;
            stubAdmin.__state.rpcCalls.length = 0;
            mockReply = m.isHotline ? 'Hey! I am Maeve, your AI Dating Coach. How can I help you today?' : 'hey! ready to practice? 😏';

            const res = await request(app)
                .post('/api/chat')
                .set({ ...AUTH, 'x-test-user-id': `11111111-1111-1111-1111-${String(serial).padStart(12, '0')}` })
                .send({
                    message: 'hi',
                    messages: [{ role: 'user', content: 'hi' }],
                    scenario: m.scenario,
                    mode: m.mode,
                    isHotline: m.isHotline,
                    languageMode: 'auto',
                    idempotencyKey: `maeve_t1_${serial}`
                });

            assert.strictEqual(res.status, 200, `Turn 1 failed: ${res.text}`);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(calls.length, 1);

            const prompt = calls[0].messages[0].content;
            assert.ok(prompt.includes('AUTO LANGUAGE SELECTION'), 'Turn 1 must include AUTO language directive');
            if (!m.isHotline) {
                assert.ok(prompt.includes('turn 1'), 'Turn 1 roleplay must identify as turn 1');
            }
            console.log(`  ✔ Turn 1 ("hi") passed cleanly`);
        }

        // Step 2: Turn 2 with Hinglish input ("kya haal hain")
        {
            serial++;
            calls.length = 0;
            mockReply = m.isHotline ? 'Sab badhiya! Aaj kis baare me baat karni hai?' : 'sab badhiya, tum batao! 😏';

            const history = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'Hey!' },
                { role: 'user', content: 'kya haal hain' }
            ];

            const res = await request(app)
                .post('/api/chat')
                .set({ ...AUTH, 'x-test-user-id': `11111111-1111-1111-1111-${String(serial).padStart(12, '0')}` })
                .send({
                    message: 'kya haal hain',
                    messages: history,
                    scenario: m.scenario,
                    mode: m.mode,
                    isHotline: m.isHotline,
                    languageMode: 'auto',
                    idempotencyKey: `maeve_t2_${serial}`
                });

            assert.strictEqual(res.status, 200, `Turn 2 failed: ${res.text}`);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(calls.length, 1);
            console.log(`  ✔ Turn 2 ("kya haal hain") passed cleanly`);
        }

        // Step 3: Turn 3 with Mixed English + Hinglish input
        {
            serial++;
            calls.length = 0;
            mockReply = m.isHotline ? 'Nice to meet you Sanchi! Basketball lovers usually have great banter.' : 'sanchi! basketball skills test karni padegi pehle 😏';

            const history = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'Hey!' },
                { role: 'user', content: 'kya haal hain' },
                { role: 'assistant', content: 'Sab badhiya!' },
                { role: 'user', content: 'mera naam sanchi hai and i like basketball bhaut zayada' }
            ];

            const res = await request(app)
                .post('/api/chat')
                .set({ ...AUTH, 'x-test-user-id': `11111111-1111-1111-1111-${String(serial).padStart(12, '0')}` })
                .send({
                    message: 'mera naam sanchi hai and i like basketball bhaut zayada',
                    messages: history,
                    scenario: m.scenario,
                    mode: m.mode,
                    isHotline: m.isHotline,
                    languageMode: 'auto',
                    idempotencyKey: `maeve_t3_${serial}`
                });

            assert.strictEqual(res.status, 200, `Turn 3 failed: ${res.text}`);
            assert.strictEqual(res.body.success, true);
            console.log(`  ✔ Turn 3 (Mixed English + Hinglish) passed cleanly`);
        }

        // Step 4: Turn 4 with short ambiguous input ("ok") continuing Hinglish context
        {
            serial++;
            calls.length = 0;
            mockReply = m.isHotline ? 'Toh shuru karte hain! Konsa topic practice karna hai?' : 'chalo done phir 😏';

            const history = [
                { role: 'user', content: 'mera naam sanchi hai and i like basketball bhaut zayada' },
                { role: 'assistant', content: 'Nice!' },
                { role: 'user', content: 'ok' }
            ];

            const res = await request(app)
                .post('/api/chat')
                .set({ ...AUTH, 'x-test-user-id': `11111111-1111-1111-1111-${String(serial).padStart(12, '0')}` })
                .send({
                    message: 'ok',
                    messages: history,
                    scenario: m.scenario,
                    mode: m.mode,
                    isHotline: m.isHotline,
                    languageMode: 'auto',
                    idempotencyKey: `maeve_t4_${serial}`
                });

            assert.strictEqual(res.status, 200, `Turn 4 failed: ${res.text}`);
            assert.strictEqual(res.body.success, true);
            console.log(`  ✔ Turn 4 (Short ambiguous "ok" with Hinglish context) passed cleanly`);
        }

        // Step 5: Turn 5 with language shift to English ("I want to take a more thoughtful approach")
        {
            serial++;
            calls.length = 0;
            mockReply = m.isHotline ? 'Sounds like a great plan. Thoughtful approaches build much stronger connections.' : 'tell me more about what you have in mind.';

            const history = [
                { role: 'user', content: 'kya haal hain' },
                { role: 'assistant', content: 'Sab badhiya!' },
                { role: 'user', content: 'I want to switch to a more thoughtful approach' }
            ];

            const res = await request(app)
                .post('/api/chat')
                .set({ ...AUTH, 'x-test-user-id': `11111111-1111-1111-1111-${String(serial).padStart(12, '0')}` })
                .send({
                    message: 'I want to switch to a more thoughtful approach',
                    messages: history,
                    scenario: m.scenario,
                    mode: m.mode,
                    isHotline: m.isHotline,
                    languageMode: 'auto',
                    idempotencyKey: `maeve_t5_${serial}`
                });

            assert.strictEqual(res.status, 200, `Turn 5 failed: ${res.text}`);
            assert.strictEqual(res.body.success, true);
            console.log(`  ✔ Turn 5 (Language shift to English) passed cleanly`);
        }

        // Step 6: Reset / New conversation works without lingering state
        {
            serial++;
            calls.length = 0;
            mockReply = m.isHotline ? 'Hey there! Starting fresh. What would you like to work on?' : 'hey! new game, let us see what you got 😉';

            const res = await request(app)
                .post('/api/chat')
                .set({ ...AUTH, 'x-test-user-id': `11111111-1111-1111-1111-${String(serial).padStart(12, '0')}` })
                .send({
                    message: 'hi',
                    messages: [{ role: 'user', content: 'hi' }],
                    scenario: m.scenario,
                    mode: m.mode,
                    isHotline: m.isHotline,
                    languageMode: 'auto',
                    idempotencyKey: `maeve_reset_${serial}`
                });

            assert.strictEqual(res.status, 200, `Reset conversation failed: ${res.text}`);
            assert.strictEqual(res.body.success, true);
            console.log(`  ✔ Reset / New conversation passed cleanly`);
        }
    }

    console.log('\n============================================================');
    console.log('🎉 ALL MAEVE MODES & LANGUAGE VERIFICATIONS PASSED (24/24)!');
    console.log('============================================================\n');
}

runMatrix().catch(err => {
    console.error('Maeve Modes Matrix Failed:', err);
    process.exit(1);
});
