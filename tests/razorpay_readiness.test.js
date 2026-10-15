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
            await page.addInitScript(() => localStorage.setItem('wingman_setting_currency', 'USD'));
            const base = 'http://127.0.0.1:' + server.address().port;
            await page.goto(base + '/', { waitUntil: 'load' });
            assert.equal(await page.locator('#interstitialCheckbox').count(), 0, 'landing age checkbox must be removed');
            assert(await page.locator('#workspaceConsentNotice').innerText().then(text => text.includes('18') && text.includes('AI')));
            assert.equal(await page.title(), 'MyWingman — AI Messaging & Conversation Writing Assistant');
            assert.equal(await page.locator('[data-currency="USD"]:visible').count(), 0);
            assert.equal(await page.evaluate(() => window.wingmanCurrency.getCurrency()), 'INR');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('hero-reveal-container')).opacity) === 1);
            await page.screenshot({ path: path.join(root, '..', '..', 'homepage-' + viewport.width + '.png') });
            await page.evaluate(() => {
                window.__consentCalls = [];
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer isolated-browser-fixture' });
                const originalFetch = window.fetch;
                window.fetch = async (url, options) => {
                    if (String(url).endsWith('/api/consent')) {
                        window.__consentCalls.push(JSON.parse(options.body));
                        return { ok: false, json: async () => ({ success: false }) };
                    }
                    return originalFetch(url, options);
                };
                window.openInterstitialModal();
            });
            assert.equal(await page.evaluate(() => window.__consentCalls.length), 0, 'opening notice must not record consent');
            await page.locator('#enterDashboardBtn').click();
            assert.equal(await page.evaluate(() => window.__consentCalls.length), 1);
            assert.equal(await page.evaluate(() => sessionStorage.getItem('wingman_guest_terms_accepted')), null, 'failed persistence must not grant acceptance');
            assert.equal(await page.locator('#enterDashboardBtn').isDisabled(), false);
            for (const [id, name, credits, price] of [
                ['starter', 'Starter Pack', '250', '₹449'],
                ['pro', 'Pro Pack', '600', '₹899'],
                ['elite', 'Elite Pack', '3,000', '₹1,799'],
                ['limited', 'VIP Pack', '1,00,000', '₹4,499']
            ]) {
                await page.goto(base + '/?review-plan=' + id + '#pricing', { waitUntil: 'load' });
                await page.locator('a[href="app.html?tier=' + id + '"]').click();
                assert(await page.locator('#interstitialModal').isVisible());
                assert.equal(await page.evaluate(() => window.pendingPurchaseTargetUrl), 'app.html?tier=' + id);
                // Actual existing Unlock Workspace action for a signed-out visitor.
                await page.locator('#enterDashboardBtn').click();
                await page.waitForURL('**/app.html*');
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
            assert.equal(await page.locator('#interstitialAgreementCheck').count(), 0, 'dashboard age checkbox must be removed');
            assert(await page.locator('#workspaceConsentNotice').innerText().then(text => text.includes('18') && text.includes('AI')));
            const handlers = await page.evaluate(() => ['runAnalysis', 'generateIcebreaker', 'runAudit', 'submitChatboxMessage'].map(key => typeof window[key]));
            assert.deepEqual(handlers, ['function', 'function', 'function', 'function']);
            await page.evaluate(() => {
                window.closePurchaseModal();
                window.state.isTermsAccepted = false;
                window.currentSupabaseSession = { access_token: 'isolated-browser-fixture' };
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
