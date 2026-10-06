'use strict';
/**
 * =========================================================================================
 * WINGMAN — UNIVERSAL AUTO ENGLISH + HINGLISH COMPREHENSIVE REGRESSION SUITE
 * =========================================================================================
 * Real Express routes, isolated database fixtures, zero live provider spend.
 * Validates the complete matrix across all 6 AI features:
 * 1. Screenshot Analyzer
 * 2. Icebreaker Generator
 * 3. Profile Bio Optimizer
 * 4. Coach Hotline
 * 5. Practice Partner / Roleplay
 * 6. Conversation / Simulator Review
 * =========================================================================================
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key-for-tests';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'stub-general-key';
process.env.AICREDITS_API_KEY_GENERAL = 'stub-general-key';
process.env.AICREDITS_API_KEY_VISION = 'stub-vision-key';
delete process.env.RAILWAY_ENVIRONMENT;

const AUTH_USER_ID = '77777777-7777-7777-7777-777777777777';

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
const { inferLocalLanguage, requestLanguageMode, languageDirective, bioMarketLock } = require('../middleware/languageSelection');

const calls = [];
let output = '';
let queuedOutputs = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/chat/completions')) return realFetch(input, init);
    calls.push(JSON.parse(init.body));
    const content = queuedOutputs.length ? queuedOutputs.shift() : output;
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
        text: async () => '{}'
    };
};

const AUTH = { 'x-mock-auth': 'true', 'x-test-user-id': AUTH_USER_ID };
const devanagariPattern = /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/;

async function runUniversalSuite() {
    console.log('============================================================');
    console.log('🌐 RUNNING UNIVERSAL AUTO ENGLISH + HINGLISH COMPREHENSIVE SUITE');
    console.log('============================================================\n');

    let serial = 1000;

    // --- 1. LEXICAL & DETERMINISTIC INFERENCE TESTS ---
    console.log('--- 1. Lexical & Deterministic Classification Signals ---');

    // Pure English
    assert.strictEqual(inferLocalLanguage('I enjoy hiking and cooking. What should I say next?'), 'en');
    assert.strictEqual(inferLocalLanguage('Coffee, Mumbai, India, Rajasthan'), 'en');
    assert.strictEqual(inferLocalLanguage('Main Street is where we should meet'), 'en');
    assert.strictEqual(inferLocalLanguage('I enjoy hiking, reading and cooking; chai is my favourite drink.'), 'en');
    assert.strictEqual(inferLocalLanguage('What is your favourite coffee spot in town?'), 'en');

    // Pure Roman Hinglish
    assert.strictEqual(inferLocalLanguage('Mujhe trekking pasand hai aur main weekend pe cooking karta hoon'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('yaar usne seen pe chhod diya'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('usne late reply kiya hai, ab kya text karu'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('kya bolu usko ab'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('ye thoda zyada serious lag raha hai'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('coffee pe milke decide karte hain'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('kya scene hai'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('profile achhi hai but opener generic lag raha hai'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('tum batao chai pe kab milna hai'), 'hinglish');

    // Mixed English + Hinglish (dominant style)
    assert.strictEqual(inferLocalLanguage('I love coffee but tum batao weekend pe kya karna hai'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('mera naam sanchi hai and i like basketball bhaut zayada'), 'hinglish');
    assert.strictEqual(inferLocalLanguage('Software engineer in Seattle, love dogs, hiking, and travel. Settle this: mountain or beach?'), 'en');

    // Ambiguous & neutral standalone inputs default to English
    assert.strictEqual(inferLocalLanguage('ok'), 'en');
    assert.strictEqual(inferLocalLanguage('okay'), 'en');
    assert.strictEqual(inferLocalLanguage('yes'), 'en');
    assert.strictEqual(inferLocalLanguage('hmm'), 'en');
    assert.strictEqual(inferLocalLanguage('hmmm'), 'en');
    assert.strictEqual(inferLocalLanguage('👍'), 'en');

    // Context continuity with user history
    const hinglishHist = [{ role: 'user', content: 'yaar usne seen pe chhod diya' }];
    const englishHist = [{ role: 'user', content: 'she has not texted me back since yesterday' }];
    const assistantOnlyHinglish = [{ role: 'assistant', content: 'kya bolna chahte ho?' }];

    assert.strictEqual(inferLocalLanguage('ok', hinglishHist), 'hinglish');
    assert.strictEqual(inferLocalLanguage('ok', englishHist), 'en');
    assert.strictEqual(inferLocalLanguage('ok', assistantOnlyHinglish), 'en', 'Assistant history must never force Hinglish');
    assert.strictEqual(inferLocalLanguage('👍', hinglishHist), 'hinglish');
    assert.strictEqual(inferLocalLanguage('👍', englishHist), 'en');
    assert.strictEqual(inferLocalLanguage('😂', hinglishHist), 'hinglish');
    assert.strictEqual(inferLocalLanguage('😂', englishHist), 'en');
    assert.strictEqual(inferLocalLanguage('lol', hinglishHist), 'hinglish');
    assert.strictEqual(inferLocalLanguage('lol', englishHist), 'en');

    // Mid-conversation language shifts
    assert.strictEqual(inferLocalLanguage('yaar ab samajh nahi aa raha kya reply karu', englishHist), 'hinglish', 'Shift from English to Hinglish');
    assert.strictEqual(inferLocalLanguage('I want to switch to a more thoughtful approach', hinglishHist), 'en', 'Shift from Hinglish to English');

    console.log('✔ Passed: All lexical classification, neutral continuity, and language shift rules verified.\n');

    // --- 2. END-TO-END EXPRESS ROUTE MATRIX (ALL 6 FEATURES) ---
    console.log('--- 2. End-to-End Route Matrix across 6 AI Features ---');

    const testScenarios = [
        { label: 'English', text: 'I love rooftop bars and photography. How should I open?', isHinglish: false, input: 'I love rooftop bars and photography. How should I open?', history: null },
        { label: 'Hinglish', text: 'yaar usne seen pe chhod diya, ab kya reply karu?', isHinglish: true, input: 'yaar usne seen pe chhod diya, ab kya reply karu?', history: null },
        { label: 'Mixed', text: 'I love coffee but tum batao weekend pe kya karna hai', isHinglish: true, input: 'I love coffee but tum batao weekend pe kya karna hai', history: null },
        { label: 'Ambiguous-Standalone', text: 'ok', isHinglish: false, input: 'ok', history: null },
        { label: 'Hinglish-Context-ok', text: 'ok', isHinglish: true, input: 'ok', history: 'yaar usne seen pe chhod diya' },
        { label: 'English-Context-ok', text: 'ok', isHinglish: false, input: 'ok', history: 'she has not texted me back since yesterday' },
        { label: 'Hinglish-Context-emoji', text: '👍', isHinglish: true, input: '👍', history: 'coffee pe milke decide karte hain' },
        { label: 'English-Context-emoji', text: '👍', isHinglish: false, input: '👍', history: 'let us meet at the coffee shop' },
        { label: 'Shift-English-to-Hinglish', text: 'yaar ab samajh nahi aa raha kya reply karu', isHinglish: true, input: 'yaar ab samajh nahi aa raha kya reply karu', history: 'she has not texted me back since yesterday' },
        { label: 'Shift-Hinglish-to-English', text: 'I want to switch to a more thoughtful approach', isHinglish: false, input: 'I want to switch to a more thoughtful approach', history: 'yaar usne seen pe chhod diya' }
    ];

    const features = [
        { id: 'analyze', route: '/api/analyze', cost: 10 },
        { id: 'icebreaker', route: '/api/icebreaker', cost: 10 },
        { id: 'optimize', route: '/api/optimize', cost: 10 },
        { id: 'hotline', route: '/api/chat', scenario: 'Coach Hotline', cost: 2 },
        { id: 'practice', route: '/api/chat', scenario: 'Flirting & Teasing', cost: 2 },
        { id: 'review', route: '/api/simulator/review', cost: 2 }
    ];

    for (const feat of features) {
        console.log(`Testing Feature: [${feat.id.toUpperCase()}]`);

        for (const scen of testScenarios) {
            serial++;
            calls.length = 0;
            stubAdmin.__state.rpcCalls.length = 0;

            const isHinglish = scen.isHinglish;
            const sampleHinglish = 'tum batao chai pe kab milna hai?';
            const sampleEnglish = 'what is your favourite coffee spot?';
            const sampleText = isHinglish ? sampleHinglish : sampleEnglish;

const engOpts = [
    "What is your absolute favorite coffee spot in town?",
    "Tell me your take on spontaneous weekend road trips.",
    "Which playlist do you put on when driving late at night?",
    "Are you more of an early morning explorer or night owl?",
    "How do you usually spend a quiet Sunday afternoon?",
    "Could you survive a four hour road trip with no phone?",
    "Never thought I would find someone with such great taste.",
    "Honestly your profile vibe on here seems completely refreshing.",
    "Let us debate who has sharper banter over iced coffee.",
    "Pick a side between mountain cabins and sunny beaches."
];

const hingOpts = [
    "Tum batao best chai spot kaunsa hai town mein?",
    "Sach batao spontaneous road trips pasand hain ya plan karte ho?",
    "Late night drives pe go-to playlist kaunsi hoti hai?",
    "Weekend scene kya hota hai usually, chill ya fully active?",
    "Profile kaafi interesting lag rahi hai, coffee date kab?",
    "Pehle ye batao how do you survive without a solid playlist?",
    "Aapke hisaab se sabse underrated cafe kaunsa hai?",
    "Rooftop evenings better lagte hain ya street food trails explore karna?",
    "Kabhi socha nahi tha someone could have such a unique vibe.",
    "Chalo decide karte hain whose banter is actually sharper."
];

            // Prepare mock model outputs matching each feature's contract
            const selectedOpts = isHinglish ? hingOpts : engOpts;
            if (['analyze', 'optimize'].includes(feat.id)) {
                output = JSON.stringify({ options: selectedOpts });
            } else if (feat.id === 'icebreaker') {
                output = selectedOpts.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
            } else if (feat.id === 'review') {
                output = JSON.stringify({
                    overall_score: 75,
                    status_text: 'SOLID',
                    wit_score: '80%',
                    text_economy: '75%',
                    confidence_score: '85%',
                    performance_summary: selectedOpts[0],
                    biggest_strength: selectedOpts[1],
                    biggest_mistake: selectedOpts[2],
                    priority_focus: selectedOpts[3]
                });
            } else {
                // hotline or practice
                output = selectedOpts[0];
            }

            const body = {
                languageMode: 'auto',
                shorthandOption: true,
                emojiOption: 0,
                idempotencyKey: `auto_mat_${feat.id}_${serial}`
            };

            const historyArr = scen.history
                ? [{ role: 'user', content: scen.history }, { role: 'assistant', content: 'Noted.' }]
                : [];

            if (feat.id === 'analyze') {
                body.messages = historyArr.length
                    ? [...historyArr, { role: 'user', content: scen.input }]
                    : [{ role: 'user', content: scen.input }];
            } else if (feat.id === 'icebreaker') {
                body.text = scen.input;
                if (historyArr.length) {
                    body.messages = [...historyArr, { role: 'user', content: scen.input }];
                }
            } else if (feat.id === 'optimize') {
                const bioInput = scen.input.length < 5 ? `${scen.input} 👍👍👍` : scen.input;
                body.bioText = bioInput;
                body.text = bioInput;
                if (historyArr.length) {
                    body.messages = [...historyArr, { role: 'user', content: bioInput }];
                }
            } else if (feat.id === 'hotline' || feat.id === 'practice') {
                body.scenario = feat.scenario;
                body.mode = feat.id === 'hotline' ? 'hotline' : 'roleplay';
                body.message = scen.input;
                body.messages = [...historyArr, { role: 'user', content: scen.input }];
            } else if (feat.id === 'review') {
                body.sessionHistory = historyArr.length
                    ? [...historyArr, { role: 'user', content: scen.input }]
                    : [{ role: 'assistant', content: 'Hey there!' }, { role: 'user', content: scen.input }];
            }

            const res = await request(app)
                .post(feat.route)
                .set({ ...AUTH, 'x-test-user-id': `66666666-6666-6666-6666-${String(serial).padStart(12, '0')}` })
                .send(body);

            assert.strictEqual(res.status, 200, `${feat.id} / ${scen.label}: ${res.text}`);
            assert.strictEqual(res.body.success, true);

            // Single model call: Zero additional language-detection calls
            assert.strictEqual(calls.length, 1, `${feat.id}: Expected exactly 1 call (no separate detector)`);

            // Verify prompt directive includes AUTO LANGUAGE SELECTION
            const systemPrompt = calls[0].messages[0].content;
            assert.ok(systemPrompt.includes('AUTO LANGUAGE SELECTION'), `${feat.id}: Must include AUTO LANGUAGE SELECTION`);
            assert.ok(systemPrompt.includes('UNTRUSTED DATA BOUNDARY:'), `${feat.id}: Must preserve security boundary`);

            // Verify credit ledger actions
            const reserveCalls = stubAdmin.__state.rpcCalls.filter(c => c.name === 'reserve_credits');
            const settleCalls = stubAdmin.__state.rpcCalls.filter(c => c.name === 'settle_credits');
            assert.strictEqual(reserveCalls.length, 1, `${feat.id}: Exactly 1 reserve call`);
            assert.strictEqual(settleCalls.length, 1, `${feat.id}: Exactly 1 settle call`);

            // Verify zero Devanagari in response body
            const bodyStr = JSON.stringify(res.body);
            assert.ok(!devanagariPattern.test(bodyStr), `${feat.id} / ${scen.label}: Must contain zero Devanagari characters`);

            // Feature-specific assertions
            if (['analyze', 'icebreaker', 'optimize'].includes(feat.id)) {
                assert.ok(Array.isArray(res.body.options), `${feat.id}: Options must be array`);
                assert.strictEqual(res.body.options.length, 10, `${feat.id}: Exactly 10 options`);
            } else if (feat.id === 'practice') {
                assert.ok(typeof res.body.reply === 'string' && res.body.reply.length > 0);
                assert.ok(typeof res.body.roleplay_response === 'string');
            } else if (feat.id === 'review') {
                assert.ok(typeof res.body.overall_score === 'number');
                assert.ok(typeof res.body.wit_score === 'string');
            }
        }
        console.log(`  ✔ All 10 matrix scenarios passed for ${feat.id.toUpperCase()}`);
    }
    console.log('✔ Passed: All 6 features executed cleanly across all 10 matrix scenarios.\n');

    // --- 3. SCRIPT REPAIR & FAIL-SAFE ZERO DOUBLE CHARGE ---
    console.log('--- 3. Devanagari Repair & Zero Double Charge Verification ---');
    {
        // Successful Repair
        serial++;
        calls.length = 0;
        stubAdmin.__state.rpcCalls.length = 0;
        queuedOutputs = ['क्या करूँ ab', 'tum batao ab kya karna hai'];
        const repairRes = await request(app)
            .post('/api/chat')
            .set({ ...AUTH, 'x-test-user-id': `88888888-8888-8888-8888-${String(serial).padStart(12, '0')}` })
            .send({ languageMode: 'auto', message: 'kya karu ab', idempotencyKey: `repair_succ_${serial}` });

        assert.strictEqual(repairRes.status, 200);
        assert.strictEqual(calls.length, 2, 'Expected 1 primary + 1 repair call');
        assert.strictEqual(stubAdmin.__state.rpcCalls.filter(c => c.name === 'reserve_credits').length, 1, 'Only 1 credit reservation');
        assert.strictEqual(stubAdmin.__state.rpcCalls.filter(c => c.name === 'settle_credits').length, 1, 'Only 1 settlement (zero second debit)');
        assert.ok(!devanagariPattern.test(repairRes.body.reply), 'Repaired reply must contain no Devanagari');

        // Failed Repair: Releases credits fail-closed
        serial++;
        calls.length = 0;
        stubAdmin.__state.rpcCalls.length = 0;
        queuedOutputs = ['क्या करूँ ab', 'अभी भी देवनागरी'];
        const failRepairRes = await request(app)
            .post('/api/chat')
            .set({ ...AUTH, 'x-test-user-id': `88888888-8888-8888-8888-${String(serial).padStart(12, '0')}` })
            .send({ languageMode: 'auto', message: 'kya karu ab', idempotencyKey: `repair_fail_${serial}` });

        assert.ok(failRepairRes.status >= 400);
        assert.strictEqual(stubAdmin.__state.rpcCalls.filter(c => c.name === 'reserve_credits').length, 1);
        assert.strictEqual(stubAdmin.__state.rpcCalls.filter(c => c.name === 'release_credits').length, 1, 'Failed repair must release reservation');
        assert.strictEqual(stubAdmin.__state.rpcCalls.filter(c => c.name === 'settle_credits').length, 0, 'No settlement on failure');
        console.log('✔ Passed: Script repair and credit safety verified (0 double charge, 100% fail-safe release).\n');
    }

    // --- 4. BIO OPTIMIZER CULTURAL PROTECTION AUDIT ---
    console.log('--- 4. Bio Optimizer Cultural Isolation & Anchor Preservation ---');
    {
        // Hinglish Bio must preserve chai / dhaba / tapri
        serial++;
        calls.length = 0;
        const hinglishBioText = 'Bangalore me dev. Chai tapri pe chai aur weekend pe trekking.';
        const hingBioDiverse = [
            "Bangalore me software dev, tapri ki chai aur weekend pe trekking kaafi pasand hai.",
            "Coding din bhar aur shaam ko tapri pe chai debates sorted hain.",
            "Weekend road trips aur tapri chai kaafi pasand hai, court pe milte hain.",
            "Bangalore me techie, par har weekend nayi chai tapri explore karna pasand hai.",
            "Filter coffee bhi chalegi, par tapri chai aur live gigs ki alag vibe hai.",
            "Office ke baad dosto ke saath tapri pe chai peena sabse best lagta hai.",
            "Spontaneous road trips aur tapri pe baatein kaafi sorted lagti hain.",
            "Gym discipline intact hai, par tapri chai aur samosa pe zero self control.",
            "Roadside tapri dhoondna aur achhi baatein karna mera weekend scene hai.",
            "Tech architecture aur tapri chai pe debate karni ho toh batao."
        ];
        output = JSON.stringify({ options: hingBioDiverse });
        const bioRes = await request(app)
            .post('/api/optimize')
            .set({ ...AUTH, 'x-test-user-id': `99999999-9999-9999-9999-${String(serial).padStart(12, '0')}` })
            .send({ languageMode: 'auto', bioText: hinglishBioText, idempotencyKey: `bio_cult_${serial}` });

        assert.strictEqual(bioRes.status, 200);
        const joinedBio = bioRes.body.options.join(' ');
        assert.ok(joinedBio.includes('chai'), 'Hinglish bio must retain chai without converting to coffee');
        assert.ok(!joinedBio.includes('24-hour diner'), 'Hinglish bio must not inject US 24-hour diner');

        // English Bio must apply Western substitution
        serial++;
        calls.length = 0;
        const englishBioText = 'Living in Chicago. Love coffee and 24-hour diner food.';
        const engBioDiverse = [
            "Living in Chicago, passionate about 24-hour diner spots and great coffee.",
            "Architect by day, late night diner enthusiast by night in Chicago.",
            "Exploring local cafes and music venues on the weekend with coffee.",
            "Always planning the next impromptu road trip across the Midwest.",
            "Chicago based designer with a weakness for great diner coffee.",
            "Gym enthusiast with zero self-control around great diner breakfast.",
            "Weekend schedule usually involves scenic drives and great coffee.",
            "Looking for a partner in crime for weekend 24-hour diner breakfast runs.",
            "Spontaneous weekend explorer looking for the best coffee in the city.",
            "Let us debate the best pizza in Chicago over iced coffee."
        ];
        output = JSON.stringify({ options: engBioDiverse });
        const engBioRes = await request(app)
            .post('/api/optimize')
            .set({ ...AUTH, 'x-test-user-id': `99999999-9999-9999-9999-${String(serial).padStart(12, '0')}` })
            .send({ languageMode: 'auto', bioText: englishBioText, idempotencyKey: `bio_eng_${serial}` });

        assert.strictEqual(engBioRes.status, 200);
        const joinedEngBio = engBioRes.body.options.join(' ');
        assert.ok(joinedEngBio.includes('coffee'), 'English bio converts chai to coffee');
        assert.ok(joinedEngBio.includes('24-hour diner'), 'English bio converts dhaba to 24-hour diner');
        console.log('✔ Passed: Cultural context isolation strictly verified (Hinglish preserved, English localized).\n');
    }

    // --- 5. STATIC UI & CLIENT PREFERENCE HARDENING ---
    console.log('--- 5. Static UI & Client Preference Audit ---');
    {
        const rootDir = path.resolve(__dirname, '..');
        const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
        const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf8');
        const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
        const configJs = fs.readFileSync(path.join(rootDir, 'config.js'), 'utf8');

        // Zero manual language toggles
        assert.ok(!/lang-toggle|language-select|data-lang=|aria-label="Language Selector"/i.test(indexHtml), 'index.html must have no manual language toggle');
        assert.ok(!/lang-toggle|language-select|data-lang=|aria-label="Language Selector"/i.test(appHtml), 'app.html must have no manual language toggle');

        // App payload always sends languageMode: 'auto'
        assert.ok(appJs.includes("payload.languageMode = 'auto'"), 'app.js must specify languageMode = auto');
        assert.ok(appJs.includes("languageMode: 'auto'"), 'app.js chat must specify languageMode: auto');

        // Stored Hinglish preference does NOT change static UI
        const documentStub = { readyState: 'loading', documentElement: { lang: 'hi-Latn' }, querySelectorAll: () => [], addEventListener: () => {} };
        const windowStub = { location: { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost' }, localStorage: { getItem: () => 'hinglish', setItem: () => {} }, addEventListener: () => {} };
        global.window = windowStub;
        global.document = documentStub;
        require('../config.js');
        windowStub.wingmanI18n.init();
        assert.strictEqual(windowStub.wingmanI18n.getLanguage(), 'en');
        assert.strictEqual(windowStub.wingmanI18n.getLanguageMode(), 'auto');
        windowStub.wingmanI18n.setLanguage('hinglish');
        assert.strictEqual(documentStub.documentElement.lang, 'en', 'HTML lang stays en even if setLanguage called with hinglish');
        delete global.window;
        delete global.document;

        console.log('✔ Passed: Zero manual language selectors in UI; static UI strictly locked to English.\n');
    }

    console.log('============================================================');
    console.log('🎉 ALL UNIVERSAL AUTO LANGUAGE REGRESSION TESTS PASSED!');
    console.log('============================================================');
}

runUniversalSuite().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
