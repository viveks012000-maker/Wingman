'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..', 'netlify-dist');

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
                if (route.request().url().startsWith('http://127.0.0.1:')) return route.continue();
                return route.abort();
            });
            let consentPostCount = 0;
            page.on('request', request => {
                if (request.url().endsWith('/api/consent') && request.method() === 'POST') consentPostCount += 1;
            });
            await page.addInitScript(() => localStorage.setItem('wingman_setting_currency', 'USD'));
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
            assert.equal(await page.locator('[data-currency="USD"]:visible').count(), 0);
            assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'INR');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('hero-reveal-container')).opacity) === 1);
            await page.screenshot({ path: path.join(root, '..', '..', 'homepage-' + viewport.width + '.png') });
            await page.locator('#differentiation').scrollIntoViewIfNeeded();
            await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('differentiation')).opacity) === 1);
            await page.locator('#differentiation').screenshot({ path: path.join(root, '..', '..', 'benefits-' + viewport.width + '.png') });
            await page.evaluate(() => {
                window.__landingConsentVisible = getComputedStyle(document.getElementById('interstitialModal')).display !== 'none';
            });
            assert.equal(await page.evaluate(() => window.__landingConsentVisible), false, 'the public home page must not ask for age or Terms consent before sign-in');
            await page.getByRole('link', { name: /Explore the Tools/ }).click();
            await page.waitForURL('**/app.html');
            assert.equal(consentPostCount, 0, 'entering the app while signed out must not record consent');
            assert.equal(await page.evaluate(() => sessionStorage.getItem('wingman_guest_terms_accepted')), null, 'guest navigation must not create consent state');

            // Simulate one signed-in browser session and carry its confirmed acknowledgement
            // across a real home -> app navigation in this same tab.
            await page.evaluate(() => {
                window.currentSupabaseSession = { access_token: 'isolated-navigation-session', user: { id: 'navigation-test-user' } };
                window.currentSupabaseUser = window.currentSupabaseSession.user;
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-navigation-session' });
                window.fetch = async (url, options) => {
                    if (String(url).endsWith('/api/consent/status')) {
                        return { ok: true, status: 200, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1' }) };
                    }
                    if (String(url).endsWith('/api/consent') && options && options.method === 'POST') {
                        return { ok: true, status: 200, json: async () => ({ success: true, consentRecorded: true, termsVersion: '2026.1' }) };
                    }
                    throw new Error('Unexpected request in isolated consent navigation test');
                };
            });
            assert.equal(await page.evaluate(() => window.checkServerConsentStatus()), false, 'a newly authenticated session must be asked once');
            assert.equal(await page.locator('#interstitialModal').isVisible(), true);
            await page.locator('#interstitialAcceptBtn').click();
            assert.equal(await page.evaluate(() => window.state.isTermsAccepted), true);
            assert.notEqual(await page.evaluate(() => sessionStorage.getItem('wingman_consent_session')), null);
            await page.locator('a[href="index.html"]:visible').first().click();
            await page.waitForURL('**/index.html');
            await page.getByRole('link', { name: /Explore the Tools/ }).click();
            await page.waitForURL('**/app.html');
            assert.equal(await page.locator('#interstitialModal').isVisible(), false, 'same-tab navigation must not repeat the accepted prompt');
            await page.evaluate(() => {
                window.currentSupabaseSession = { access_token: 'isolated-navigation-session', user: { id: 'navigation-test-user' } };
                window.currentSupabaseUser = window.currentSupabaseSession.user;
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-navigation-session' });
                window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1' }) });
            });
            assert.equal(await page.evaluate(() => window.checkServerConsentStatus()), true, 'the current session remains unlocked after app re-entry');
            assert.equal(await page.locator('#interstitialModal').isVisible(), false);

            for (const [id, name, credits, price] of [
                ['starter', 'Starter Pack', '250', '₹449'],
                ['pro', 'Pro Pack', '600', '₹899'],
                ['elite', 'Elite Pack', '3,000', '₹1,799'],
                ['limited', 'VIP Pack', '1,00,000', '₹4,499']
            ]) {
                await page.goto(base + '/?review-plan=' + id + '#pricing', { waitUntil: 'load' });
                await page.locator('a[href="app.html?tier=' + id + '"]').click();
                await page.waitForURL('**/app.html?tier=' + id);
                assert.equal(await page.locator('#interstitialModal').isVisible(), false, 'pricing navigation must not show pre-login consent');
                await page.waitForFunction(() => typeof window.openPurchaseModal === 'function');
                assert.equal(await page.locator('#purchaseModal').isVisible(), true);
                const linkedSummary = await page.locator('#purchaseOrderSummary').innerText();
                assert(linkedSummary.includes(name) && linkedSummary.includes(price), 'pricing link must open matching order summary: ' + linkedSummary);
                await page.evaluate(id => {
                    window.openPurchaseModal();
                    const radio = document.querySelector('input[name="pricing_tier"][value="' + id + '"]');
                    window.selectPricingCard(radio.closest('.pricing-tier-card'));
                }, id);
                const summary = await page.locator('#purchaseOrderSummary').innerText();
                assert(summary.includes(name) && summary.includes(credits) && summary.includes(price), summary);
                assert(summary.includes('INR') && summary.includes('No additional') && summary.includes('Terms') && summary.includes('Refund'));
                assert.equal(await page.locator('#confirmPurchaseBtn').isDisabled(), true);
                assert.equal(await page.locator('[data-currency="USD"]:visible').count(), 0);
                assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'INR');
            }
            assert.equal(await page.evaluate(() => window.wingmanCurrency.setCurrency('USD')), 'INR');
            await page.screenshot({ path: path.join(root, '..', '..', 'purchase-' + viewport.width + '.png') });
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
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-browser-fixture' });
                window.__consentCalls = [];
                window.__consentSucceeds = false;
                const originalFetch = window.fetch;
                window.fetch = async (url, options) => {
                    if (String(url).endsWith('/api/consent')) {
                        window.__consentCalls.push(JSON.parse(options.body));
                        return { ok: window.__consentSucceeds, status: window.__consentSucceeds ? 200 : 503,
                            json: async () => ({ success: window.__consentSucceeds, consentRecorded: window.__consentSucceeds }) };
                    }
                    return originalFetch(url, options);
                };
                window.openInterstitialModal();
            });
            await page.screenshot({ path: path.join(root, '..', '..', 'consent-' + viewport.width + '.png') });
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
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
    console.log('PASS: production HTML, domestic INR purchase summaries and desktop/mobile UI. No gateway or real AI requests made.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
