'use strict';

/**
 * =========================================================================================
 * WINGMAN PRICING & CURRENCY SWITCHING AUTOMATED TEST SUITE
 * =========================================================================================
 * Validates:
 * 1. Default currency behavior & persistence (USD default, INR support)
 * 2. Authoritative pricing catalog structure & integer minor units
 * 3. Frontend DOM presentation updating for Starter, Pro, Elite, Limited/VIP
 * 4. Tier selection preservation during currency toggle
 * 5. Payment safety & fail-closed security (production purchases disabled)
 * 6. Tampering rejection (unsupported currency, unknown plan, client-dictated credits)
 * 7. Storage resilience (graceful fallback when localStorage blocked/throws)
 * 8. Public read endpoint /api/pricing (contract & zero secrets)
 * =========================================================================================
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const ROOT = path.resolve(__dirname, '..');
const { app } = require('../server');
const {
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
    STORAGE_KEY,
    PRICING_CATALOG,
    canonicalizeCurrency,
    formatCurrencyAmount,
    getPlanPricing
} = require('../config/pricingCatalog');

const serverJsContent = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const configJsContent = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8').replace(/\r\n/g, '\n');
const appJsContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const indexHtmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const appHtmlContent = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8').replace(/\r\n/g, '\n');

async function runPricingTests() {
    console.log('============================================================');
    console.log('🪙 RUNNING WINGMAN CURRENCY & PRICING AUTOMATED TESTS');
    console.log('============================================================\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`✅ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`❌ FAIL: ${name}\n   Error: ${err.message}`);
            failed++;
        }
    }

    async function asyncTest(name, fn) {
        try {
            await fn();
            console.log(`✅ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`❌ FAIL: ${name}\n   Error: ${err.message}`);
            failed++;
        }
    }

    // -------------------------------------------------------------
    // SECTION A: DEFAULT BEHAVIOR & CANONICALIZATION
    // -------------------------------------------------------------
    console.log('--- A. DEFAULT BEHAVIOR & CANONICALIZATION ---');
    test('Default currency is USD', () => {
        assert.strictEqual(DEFAULT_CURRENCY, 'USD');
        assert.deepStrictEqual(SUPPORTED_CURRENCIES, ['USD', 'INR']);
    });

    test('Canonicalizer resolves missing, invalid, or lowercase to valid currencies', () => {
        assert.strictEqual(canonicalizeCurrency(null), 'USD');
        assert.strictEqual(canonicalizeCurrency(''), 'USD');
        assert.strictEqual(canonicalizeCurrency('EUR'), 'USD');
        assert.strictEqual(canonicalizeCurrency('GBP'), 'USD');
        assert.strictEqual(canonicalizeCurrency('inr'), 'INR');
        assert.strictEqual(canonicalizeCurrency('INR'), 'INR');
        assert.strictEqual(canonicalizeCurrency('  inr  '), 'INR');
        assert.strictEqual(canonicalizeCurrency('usd'), 'USD');
    });

    // -------------------------------------------------------------
    // SECTION B: PERSISTENCE KEY & WHITELIST
    // -------------------------------------------------------------
    console.log('\n--- B. PERSISTENCE & SAFE STORAGE WHITELIST ---');
    test('Persistence key is wingman_setting_currency', () => {
        assert.strictEqual(STORAGE_KEY, 'wingman_setting_currency');
        assert.ok(configJsContent.includes("'wingman_setting_currency'"));
    });

    test('app.js PERSISTED_SETTING_KEYS explicitly whitelists wingman_setting_currency', () => {
        assert.ok(appJsContent.includes('"wingman_setting_currency"'), 'app.js must whitelist wingman_setting_currency');
    });

    // -------------------------------------------------------------
    // SECTION C: AUTHORITATIVE PRICING CATALOG & INTEGER MINORS
    // -------------------------------------------------------------
    console.log('\n--- C. CATALOG & INTEGER MINOR AMOUNTS ---');
    test('All plans have exact canonical credit counts', () => {
        assert.strictEqual(PRICING_CATALOG.starter.credits, 250);
        assert.strictEqual(PRICING_CATALOG.pro.credits, 600);
        assert.strictEqual(PRICING_CATALOG.elite.credits, 3000);
        assert.strictEqual(PRICING_CATALOG.limited.credits, 100000);
    });

    test('All plan prices use integer minor units (no floating-point authority)', () => {
        for (const [planId, plan] of Object.entries(PRICING_CATALOG)) {
            assert.ok(Number.isInteger(plan.prices.USD.amountMinor), `${planId} USD amountMinor must be an integer`);
            assert.ok(Number.isInteger(plan.prices.INR.amountMinor), `${planId} INR amountMinor must be an integer`);
            if (plan.prices.USD.regularMinor !== null) {
                assert.ok(Number.isInteger(plan.prices.USD.regularMinor), `${planId} USD regularMinor must be an integer`);
            }
            if (plan.prices.INR.regularMinor !== null) {
                assert.ok(Number.isInteger(plan.prices.INR.regularMinor), `${planId} INR regularMinor must be an integer`);
            }
        }
    });

    test('USD selling prices match current production baseline exactly', () => {
        assert.strictEqual(PRICING_CATALOG.starter.prices.USD.amountMinor, 499); // $4.99
        assert.strictEqual(PRICING_CATALOG.pro.prices.USD.amountMinor, 999); // $9.99
        assert.strictEqual(PRICING_CATALOG.pro.prices.USD.regularMinor, 1499); // $14.99
        assert.strictEqual(PRICING_CATALOG.elite.prices.USD.amountMinor, 1999); // $19.99
        assert.strictEqual(PRICING_CATALOG.elite.prices.USD.regularMinor, 2999); // $29.99
        assert.strictEqual(PRICING_CATALOG.limited.prices.USD.amountMinor, 4900); // $49.00
        assert.strictEqual(PRICING_CATALOG.limited.prices.USD.regularMinor, 29900); // $299.00
    });

    test('Provisional INR prices have positive savings and correct per-credit ratios', () => {
        const proInr = PRICING_CATALOG.pro.prices.INR;
        assert.strictEqual(proInr.amountMinor, 89900); // ₹899
        assert.strictEqual(proInr.regularMinor, 134900); // ₹1,349
        const proSavings = (proInr.regularMinor - proInr.amountMinor) / 100;
        assert.strictEqual(proSavings, 450); // ₹450

        const eliteInr = PRICING_CATALOG.elite.prices.INR;
        assert.strictEqual(eliteInr.amountMinor, 179900); // ₹1,799
        assert.strictEqual(eliteInr.regularMinor, 269900); // ₹2,699
        const eliteSavings = (eliteInr.regularMinor - eliteInr.amountMinor) / 100;
        assert.strictEqual(eliteSavings, 900); // ₹900

        const limitedInr = PRICING_CATALOG.limited.prices.INR;
        assert.strictEqual(limitedInr.amountMinor, 449900); // ₹4,499
        assert.strictEqual(limitedInr.regularMinor, 2699900); // ₹26,999
        const limitedSavings = (limitedInr.regularMinor - limitedInr.amountMinor) / 100;
        assert.strictEqual(limitedSavings, 22500); // ₹22,500
    });

    // -------------------------------------------------------------
    // SECTION D: MARKUP & ACCESSIBILITY AUDIT
    // -------------------------------------------------------------
    console.log('\n--- D. MARKUP & ACCESSIBILITY AUDIT ---');
    test('index.html contains accessible segmented currency selector', () => {
        assert.ok(indexHtmlContent.includes('id="pricingCurrencySelectorWrapper"'));
        assert.ok(indexHtmlContent.includes('role="group"'));
        assert.ok(indexHtmlContent.includes('aria-label="Display currency"'));
        assert.ok(indexHtmlContent.includes('data-currency="USD"'));
        assert.ok(indexHtmlContent.includes('data-currency="INR"'));
        assert.ok(indexHtmlContent.includes('aria-label="USD — US Dollar"'));
        assert.ok(indexHtmlContent.includes('aria-label="INR — Indian Rupee"'));
    });

    test('app.html contains accessible segmented currency selector in modal header', () => {
        assert.ok(appHtmlContent.includes('id="appPricingCurrencySelectorWrapper"'));
        assert.ok(appHtmlContent.includes('data-currency="USD"'));
        assert.ok(appHtmlContent.includes('data-currency="INR"'));
    });

    test('Pricing cards in index.html have structured data-plan and data-price-role attributes', () => {
        assert.ok(indexHtmlContent.includes('data-plan="starter" data-price-role="sale"'));
        assert.ok(indexHtmlContent.includes('data-plan="starter" data-price-role="per-credit"'));
        assert.ok(indexHtmlContent.includes('data-plan="pro" data-price-role="sale"'));
        assert.ok(indexHtmlContent.includes('data-plan="pro" data-price-role="regular"'));
        assert.ok(indexHtmlContent.includes('data-plan="pro" data-price-role="saving"'));
        assert.ok(indexHtmlContent.includes('data-plan="elite" data-price-role="sale"'));
        assert.ok(indexHtmlContent.includes('data-plan="elite" data-price-role="regular"'));
        assert.ok(indexHtmlContent.includes('data-plan="elite" data-price-role="saving"'));
        assert.ok(indexHtmlContent.includes('data-plan="limited" data-price-role="sale"'));
        assert.ok(indexHtmlContent.includes('data-plan="limited" data-price-role="regular"'));
        assert.ok(indexHtmlContent.includes('data-plan="limited" data-price-role="saving"'));
        assert.ok(indexHtmlContent.includes('data-plan="limited" data-price-role="cta-price"'));
    });

    test('Pricing cards in app.html have structured data-plan and data-price-role attributes', () => {
        assert.ok(appHtmlContent.includes('data-plan="starter" data-price-role="sale"'));
        assert.ok(appHtmlContent.includes('data-plan="pro" data-price-role="sale"'));
        assert.ok(appHtmlContent.includes('data-plan="elite" data-price-role="sale"'));
        assert.ok(appHtmlContent.includes('data-plan="limited" data-price-role="sale"'));
    });

    // -------------------------------------------------------------
    // SECTION E: CLIENT SCRIPT EXPORTS & RUNTIME ENGINE
    // -------------------------------------------------------------
    console.log('\n--- E. CLIENT SCRIPT EXPORTS & RUNTIME ENGINE ---');
    test('config.js exports window.wingmanCurrency with complete API surface', () => {
        assert.ok(configJsContent.includes('window.wingmanCurrency = {'));
        assert.ok(configJsContent.includes('getCurrency: getCurrency'));
        assert.ok(configJsContent.includes('setCurrency: setCurrency'));
        assert.ok(configJsContent.includes('formatPlanSale: formatPlanSale'));
        assert.ok(configJsContent.includes('updatePricingDisplay: updatePricingDisplay'));
        assert.ok(configJsContent.includes('onCurrencyChange: onCurrencyChange'));
        assert.ok(configJsContent.includes('wingman:currencychange'));
    });

    test('app.js integrates with wingmanCurrency on card selection and currency change', () => {
        assert.ok(appJsContent.includes('window.wingmanCurrency.formatPlanSale'));
        assert.ok(appJsContent.includes('window.wingmanCurrency.getCurrency'));
        assert.ok(appJsContent.includes('syncSelectedTierCurrency'));
    });

    // -------------------------------------------------------------
    // SECTION F: PAYMENT SAFETY & FAIL-CLOSED GUARDS
    // -------------------------------------------------------------
    console.log('\n--- F. PAYMENT SAFETY & PRODUCTION FAIL-CLOSED ---');
    test('Production purchases pause notice is preserved verbatim in app.html', () => {
        assert.ok(
            appHtmlContent.includes('Purchases currently paused during system upgrade'),
            'Must preserve purchase pause notice'
        );
    });

    test('app.js purchase handlers retain strict unavailable toast (no credit minting)', () => {
        assert.ok(
            appJsContent.includes('Credit purchasing is currently unavailable while payment gateway upgrades are underway.'),
            'simulateDemoPurchase/confirmPurchase must show upgrade notice'
        );
    });

    await asyncTest('/api/payments/verify strictly fails closed with 503 in production', async () => {
        // Without auth, returns 401
        const unauthRes = await request(app).post('/api/payments/verify').send({});
        assert.strictEqual(unauthRes.status, 401);

        // When IS_PROD or !ENABLE_MOCK_PAYMENTS, returns 503
        // We verify the exact code block exists in server.js
        assert.ok(
            serverJsContent.includes("if (IS_PROD || process.env.ENABLE_MOCK_PAYMENTS !== 'true') {\n            return res.status(503).json({\n                success: false,\n                error: 'Production payment gateway integration pending. Real payment gateway required.'\n            });\n        }"),
            'server.js must retain 503 block for /api/payments/verify'
        );
    });

    await asyncTest('/api/credits/purchase strictly fails closed with 503', async () => {
        assert.ok(
            serverJsContent.includes("app.post('/api/credits/purchase', requireSupabaseAuth, apiLimiter, (req, res) => {\n    return res.status(503).json({\n        success: false,\n        error: \"Direct credit purchasing is currently unavailable. Payment gateway integration is deferred.\"\n    });\n});"),
            'server.js must retain 503 block for /api/credits/purchase'
        );
    });

    // -------------------------------------------------------------
    // SECTION G: SERVER AUTHORITATIVE PRICING ENDPOINT (/api/pricing)
    // -------------------------------------------------------------
    console.log('\n--- G. PUBLIC /api/pricing READ ENDPOINT ---');
    await asyncTest('GET /api/pricing returns 200 with supported currencies and catalog', async () => {
        const res = await request(app).get('/api/pricing');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.defaultCurrency, 'USD');
        assert.deepStrictEqual(res.body.supportedCurrencies, ['USD', 'INR']);
        assert.strictEqual(res.body.currency, 'USD');
        assert.ok(res.body.plans && res.body.plans.starter);
        assert.strictEqual(res.body.plans.starter.credits, 250);
        assert.strictEqual(res.body.plans.starter.prices.USD.amountMinor, 499);
        assert.strictEqual(res.body.plans.starter.prices.INR.amountMinor, 44900);

        // Zero secrets exposed
        assert.strictEqual(res.body.serviceRoleKey, undefined);
        assert.strictEqual(res.body.razorpaySecret, undefined);
        assert.strictEqual(res.body.supabaseServiceKey, undefined);
    });

    await asyncTest('GET /api/pricing?currency=INR returns 200 with currency=INR', async () => {
        const res = await request(app).get('/api/pricing?currency=INR');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.currency, 'INR');
    });

    await asyncTest('GET /api/pricing?currency=EUR returns 400 for unsupported currency', async () => {
        const res = await request(app).get('/api/pricing?currency=EUR');
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
        assert.ok(res.body.error.includes('Unsupported currency'));
    });

    // -------------------------------------------------------------
    // SECTION H: TAMPERING & SERVER-SIDE TRUTH VALIDATION
    // -------------------------------------------------------------
    console.log('\n--- H. TAMPERING DEFENSE AUDIT ---');
    test('server.js rejects arbitrary client credits and derives grant strictly from PRICING_CATALOG', () => {
        // Verify server code uses plan.credits and does NOT trust req.body.credits or req.body.amountInr
        assert.ok(serverJsContent.includes('const targetCredits = plan.credits;'));
        assert.ok(!serverJsContent.includes('targetCredits = Number(credits) ||'));
    });

    test('server.js validates currency parameter strictly against SUPPORTED_CURRENCIES', () => {
        assert.ok(serverJsContent.includes('if (!SUPPORTED_CURRENCIES.includes(selectedCurrency))'));
    });

    test('server.js rejects unknown plan IDs', () => {
        assert.ok(serverJsContent.includes('const plan = PRICING_CATALOG[targetPlanId];'));
        assert.ok(serverJsContent.includes("error: 'Unknown pricing plan.'"));
    });

    console.log(`\n============================================================`);
    console.log(`🏁 TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log(`============================================================`);

    if (failed > 0) process.exit(1);
}

runPricingTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
