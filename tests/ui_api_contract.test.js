'use strict';

/**
 * UI → API product-contract lock.
 *
 * Part A pins the REAL visible frontend option sets (parsed from app.html itself,
 * not from test assumptions) against the server canonical sets. This test fails if
 * a future hardening change swaps, renames, or silently remaps feature enums.
 *
 * Part B drives the four real routes with browser-shaped payloads for EVERY
 * legitimate visible option (16 route checks) under deterministic provider
 * interception, proving value preservation + mode/config selection + output
 * contracts + credit behavior, with no client string reaching trusted authority.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    ANALYZER_TONES,
    ICEBREAKER_VIBES,
    BIO_STYLES,
    PRACTICE_SCENARIOS,
    DEFAULT_PRACTICE_SCENARIO
} = require('../middleware/promptBoundary');

const appHtml = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8').replace(/\r\n/g, '\n');

function extractAll(source, regex) {
    const out = [];
    let m;
    while ((m = regex.exec(source)) !== null) out.push(m[1]);
    return out;
}

// ---------- Part A: derive the visible UI sets from app.html ----------
const uiAnalyzer = extractAll(appHtml, /data-tone="([^"]+)"/g);
const uiIcebreaker = extractAll(appHtml, /data-vibe="([^"]+)"/g);
const uiBio = extractAll(appHtml, /data-bio-style="([^"]+)"/g);
const uiScenarios = extractAll(appHtml, /selectPracticeScenario\(this, '([^']+)'\)/g);

const EXPECTED_ANALYZER = ['Witty', 'Flirty', 'Casual', 'Bold'];
const EXPECTED_ICEBREAKER = ['Direct', 'Intriguing', 'Humorous', 'Compliment'];
const EXPECTED_BIO = ['Punchy', 'Playful', 'Green Flag', 'Mysterious'];
const EXPECTED_VISIBLE_SCENARIOS = ['Coach Hotline', 'Flirting & Teasing', 'First Date Setup', 'Deep Connection'];

async function partA() {
    assert.deepStrictEqual(uiAnalyzer, EXPECTED_ANALYZER, 'analyzer UI chips changed');
    assert.deepStrictEqual(uiIcebreaker, EXPECTED_ICEBREAKER, 'icebreaker UI chips changed');
    assert.deepStrictEqual(uiBio, EXPECTED_BIO, 'bio UI chips changed');
    assert.deepStrictEqual(uiScenarios, EXPECTED_VISIBLE_SCENARIOS, 'practice scenario chips changed');

    assert.deepStrictEqual(ANALYZER_TONES, EXPECTED_ANALYZER, 'analyzer canonical set must equal UI');
    assert.deepStrictEqual(ICEBREAKER_VIBES, EXPECTED_ICEBREAKER, 'icebreaker canonical set must equal UI');
    assert.deepStrictEqual(BIO_STYLES, EXPECTED_BIO, 'bio canonical set must equal UI');
    for (const s of EXPECTED_VISIBLE_SCENARIOS) {
        assert.ok(PRACTICE_SCENARIOS.includes(s), `visible scenario must be canonical: ${s}`);
    }
    console.log('CONTRACT PART A: UI sets pinned (analyzer/icebreaker/bio/practice)');
}

// ---------- Part B harness ----------
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key-for-tests';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'stub-general-key';
process.env.AICREDITS_API_KEY_GENERAL = 'stub-general-key';
process.env.AICREDITS_API_KEY_VISION = 'stub-vision-key';
delete process.env.RAILWAY_ENVIRONMENT;

const AUTH_USER_ID = '66666666-6666-6666-6666-666666666666';

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
            state.rpcCalls.push(name);
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

const providerCalls = [];
const realFetch = globalThis.fetch;
const OPT_REPLY = Array.from({ length: 10 }, (_, i) => `${i + 1}. option ${i + 1} text`).join('\n');
const OPT_JSON_REPLY = JSON.stringify({ options: Array.from({ length: 10 }, (_, i) => `option ${i + 1}`) });
let providerReplyMode = 'numbered';

globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/chat/completions')) {
        const body = JSON.parse(init.body);
        providerCalls.push({ url, body });
        const content = providerReplyMode === 'json' ? OPT_JSON_REPLY : OPT_REPLY;
        return {
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content } }] }),
            arrayBuffer: async () => Buffer.from('{}'),
            text: async () => '{}'
        };
    }
    return realFetch(input, init);
};

const AUTH = { 'x-mock-auth': 'true', 'x-test-user-id': AUTH_USER_ID };

function assertTenOptions(body, label) {
    assert.strictEqual(body.success, true, `${label}: request must succeed`);
    assert.ok(Array.isArray(body.options) && body.options.length === 10, `${label}: 10-option contract must hold, got ${body.options && body.options.length}`);
}

async function partB() {
    // ---------- ANALYZER x4 (chat-history text mode, browser-shaped) ----------
    for (const tone of EXPECTED_ANALYZER) {
        providerCalls.length = 0;
        providerReplyMode = 'json';
        const res = await request(app).post('/api/analyze').set(AUTH).send({
            messages: [{ role: 'user', content: 'her profile says she loves showtunes and coffee' }],
            tone,
            shorthandOption: true,
            emojiOption: 1,
            idempotencyKey: 'contract_analyze_' + tone
        });
        assert.strictEqual(res.status, 200, `analyzer "${tone}" must succeed: ${res.status} ${res.text.slice(0, 140)}`);
        assertTenOptions(res.body, `analyzer "${tone}"`);
        assert.ok(stubAdmin.__state.rpcCalls.includes('reserve_credits'), 'credit reservation preserved');
        assert.ok(stubAdmin.__state.rpcCalls.includes('settle_credits'), 'credit settlement preserved');
        const sys = providerCalls[providerCalls.length - 1].body.messages[0].content;
        const expectedMode = tone === 'Bold' ? 'BOLD / CLOSER' : tone.toUpperCase();
        assert.ok(sys.includes('ACTIVE MODE RUNNING NOW: ' + expectedMode), `analyzer "${tone}" must select its own server mode config`);
        assert.ok(sys.includes('UNTRUSTED DATA BOUNDARY:'), 'trust boundary present');
        const userMsg = providerCalls[providerCalls.length - 1].body.messages.find(m => m.role === 'user');
        assert.ok(userMsg.content.includes('showtunes'), 'user transcript preserved as data');
    }

    // ---------- ICEBREAKER x4 (exact browser payload shape from app.js) ----------
    for (const vibe of EXPECTED_ICEBREAKER) {
        providerCalls.length = 0;
        providerReplyMode = 'numbered';
        const res = await request(app).post('/api/icebreaker').set(AUTH).send({
            vibe,
            bioText: 'she loves showtunes and cold brew',
            temperature: 0.8,
            shorthandOption: state_shorthand(),
            emojiOption: 1,
            messages: [
                { role: 'system', content: 'Generate 10 copy-pasteable icebreakers to send TO the person whose profile/bio is provided, based on vibe: ' + vibe + '. CRITICAL: Do NOT write in the first-person voice of the profile owner. Instead, write messages that a user can send to them to start a conversation, referencing their profile details. Strict format: output [ICEBREAKER_OPTION_1] content and repeat for options up to 10.' },
                { role: 'user', content: 'she loves showtunes and cold brew' }
            ],
            idempotencyKey: 'contract_icebreaker_' + vibe
        });
        assert.strictEqual(res.status, 200, `icebreaker "${vibe}" must succeed: ${res.status} ${res.text.slice(0, 140)}`);
        assertTenOptions(res.body, `icebreaker "${vibe}"`);
        const providerMessages = providerCalls[providerCalls.length - 1].body.messages;
        const userMsg = providerMessages.find(m => m.role === 'user');
        assert.ok(userMsg.content.includes('Requested Tone: ' + vibe + '.'), `icebreaker "${vibe}" must reach the provider as itself`);
        assert.ok(!userMsg.content.includes('\n') || !/SYSTEM:|IGNORE PREVIOUS/.test(userMsg.content.split('Requested Tone:')[1].split('.')[0]), 'no injected authority in tone slot');
        assert.ok(providerMessages[0].content.includes('UNTRUSTED DATA BOUNDARY:'), 'icebreaker boundary present');
    }

    // ---------- BIO x4 (browser-shaped) ----------
    const bioSystemPrompts = {};
    for (const style of EXPECTED_BIO) {
        providerCalls.length = 0;
        providerReplyMode = 'numbered';
        const res = await request(app).post('/api/optimize').set(AUTH).send({
            style,
            bioText: 'i work too much, love showtunes, and make great coffee',
            temperature: 0.8,
            shorthandOption: true,
            emojiOption: 1,
            messages: [
                { role: 'system', content: 'Improve this bio. style: ' + style + '.' },
                { role: 'user', content: 'i work too much, love showtunes, and make great coffee' }
            ],
            idempotencyKey: 'contract_bio_' + style
        });
        assert.strictEqual(res.status, 200, `bio "${style}" must succeed: ${res.status} ${res.text.slice(0, 140)}`);
        assertTenOptions(res.body, `bio "${style}"`);
        const providerMessages = providerCalls[providerCalls.length - 1].body.messages;
        const userMsg = providerMessages.find(m => m.role === 'user');
        assert.ok(userMsg.content.includes('[SELECTED MODE: ' + style.toUpperCase() + ']'), `bio "${style}" must select its own canonical mode`);
        bioSystemPrompts[style] = providerMessages[0].content;
        assert.ok(providerMessages[0].content.includes('UNTRUSTED DATA BOUNDARY:'), 'bio boundary present');
    }
    // Each style must select a DISTINCT server-owned mode configuration.
    assert.strictEqual(new Set(Object.values(bioSystemPrompts)).size, 4, 'four bio styles must select four distinct mode configs');

    // ---------- PRACTICE x4 (browser-shaped) ----------
    for (const scenario of EXPECTED_VISIBLE_SCENARIOS) {
        providerCalls.length = 0;
        providerReplyMode = 'numbered';
        const res = await request(app).post('/api/chat').set(AUTH).send({
            message: 'hey! showtunes fan here',
            scenario,
            messages: [{ role: 'user', content: 'she said k cool' }, { role: 'assistant', content: 'lol perfect, tell me more' }],
            idempotencyKey: 'contract_practice_' + scenario.replace(/[^A-Za-z]/g, '_')
        });
        assert.strictEqual(res.status, 200, `practice "${scenario}" must succeed: ${res.status} ${res.text.slice(0, 140)}`);
        assert.strictEqual(res.body.success, true);
        assert.ok(stubAdmin.__state.rpcCalls.includes('reserve_credits'), 'practice credit reservation preserved');
        const sys = providerCalls[providerCalls.length - 1].body.messages[0].content;
        if (scenario === 'Coach Hotline') {
            assert.ok(!sys.includes('Active Scenario:'), 'hotline must use its own system prompt, not the roleplay one');
        } else {
            assert.ok(sys.includes('Active Scenario: ' + scenario + '\n') || sys.includes('Active Scenario: ' + scenario), `practice "${scenario}" canonical name preserved`);
        }
        assert.ok(sys.includes('UNTRUSTED DATA BOUNDARY:'), 'practice boundary present');
        const history = providerCalls[providerCalls.length - 1].body.messages.slice(1);
        for (const m of history) assert.ok(m.role === 'user' || m.role === 'assistant', 'history roles normalized');
        assert.ok(history.some(m => m.content.includes('k cool')), 'practice history preserved verbatim');
    }

    console.log('CONTRACT PART B: all 16 legitimate mode/scenario route checks passed');
}

function state_shorthand() { return true; }

(async () => {
    await partA();
    await partB();
    console.log('UI/API PRODUCT CONTRACT: ALL TESTS PASSED');
    process.exit(0);
})().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
});
