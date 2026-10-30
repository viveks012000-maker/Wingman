'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..', 'netlify-dist');
const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywingman-pricing-readiness-'));

async function main() {
    for (const file of ['index.html', 'app.html']) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        assert(!html.includes('Running from local file system (file://)'), file + ': development warning must be absent from delivered HTML');
        assert(!html.includes('START_WINGMAN.vbs'), file + ': launcher instructions must be absent');
    }
    const server = http.createServer((req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        const file = path.join(root, name === '/' ? 'index.html' : name);
        if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        try {
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
            res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
            res.end(fs.readFileSync(file));
        } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        const base = 'http://127.0.0.1:' + server.address().port;
        for (const [file, heading] of [
            ['about.html', 'About Wingman'], ['contact.html', 'Contact and Support'],
            ['terms.html', 'Terms of Service'], ['privacy.html', 'Privacy Policy'],
            ['refund.html', 'CANCELLATION &amp; REFUND POLICY'], ['service-delivery.html', 'Service Delivery Policy']
        ]) {
            const response = await fetch(base + '/' + file);
            assert.equal(response.status, 200, 'Generated policy route must load: ' + file);
            assert((await response.text()).includes(heading), 'Generated policy content missing: ' + file);
        }
        browser = await chromium.launch({ headless: true });
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            const page = await browser.newPage({ viewport });
            const scriptErrors = [];
            page.on('pageerror', error => scriptErrors.push(error.message));
            // No external AI, payment, auth or account writes during this local UI check.
            await page.route('**/*', route => {
                const requestUrl = route.request().url();
                if (requestUrl.startsWith('http://127.0.0.1:')) return route.continue();
                return route.abort();
            });
            let usdPricingRequestCount = 0;
            let consentPostCount = 0;
            page.on('request', request => {
                if (request.url().includes('/api/pricing?currency=USD')) usdPricingRequestCount += 1;
                if (request.url().endsWith('/api/consent') && request.method() === 'POST') consentPostCount += 1;
            });
            await page.addInitScript(() => {
                localStorage.setItem('wingman_setting_currency', 'USD');
            });
            await page.goto(base + '/', { waitUntil: 'load' });
            assert.equal(await page.locator('#interstitialCheckbox').count(), 0, 'landing age checkbox must be removed');
            assert(await page.locator('#workspaceConsentNotice').innerText().then(text => text.includes('18') && text.includes('AI')));
            assert.equal(await page.title(), 'MyWingman — The AI Texting Assistant');
            assert.equal((await page.locator('h1').innerText()).replace(/\s+/g, ' ').trim(), 'The AI Texting Assistant');
            for (const phrase of [
                'MYWINGMAN · THE AI TEXTING ASSISTANT',
                'Find a better starting point.',
                "Because knowing what you mean and knowing how to say it aren't always the same thing.",
                'The reply you keep rewriting', 'The first-message dilemma', 'Your words, just clearer'
            ]) assert((await page.locator('body').innerText()).includes(phrase), 'Missing marketing copy: ' + phrase);
            assert.equal(await page.locator('img[src="maeve.jpg"]:visible').count(), 0, 'preserve the requested hidden coach image');
            assert.equal(await page.locator('[data-currency="USD"]:visible').count(), 1, 'USD display option must be visible');
            assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'USD', 'saved display currency must be restored');
            await page.waitForFunction(() => document.querySelector('[data-plan="starter"][data-price-role="sale"]').textContent === '$4.99');
            const pricingDisclosure = await page.locator('#pricingCurrencyDisclosure').innerText();
            assert(pricingDisclosure.includes('Fixed USD prices are for display only'));
            assert(pricingDisclosure.includes('INR checkout is unavailable'));
            assert(!/≈|approximate|Frankfurter|reference rate|exchange rate|\b202\d-\d\d-\d\d\b/i.test(pricingDisclosure));
            assert.equal(usdPricingRequestCount, 0, 'fixed USD display must not request reference-rate pricing');
            const displayPrices = [
                ['starter', '$4.99', '2.0¢ per credit', '₹449', '₹1.80 per credit'],
                ['pro', '$9.99', '1.67¢ per credit', '₹899', '₹1.50 per credit'],
                ['elite', '$19.99', '0.67¢ per credit', '₹1,799', '₹0.60 per credit'],
                ['limited', '$49.99', '0.05¢ per credit', '₹4,499', '₹0.045 per credit']
            ];
            for (const [planId, usdPrice, usdRate] of displayPrices) {
                assert.equal(await page.locator('[data-plan="' + planId + '"][data-price-role="sale"]').innerText(), usdPrice);
                assert.equal(await page.locator('[data-plan="' + planId + '"][data-price-role="per-credit"]').innerText(), usdRate);
            }
            assert(!((await page.locator('#pricing').innerText()).includes('≈')));
            assert.equal((await page.locator('#pricing .limited-offer-badge').innerText()).trim(), 'LIMITED TIME');
            await page.locator('#pricing').scrollIntoViewIfNeeded();
            await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('pricing')).opacity) === 1);
            await page.locator('#pricing').screenshot({ path: path.join(screenshotDir, 'pricing-' + viewport.width + '.png') });
            const landingInr = page.locator('#pricingCurrencySelectorWrapper [data-currency="INR"]');
            await landingInr.focus();
            await landingInr.press('Enter');
            assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'INR', 'keyboard activation must switch display currency');
            for (const [planId, , , inrPrice, inrRate] of displayPrices) {
                assert.equal(await page.locator('[data-plan="' + planId + '"][data-price-role="sale"]').innerText(), inrPrice);
                assert.equal(await page.locator('[data-plan="' + planId + '"][data-price-role="per-credit"]').innerText(), inrRate);
            }
            assert.equal(await page.locator('#pricingCurrencySelectorWrapper [data-currency="USD"]').getAttribute('aria-pressed'), 'false');
            const landingUsd = page.locator('#pricingCurrencySelectorWrapper [data-currency="USD"]');
            await landingUsd.focus();
            await landingUsd.press('Enter');
            assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'USD');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('hero-reveal-container')).opacity) === 1);
            await page.screenshot({ path: path.join(screenshotDir, 'homepage-' + viewport.width + '.png') });
            await page.locator('#differentiation').scrollIntoViewIfNeeded();
            await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('differentiation')).opacity) === 1);
            await page.locator('#differentiation').screenshot({ path: path.join(screenshotDir, 'benefits-' + viewport.width + '.png') });
            await page.evaluate(() => {
                window.__landingConsentVisible = getComputedStyle(document.getElementById('interstitialModal')).display !== 'none';
            });
            assert.equal(await page.evaluate(() => window.__landingConsentVisible), false, 'the public home page must not ask for age or Terms consent before sign-in');
            await page.getByRole('link', { name: /Explore the Tools/ }).click();
            await page.waitForURL('**/app.html');
            await page.waitForFunction(() => document.querySelector('[data-plan="limited"][data-price-role="sale"]').textContent === '$49.99');
            assert.equal(
                (await page.locator('input[name="pricing_tier"][value="limited"]').locator('xpath=..').locator('div.absolute').first().innerText()).trim(),
                'LIMITED TIME'
            );
            assert.equal(consentPostCount, 0, 'entering the app while signed out must not record consent');
            assert.equal(await page.evaluate(() => sessionStorage.getItem('wingman_guest_terms_accepted')), null, 'guest navigation must not create consent state');

            if (viewport.width < 768) {
                assert.equal(await page.locator('#desktopCreditCount').isVisible(), false, 'desktop balance card must remain hidden on mobile');
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile layout must not gain horizontal overflow');
            } else {
                for (const uiCase of [
                    { name: 'signed out', signedIn: false, creditText: 'Sign in for credits', planText: 'Free Plan' },
                    { name: 'signed in', signedIn: true, creditText: '125000 Credits', planText: 'Paid Plan' }
                ]) {
                    await page.evaluate(async signedIn => {
                        const session = signedIn
                            ? { access_token: 'isolated-sidebar-session', user: { id: 'sidebar-test-user', email: 'sidebar@example.test' } }
                            : null;
                        window.__wingmanAuthStateResolved = true;
                        window.currentSupabaseSession = session;
                        window.currentSupabaseUser = session ? session.user : null;
                        window.supabaseClient = {
                            auth: {
                                getSession: async () => ({ data: { session }, error: null }),
                                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
                            },
                            from: () => ({
                                select: () => ({
                                    eq: () => ({ maybeSingle: async () => ({ data: { has_paid_credits: true }, error: null }) })
                                })
                            })
                        };
                        window.state.credits = null;
                        window.state.creditsStatus = 'idle';
                        window.checkDashboardAuth();
                        if (signedIn) window.updateUICredits(125000);
                        else if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                        await window.refreshUserPlanBadge();
                    }, uiCase.signedIn);

                    assert.equal(await page.locator('#desktopCreditCount').innerText(), uiCase.creditText, uiCase.name + ' credit label must come from the application state');
                    assert.equal(await page.locator('#desktopPlanBadge').innerText(), uiCase.planText, uiCase.name + ' plan label must come from the application state');
                    assert.equal(await page.locator('#desktopAuthBtn').isVisible(), !uiCase.signedIn, uiCase.name + ' auth controls must render from the session state');
                    assert.equal(await page.locator('#sidebarUserCard').isVisible(), uiCase.signedIn, uiCase.name + ' user card must render from the session state');

                    for (const width of [768, 900, 1024, 1440]) {
                        await page.setViewportSize({ width, height: 1000 });
                        const sidebar = page.locator('aside').first();
                        const card = page.locator('#add-credits-btn').locator('xpath=..');
                        assert.equal(await sidebar.isVisible(), true, 'desktop sidebar must be visible at ' + width + 'px');
                        const layout = await page.evaluate(() => {
                            const card = document.getElementById('add-credits-btn').parentElement;
                            const textColumn = document.getElementById('desktopCreditCount').parentElement.parentElement;
                            const credit = document.getElementById('desktopCreditCount');
                            const plan = document.getElementById('desktopPlanBadge');
                            const button = document.getElementById('add-credits-btn');
                            const cardRect = card.getBoundingClientRect();
                            const textRect = textColumn.getBoundingClientRect();
                            const buttonRect = button.getBoundingClientRect();
                            return {
                                creditText: credit.textContent,
                                planText: plan.textContent,
                                textWhiteSpace: getComputedStyle(credit).whiteSpace,
                                cardWidth: card.clientWidth,
                                cardScrollWidth: card.scrollWidth,
                                textWidth: textColumn.clientWidth,
                                creditScrollWidth: credit.scrollWidth,
                                planScrollWidth: plan.scrollWidth,
                                textRight: textRect.right,
                                buttonLeft: buttonRect.left,
                                buttonWidth: buttonRect.width,
                                cardRight: cardRect.right,
                                buttonRight: buttonRect.right
                            };
                        });
                        assert.equal(layout.creditText, uiCase.creditText);
                        assert.equal(layout.planText, uiCase.planText);
                        assert.equal(layout.textWhiteSpace, 'normal', 'balance text must be allowed to wrap');
                        assert(layout.textWidth > 0 && layout.buttonWidth > 0, 'text and Add button must both remain visible');
                        assert(layout.textRight + 4 <= layout.buttonLeft, 'text column must not overlap the Add button at ' + width + 'px');
                        assert(layout.creditScrollWidth <= layout.textWidth + 1 && layout.planScrollWidth <= layout.textWidth + 1, 'balance labels must fit their available width');
                        assert(layout.cardScrollWidth <= layout.cardWidth + 1, 'balance card must not overflow horizontally');
                        assert(layout.buttonRight <= layout.cardRight, 'Add button must remain inside the card');
                        if (width === 768 && !uiCase.signedIn) {
                            await card.screenshot({ path: path.join(screenshotDir, 'sidebar-' + width + '.png') });
                        }
                        await page.locator('#add-credits-btn').click();
                        assert.equal(await page.locator('#purchaseModal').isVisible(), true, '+ Add must continue opening the purchase modal');
                        await page.evaluate(() => window.closePurchaseModal());
                        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'desktop layout must not gain horizontal overflow at ' + width + 'px');
                        if (width === 1440) await card.screenshot({ path: path.join(screenshotDir, 'sidebar-' + width + '.png') });
                    }
                }
                await page.setViewportSize(viewport);
            }

            // A valid persistent server record unlocks after sign-in without any browser marker.
            await page.evaluate(() => {
                window.currentSupabaseSession = { access_token: 'isolated-navigation-session', user: { id: 'navigation-test-user' } };
                window.currentSupabaseUser = window.currentSupabaseSession.user;
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-navigation-session' });
                window.fetch = async (url, options) => {
                    if (String(url).endsWith('/api/consent/status')) {
                        return { ok: true, status: 200, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1', privacyVersion: '2026.1' }) };
                    }
                    if (String(url).endsWith('/api/consent') && options && options.method === 'POST') {
                        return { ok: true, status: 200, json: async () => ({ success: true, consentRecorded: true, termsVersion: '2026.1', privacyVersion: '2026.1' }) };
                    }
                    throw new Error('Unexpected request in isolated consent navigation test');
                };
            });
            assert.equal(await page.evaluate(() => window.checkServerConsentStatus()), true, 'an existing authenticated user with active server consent remains unlocked');
            assert.equal(await page.locator('#interstitialModal').isVisible(), false, 'valid server consent must not show Unlock Workspace');
            assert.equal(await page.evaluate(() => sessionStorage.getItem('wingman_consent_session')), null, 'server verification must not need a session marker');
            assert.equal(consentPostCount, 0, 'existing consent must not be recorded a second time');
            await page.locator('a[href="index.html"]:visible').first().click();
            await page.waitForURL('**/index.html');
            await page.getByRole('link', { name: /Explore the Tools/ }).click();
            await page.waitForURL('**/app.html');
            assert.equal(await page.locator('#interstitialModal').isVisible(), false, 'home-to-app navigation must not repeat a valid consent prompt');
            await page.evaluate(() => {
                window.currentSupabaseSession = { access_token: 'isolated-navigation-session', user: { id: 'navigation-test-user' } };
                window.currentSupabaseUser = window.currentSupabaseSession.user;
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-navigation-session' });
                window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1', privacyVersion: '2026.1' }) });
            });
            assert.equal(await page.evaluate(() => window.checkServerConsentStatus()), true, 'the current session remains unlocked after app re-entry');
            assert.equal(await page.locator('#interstitialModal').isVisible(), false);

            for (const [id, name, credits, inrPrice, usdPrice] of [
                ['starter', 'Starter Pack', '250', '₹449', '$4.99'],
                ['pro', 'Pro Pack', '600', '₹899', '$9.99'],
                ['elite', 'Elite Pack', '3,000', '₹1,799', '$19.99'],
                ['limited', 'VIP Pack', '1,00,000', '₹4,499', '$49.99']
            ]) {
                await page.goto(base + '/?review-plan=' + id + '#pricing', { waitUntil: 'load' });
                await page.locator('a[href="app.html?tier=' + id + '"]').click();
                await page.waitForURL('**/app.html?tier=' + id);
                assert.equal(await page.locator('#interstitialModal').isVisible(), false, 'pricing navigation must not show pre-login consent');
                await page.waitForFunction(() => typeof window.openPurchaseModal === 'function');
                assert.equal(await page.locator('#purchaseModal').isVisible(), true);
                const linkedSummary = await page.locator('#purchaseOrderSummary').innerText();
                assert(linkedSummary.includes(name) && linkedSummary.includes(usdPrice) && linkedSummary.includes('USD'), 'pricing link must use the saved display currency: ' + linkedSummary);
                await page.evaluate(id => {
                    window.openPurchaseModal();
                    const radio = document.querySelector('input[name="pricing_tier"][value="' + id + '"]');
                    window.selectPricingCard(radio.closest('.pricing-tier-card'));
                }, id);
                const summary = await page.locator('#purchaseOrderSummary').innerText();
                assert(summary.includes(name) && summary.includes(credits) && summary.includes(usdPrice), summary);
                assert(summary.includes('USD') && summary.includes('No additional') && summary.includes('Terms') && summary.includes('Refund'));
                assert.equal(await page.locator('#confirmPurchaseBtn').isDisabled(), true);
                assert.equal(await page.locator('#appPricingCurrencySelectorWrapper [data-currency="USD"]:visible').count(), 1);
                const appInr = page.locator('#appPricingCurrencySelectorWrapper [data-currency="INR"]');
                await appInr.focus();
                await appInr.press('Enter');
                const inrSummary = await page.locator('#purchaseOrderSummary').innerText();
                assert(inrSummary.includes(inrPrice) && inrSummary.includes('INR'), 'order summary must update to INR: ' + inrSummary);
                const appUsd = page.locator('#appPricingCurrencySelectorWrapper [data-currency="USD"]');
                await appUsd.focus();
                await appUsd.press('Enter');
                assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'USD');
                assert((await page.locator('#purchaseOrderSummary').innerText()).includes(usdPrice), 'order summary must restore USD display');
            }
            assert.equal(await page.evaluate(() => window.wingmanCurrency.setCurrency('USD')), 'USD');
            await page.screenshot({ path: path.join(screenshotDir, 'purchase-' + viewport.width + '.png') });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            assert.equal(await page.locator('img[src="maeve.jpg"]:visible').count(), 0, 'workspace coach image must remain hidden');
            assert.equal(await page.locator('#interstitialAgreementCheck').count(), 0, 'dashboard age checkbox must be removed');
            assert(await page.locator('#workspaceConsentNotice').innerText().then(text => text.includes('18') && text.includes('AI')));
            const handlers = await page.evaluate(() => ['runAnalysis', 'generateIcebreaker', 'runAudit', 'submitChatboxMessage'].map(key => typeof window[key]));
            assert.deepEqual(handlers, ['function', 'function', 'function', 'function']);
            await page.evaluate(() => {
                window.closePurchaseModal();
                window.state.isTermsAccepted = false;
                window.currentSupabaseSession = { access_token: 'isolated-browser-fixture', user: { id: 'isolated-ui-test-user' } };
                window.state.consentStatus = 'consent_required';
                window.state.consentUserId = 'isolated-ui-test-user';
                window.state.consentTermsVersion = '2026.1';
                window.state.consentPrivacyVersion = '2026.1';
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-browser-fixture' });
                window.__consentCalls = [];
                window.__consentSucceeds = false;
                const originalFetch = window.fetch;
                window.fetch = async (url, options) => {
                    if (String(url).endsWith('/api/consent')) {
                        window.__consentCalls.push(JSON.parse(options.body));
                        return { ok: window.__consentSucceeds, status: window.__consentSucceeds ? 200 : 503,
                            json: async () => ({ success: window.__consentSucceeds, consentRecorded: window.__consentSucceeds,
                                termsVersion: window.__consentSucceeds ? '2026.1' : undefined,
                                privacyVersion: window.__consentSucceeds ? '2026.1' : undefined }) };
                    }
                    return originalFetch(url, options);
                };
                window.openInterstitialModal();
            });
            await page.screenshot({ path: path.join(screenshotDir, 'consent-' + viewport.width + '.png') });
            assert.equal(await page.evaluate(() => window.__consentCalls.length), 0);
            await page.locator('#interstitialAcceptBtn').click();
            assert.equal(await page.evaluate(() => window.state.isTermsAccepted), false);
            assert.equal(await page.locator('#interstitialAcceptBtn').isDisabled(), false);
            await page.evaluate(() => { window.__consentSucceeds = true; });
            await page.locator('#interstitialAcceptBtn').click();
            assert.equal(await page.evaluate(() => window.state.isTermsAccepted), true);
            assert.deepEqual(await page.evaluate(() => window.__consentCalls), [
                { age18Plus: true, aiProcessingConsent: true }, { age18Plus: true, aiProcessingConsent: true }
            ]);
            assert.deepEqual(scriptErrors, [], 'desktop/mobile page scripts must not throw');
            console.log('UI viewport', viewport.width, ': summary, INR, disabled checkout, removed checkbox, retained consent disclosure and no overflow passed.');
            await page.close();
        }

        console.log('Fixed USD display uses the static catalog; no reference-rate request is made.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        if (process.env.KEEP_PRICING_TEST_SCREENSHOTS !== '1') fs.rmSync(screenshotDir, { recursive: true, force: true });
    }
    console.log('Pricing UI screenshots:', screenshotDir);
    console.log('PASS: production HTML, domestic INR purchase summaries and desktop/mobile UI. No gateway or real AI requests made.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
