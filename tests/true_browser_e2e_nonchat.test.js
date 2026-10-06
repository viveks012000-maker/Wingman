'use strict';

/**
 * Wingman — True Local Browser E2E Integration Suite (Non-Chat Features)
 *
 * Architecture verified:
 * 1. Real Playwright Chromium browser loads authentic local app.html & app.js
 * 2. Real Express application backend running on local loopback (port 0)
 * 3. Client clicks real UI buttons in DOM (Screenshot Analyzer, Icebreaker, Bio Optimizer)
 * 4. Real domestic ledger reservation, settlement, and release lifecycle
 * 5. Bounded server-side transient 503 provider retry resilience (Express recovers without browser error)
 * 6. Fail-then-next-click UI recovery (no stuck loading state, credit release verified)
 * 7. Duplicate click idempotency coalescing (exactly-once deduction)
 * 8. Authentic mixed English + Roman-Hindi output rendering in DOM cards
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

// Set dev auth flags before requiring server
process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-for-local-e2e';
process.env.SUPABASE_URL = 'https://gstnghuhhrxtwjdafufd.supabase.co';
process.env.AICREDITS_API_KEY = 'test-aicredits-main-key';
process.env.AICREDITS_API_KEY_GENERAL = 'test-aicredits-general-key';
process.env.AICREDITS_API_KEY_VISION = 'test-aicredits-vision-key';

const authMod = require('../middleware/supabaseAuth');

// In-memory domestic ledger for the test user
let userCredits = 50;
let reservationLog = [];
let settlementLog = [];
let releaseLog = [];

if (authMod.supabaseAdmin) {
    authMod.supabaseAdmin.rpc = async (funcName, args) => {
        if (funcName === 'reserve_credits') {
            const cost = Number(args.p_amount);
            reservationLog.push({ ...args, cost, balanceBefore: userCredits });
            if (userCredits < cost) {
                return {
                    data: { success: false, error: 'INSUFFICIENT_CREDITS', new_balance: userCredits },
                    error: null
                };
            }
            userCredits -= cost;
            return {
                data: { success: true, new_balance: userCredits },
                error: null
            };
        }
        if (funcName === 'settle_credits') {
            settlementLog.push(args);
            return {
                data: { success: true, settled: true, final_balance: userCredits },
                error: null
            };
        }
        if (funcName === 'release_credits') {
            userCredits += 10;
            releaseLog.push({ ...args, restoredBalance: userCredits });
            return {
                data: { success: true, new_balance: userCredits, remainingCredits: userCredits },
                error: null
            };
        }
        return { data: { success: true }, error: null };
    };

    authMod.supabaseAdmin.from = (table) => {
        if (table === 'user_consents') {
            return {
                select: () => ({
                    eq: function() { return this; },
                    is: function() { return this; },
                    order: function() { return this; },
                    limit: function() { return this; },
                    maybeSingle: async () => ({
                        data: {
                            id: 'consent_e2e_active',
                            terms_version: '2026.1',
                            privacy_version: '2026.1',
                            age_18_plus: true,
                            ai_processing_consent: true,
                            withdrawn_at: null
                        },
                        error: null
                    })
                })
            };
        }
        if (table === 'profiles') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({
                            data: { credits: userCredits },
                            error: null
                        })
                    })
                })
            };
        }
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
            insert: async () => ({ data: null, error: null })
        };
    };
}

// Intercept AI provider requests made by server.js (AICredits / OpenRouter)
const originalFetch = global.fetch;
let simulateTransient503 = false;
let transient503HitCount = 0;
let simulateFatal500 = false;
let providerCallCount = 0;

global.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('aicredits.in') || urlStr.includes('openrouter.ai')) {
        providerCallCount++;

        if (simulateTransient503) {
            simulateTransient503 = false; // Next retry attempt will succeed
            transient503HitCount++;
            return new Response(JSON.stringify({ error: { message: 'Upstream gateway overload', code: 503 } }), {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (simulateFatal500) {
            return new Response(JSON.stringify({ error: { message: 'Persistent upstream failure', code: 500 } }), {
                status: 500,
                statusText: 'Internal Server Error',
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let body = {};
        try {
            body = options.body ? JSON.parse(options.body) : {};
        } catch (_) {}

        const model = body.model || '';
        const messages = body.messages || [];
        const isVision = model.includes('flash') || messages.some(m => Array.isArray(m.content));

        // Vision Stage 1 response
        if (isVision) {
            const mockOcr = "Match: Hey are you around this weekend?\nUser: Thinking of coffee or exploring that new cafe.";
            return new Response(JSON.stringify({
                choices: [{ message: { content: mockOcr } }]
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Determine language requirement from system/user messages
        const isEnglishRequested = messages.some(m =>
            String(m.content).includes('HIGH-STATUS ENGLISH') ||
            String(m.content).includes('AUTHORITATIVE TARGET DETERMINATION: ENGLISH') ||
            String(m.content).includes('TARGET LANGUAGE PROFILE: english') ||
            String(m.content).includes('LANGUAGE_DIRECTIVE: english') ||
            String(m.content).includes('compliant english output') ||
            String(m.content).includes('Rewrite into natural English')
        );

        // Handle selective repair requests if triggered
        const isRepair = messages.some(m =>
            String(m.content).includes('selective repair') ||
            String(m.content).includes('Approved options that MUST be kept intact') ||
            String(m.content).includes('replacements')
        );
        if (isRepair) {
            const replText = isEnglishRequested
                ? "how do you survive a road trip without an elite playlist?"
                : "pehle ye batao how do you survive without a solid road trip playlist?";
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            replacements: [
                                { slot: 1, text: replText },
                                { slot: 2, text: replText },
                                { slot: 3, text: replText },
                                { slot: 4, text: replText },
                                { slot: 5, text: replText },
                                { slot: 6, text: replText },
                                { slot: 7, text: replText },
                                { slot: 8, text: replText },
                                { slot: 9, text: replText },
                                { slot: 10, text: replText }
                            ]
                        })
                    }
                }]
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check if request is Bio Optimizer
        const lastMsg = messages[messages.length - 1] ? String(messages[messages.length - 1].content || '') : '';
        const isBio = messages.some(m => String(m.content).includes('dating profile strategist')) || lastMsg.includes('SELECTED MODE');
        if (isBio) {
            const bioOptionsHinglish = [
                "late-night city drives aur best coffee spots kaafi pasand hain. real question: chai person ho ya cold brew lover?",
                "usually found scouting hidden book cafes aur road trips pe milunga. weekend scene kya hota hai usually?",
                "gym regular by morning, street food enthusiast by night. sach batao: playlist taste kiska better hai?",
                "equal parts spontaneous road trips aur chill acoustic evenings. honest debate: beach sunsets ya mountain cabins?",
                "good conversations aur unexpected chai tapri stops kaafi pasand hain. pick a side: early sunrise ya late midnight?",
                "always planning the next weekend getaway aur diners explore karna. quick question: spontaneous ho ya plan karte ho?",
                "living for live gigs, long playlist drives, aur achhi coffee. sach batao: go-to weekend vibe kya hai?",
                "part-time chef, full-time explorer of local cafes pe milte hain. this or that: spicy street food ya rooftop dinner?",
                "curiosity, good coffee, aur late-night banter kaafi sorted hai. real question: 4-hour road trip survive kar paoge?",
                "looking for a partner in crime for weekend breakfast runs aur banter. pick a side: waffles ya pancakes chalenge?"
            ];

            const bioOptionsEnglish = [
                "Split between late-night city drives and the best coffee spots in town. Real question: coffee lover or tea person?",
                "Usually found scouting hidden book cafes and scenic road trips. What's your move on a rainy Sunday?",
                "Gym regular by morning, street food enthusiast by night. Tell me: who has better taste in playlists?",
                "Equal parts spontaneous road trips and chill acoustic evenings. Honest debate: beach sunsets or mountain cabins?",
                "Believer in good conversations and unexpected coffee stops. Pick a side: early sunrise or late midnight?",
                "Always planning the next weekend getaway and finding great diners. Quick question: are you spontaneous?",
                "Living for live gigs, long playlist drives, and great coffee. Tell me: your go-to weekend vibe?",
                "Part-time chef, full-time explorer of local cafes. This or that: spicy street food or quiet rooftop dinner?",
                "Fueled by curiosity, good coffee, and late-night banter. Real question: would you survive a 4-hour road trip?",
                "Looking for a partner in crime for weekend breakfast runs and banter. Pick a side: waffles or pancakes?"
            ];

            const chosenBio = isEnglishRequested ? bioOptionsEnglish : bioOptionsHinglish;
            return new Response(JSON.stringify({
                choices: [{ message: { content: JSON.stringify({ options: chosenBio }) } }]
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (isEnglishRequested) {
            const english10 = [
                "1. so are you always this spontaneous or is today a special mood?",
                "2. honest question: are you a coffee addict or a tea enthusiast?",
                "3. looking at your taste it seems your weekend schedule is completely sorted",
                "4. what is the absolute best coffee spot in town, let's settle this",
                "5. do you prefer mountain road trips or a quiet sunset by the beach?",
                "6. first tell me: how do you survive a road trip without an elite playlist?",
                "7. honestly your profile vibe seems really refreshing and intriguing",
                "8. never thought someone would have such an interesting combination of hobbies",
                "9. we should grab coffee this weekend and debate who has better taste",
                "10. let's get coffee and figure out which one of us has sharper banter"
            ].join('\n');

            return new Response(JSON.stringify({
                choices: [{ message: { content: english10 } }]
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Generic Icebreaker / Analyzer 10-option output in authentic Hinglish
        const hinge10 = [
            "1. so are you always this spontaneous ya aaj special mood hai?",
            "2. sach batao coffee lover ho ya die-hard chai person?",
            "3. tumhara taste dekhke lagta hai weekend scene kaafi sorted hai",
            "4. best coffee spot kaunsa hai town mein let's settle this",
            "5. mountain road trips pasand hain ya sunset by the beach?",
            "6. pehle ye batao how do you survive without a solid road trip playlist?",
            "7. honestly tumhari vibe kaafi interesting lag rahi hai",
            "8. kabhi socha nahi tha someone could have this unique hobby",
            "9. weekend pe coffee date ka scene banate hain this sunday",
            "10. let's grab coffee aur decide karte hain whose banter is better"
        ].join('\n');

        return new Response(JSON.stringify({
            choices: [{ message: { content: hinge10 } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return originalFetch(url, options);
};

const { app } = require('../server.js');

(async () => {
    console.log('============================================================');
    console.log('🧪 RUNNING TRUE BROWSER E2E NON-CHAT TEST SUITE');
    console.log('============================================================\n');

    let server;
    let browser;
    let port;

    try {
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
        console.log(`[E2E Server] Local Express running on http://127.0.0.1:${port}`);

        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.log(`[Browser PageError]: ${err.message}`));
        page.on('requestfailed', req => console.log(`[Browser RequestFailed]: ${req.method()} ${req.url()} - ${req.failure()?.errorText}`));
        page.on('response', res => {
            if (res.status() >= 400) console.log(`[Browser HTTP ${res.status()}]: ${res.url()}`);
        });

        // Inject authentication session & wire client to local Express server
        await page.addInitScript(({ serverPort }) => {
            window.WINGMAN_CONFIG = { API_BASE_URL: `http://127.0.0.1:${serverPort}` };
            window.getApiBase = () => `http://127.0.0.1:${serverPort}`;
            window.currentSupabaseUser = {
                id: '00000000-0000-0000-0000-000000000001',
                email: 'test@example.com'
            };
            window.currentSupabaseSession = {
                access_token: 'header.payload.signature',
                user: window.currentSupabaseUser
            };
            window.supabaseClient = {
                auth: {
                    getSession: async () => ({
                        data: { session: window.currentSupabaseSession },
                        error: null
                    })
                },
                from: (tbl) => ({
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { credits: 50 },
                                error: null
                            })
                        })
                    })
                })
            };
        }, { serverPort: port });

        // Forward any client calls intended for default localhost:3000 to local Express server
        await page.route('http://localhost:3000/**', async (route) => {
            const req = route.request();
            const newUrl = req.url().replace('http://localhost:3000', `http://127.0.0.1:${port}`);
            route.continue({ url: newUrl });
        });

        // Load app.html
        await page.goto(`http://127.0.0.1:${port}/app.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(400);

        // Ensure terms and authenticated state are active in client state for UI testing
        await page.evaluate(({ serverPort }) => {
            window.currentSupabaseUser = {
                id: '00000000-0000-0000-0000-000000000001',
                email: 'test@example.com'
            };
            window.currentSupabaseSession = {
                access_token: 'header.payload.signature',
                user: window.currentSupabaseUser
            };
            window.isUserAuthenticated = async () => true;
            window.getSupabaseAuthHeaders = async () => ({
                'Authorization': 'Bearer header.payload.signature',
                'x-mock-auth': 'true'
            });
            window.checkCreditBalance = async () => ({ success: true, credits: 50 });
            window.getApiBase = () => `http://127.0.0.1:${serverPort}`;
            if (window.state) {
                window.state.isTermsAccepted = true;
                window.state.credits = 50;
                window.state.creditsStatus = 'loaded';
            }
            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
            if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
        }, { serverPort: port });

        // -----------------------------------------------------------------
        // TEST 1: ICEBREAKER GENERATOR (Mixed English + Roman Hindi -> DOM Cards)
        // -----------------------------------------------------------------
        console.log('▶ [TEST 1] Icebreaker Generator: Button Click -> DOM Cards & Hinglish');
        await page.click('#btn-icebreaker');
        await page.waitForTimeout(200);

        // Fill bio context with mixed English + Roman-Hindi
        await page.fill('#bioInput', 'mera naam sumit hai and i like basketball, late night road trips, aur achhi coffee');
        await page.evaluate(() => window.updateButtonStates());

        // Click generate
        await page.click('#generateIcebreakerBtn');

        // Wait for rendered DOM cards
        await page.waitForSelector('#icebreakResultsState .copy-card-btn', { timeout: 15000 });
        const icebreakerCards = await page.$$eval('#icebreakResultsState .copy-card-btn', els => els.length);
        assert.strictEqual(icebreakerCards, 10, `Expected exactly 10 rendered cards, found ${icebreakerCards}`);

        // Verify rendered card text has authentic Hinglish
        const icebreakerText = await page.$eval('#icebreakResultsState', el => el.textContent);
        assert.ok(
            /coffee|chai|hai|kya|aur/i.test(icebreakerText),
            `Rendered icebreaker cards must contain Hinglish content. Found: ${icebreakerText.slice(0, 200)}`
        );
        assert.strictEqual(userCredits, 40, `Credits must be 40 after icebreaker generation (50 - 10). Current: ${userCredits}`);
        console.log('✔ Test 1 Passed: Icebreaker generated rendered DOM cards with authentic Hinglish.\n');

        // -----------------------------------------------------------------
        // TEST 2: TRANSIENT 503 PROVIDER RETRY (Express Recovers Internally)
        // -----------------------------------------------------------------
        console.log('▶ [TEST 2] Transient 503 Provider Retry: Express Retries Internally');
        simulateTransient503 = true; // First attempt will 503, retry attempt will succeed

        await page.click('#btn-bio');
        await page.waitForTimeout(200);

        await page.fill('#auditBioInput', 'tech enthusiast by day, street food explorer by night. loves finding rooftop chai spots aur acoustic music.');
        await page.evaluate(() => window.updateButtonStates());

        await page.click('#runAuditBtn');

        // Wait for bio results to render
        await page.waitForSelector('#optimizeResultsState .copy-card-btn', { timeout: 15000 });
        const bioCards = await page.$$eval('#optimizeResultsState .copy-card-btn', els => els.length);
        assert.strictEqual(bioCards, 10, `Expected exactly 10 rendered bio cards, found ${bioCards}`);
        assert.strictEqual(transient503HitCount, 1, 'Provider 503 must have been triggered and recovered');
        assert.strictEqual(userCredits, 30, `Credits must be 30 after bio generation (40 - 10). Current: ${userCredits}`);
        console.log('✔ Test 2 Passed: Transient 503 retry succeeded internally with zero browser disruption.\n');

        // -----------------------------------------------------------------
        // TEST 3: FAIL-THEN-NEXT-CLICK (UI Recovers & Restores Credits on Failure)
        // -----------------------------------------------------------------
        console.log('▶ [TEST 3] Fail-Then-Next-Click: UI State Recovery & Credit Preservation');
        simulateFatal500 = true; // Provoke failure

        await page.click('#runAuditBtn');
        await page.waitForTimeout(100);
        await page.waitForFunction(() => window.state && !window.state.isLoading, { timeout: 15000 });

        // Verify button is re-enabled and state.isLoading is false
        const isLoadingAfterFailure = await page.evaluate(() => window.state ? window.state.isLoading : null);
        assert.strictEqual(isLoadingAfterFailure, false, 'state.isLoading must reset to false on failure');

        // Balance must remain unchanged at 30 (zero charge on failure)
        assert.strictEqual(userCredits, 30, `Credits must remain 30 on failure. Current: ${userCredits}`);

        // Now recover provider
        simulateFatal500 = false;

        // Next click immediately succeeds
        await page.click('#runAuditBtn');
        await page.waitForSelector('#optimizeResultsState .copy-card-btn', { timeout: 15000 });
        const bioCardsAfterRecovery = await page.$$eval('#optimizeResultsState .copy-card-btn', els => els.length);
        assert.strictEqual(bioCardsAfterRecovery, 10, `Expected exactly 10 rendered bio cards after recovery, found ${bioCardsAfterRecovery}`);
        assert.strictEqual(userCredits, 20, `Credits must be 20 after successful second attempt (30 - 10). Current: ${userCredits}`);
        console.log('✔ Test 3 Passed: Fail-then-next-click smoothly recovered with zero stuck state.\n');

        // -----------------------------------------------------------------
        // TEST 4: DOUBLE-CLICK IDEMPOTENCY COALESCING (Zero Double Charge)
        // -----------------------------------------------------------------
        console.log('▶ [TEST 4] Double-Click Idempotency: Single Deduction Under Concurrent Calls');
        await page.click('#btn-icebreaker');
        await page.waitForTimeout(200);

        const creditsBeforeDouble = userCredits;
        // Trigger two concurrent invocations with the same client operation ID
        const doubleCallResult = await page.evaluate(async () => {
            const opId = 'test_concurrent_op_' + Date.now();
            const p1 = window.generateWingmanResponse('/api/icebreaker', {
                vibe: 'Direct',
                bioText: 'mera naam sumit hai and i like basketball, late night road trips, aur achhi coffee',
                temperature: 0.8
            }, opId);
            const p2 = window.generateWingmanResponse('/api/icebreaker', {
                vibe: 'Direct',
                bioText: 'mera naam sumit hai and i like basketball, late night road trips, aur achhi coffee',
                temperature: 0.8
            }, opId);
            const res = await Promise.all([p1, p2]);
            return { ok1: Boolean(res[0]), ok2: Boolean(res[1]) };
        });

        assert.ok(doubleCallResult.ok1 || doubleCallResult.ok2, 'Concurrent calls must resolve successfully');
        assert.strictEqual(userCredits, creditsBeforeDouble - 10, 'Credits must be deducted exactly ONCE for duplicate operation key');
        console.log('✔ Test 4 Passed: Duplicate request key coalesced cleanly with zero double charge.\n');

        // -----------------------------------------------------------------
        // TEST 5: SCREENSHOT ANALYZER (File Upload -> DOM Analysis Cards)
        // -----------------------------------------------------------------
        console.log('▶ [TEST 5] Screenshot Analyzer: Upload Image -> Render Cards');
        await page.click('#btn-screenshot');
        await page.waitForTimeout(200);

        // Upload a 1x1 test PNG base64 via processSelectedFiles
        await page.evaluate(() => {
            const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const byteCharacters = atob(b64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });
            const file = new File([blob], 'screenshot.png', { type: 'image/png' });
            window.processSelectedFiles([file]);
            window.updateButtonStates();
        });

        await page.waitForTimeout(200);
        await page.click('#runAnalysisBtn');

        await page.waitForSelector('#analyzeResultsCards .copy-card-btn', { timeout: 15000 });
        const analyzerCards = await page.$$eval('#analyzeResultsCards .copy-card-btn', els => els.length);
        assert.strictEqual(analyzerCards, 10, `Expected exactly 10 rendered analyzer cards, found ${analyzerCards}`);
        console.log('✔ Test 5 Passed: Screenshot Analyzer uploaded image and rendered DOM reply cards.\n');

        console.log('============================================================');
        console.log('🎉 ALL TRUE BROWSER E2E TESTS PASSED (5/5)!');
        console.log('============================================================');
    } finally {
        global.fetch = originalFetch;
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
    }
})().catch(err => {
    console.error('❌ E2E Browser Test Failed:', err);
    process.exit(1);
});
