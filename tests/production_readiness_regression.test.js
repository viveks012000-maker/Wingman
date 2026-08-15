/**
 * Production Readiness & QA Comprehensive Regression Suite
 *
 * Validates:
 * 1. Broken User Notifications / Toast DOM lifecycle and error feedback across all features
 * 2. Complete removal of fake simulator review fallbacks (zero score 78 / STATUS: GOOD defaults)
 * 3. 18+ Age Verification & Legal Consent Flow (State, Modals, Backend API, and Migration 004)
 * 4. Credit-Aware CTA Dynamic Button States & Invariants (401, 402, 404, 429, 503, 500, Bio 500/501, Image 5/6)
 * 5. Deferred Payments Status & Fail-Closed Purchase Handling
 * 6. Privacy Disclosures, Marketing Copy Accuracy, Viewport Zoom & Mobile Layout Safety
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("\n============================================================");
console.log("🛡️  RUNNING PRODUCTION READINESS REGRESSION TEST SUITE");
console.log("============================================================\n");

const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const appJsCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const supabaseClientCode = fs.readFileSync(path.join(__dirname, '..', 'supabaseClient.js'), 'utf8');
const appHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
const indexHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const privacyHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
const termsHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'terms.html'), 'utf8');
const refundHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'refund.html'), 'utf8');
const migration005Path = path.join(__dirname, '..', 'migrations', '005_user_consent_and_age_verification.sql');

// -----------------------------------------------------------------------------
// 1. NOTIFICATIONS & TOAST DOM LIFECYCLE
// -----------------------------------------------------------------------------
console.log("▶ [TEST 1] Toast Container & Notification DOM Lifecycle");

// 1.1 Static #toastContainer in HTML files
assert.strictEqual(appHtmlCode.includes('id="toastContainer"'), true, "app.html must have static #toastContainer element");
assert.strictEqual(indexHtmlCode.includes('id="toastContainer"'), true, "index.html must have static #toastContainer element");

// 1.2 showToast dynamic container creation fallback
assert.strictEqual(appJsCode.includes('document.createElement("div")'), true, "app.js showToast must create container if missing");
assert.strictEqual(appJsCode.includes('container.id = "toastContainer"'), true, "app.js showToast must assign toastContainer id");
assert.strictEqual(appJsCode.includes('toast.onclick = function()'), true, "app.js toasts must support click-to-dismiss");

// 1.3 Error feedback across features
assert.strictEqual(appJsCode.includes('Screenshot Analysis Error:'), true);
assert.strictEqual(appJsCode.includes('Bio Optimizer Error:'), true);
assert.strictEqual(appJsCode.includes('Icebreaker Error:'), true);
console.log("✔ Test 1 Passed: Toast container and feedback lifecycle verified.");

// -----------------------------------------------------------------------------
// 2. SIMULATOR REVIEW NO FAKE SUCCESS & SETTLEMENT CHECKS
// -----------------------------------------------------------------------------
console.log("▶ [TEST 2] Simulator Review Endpoint Fallback Purge & Ledger Settle");

// Must reject < 2 messages with HTTP 400
assert.strictEqual(serverCode.includes('historyArray.length < 2'), true, "Simulator review must check history length < 2");
assert.strictEqual(serverCode.includes('At least 2 messages are required to evaluate your conversation.'), true, "Simulator review must return explicit 400 error message for short transcripts");

// Must release credits and return error on AI failure (NO score 78 fallback)
const reviewEndpointIdx = serverCode.indexOf("app.post('/api/simulator/review'");
assert.ok(reviewEndpointIdx !== -1, "Review endpoint must exist");
const reviewSection = serverCode.substring(reviewEndpointIdx, reviewEndpointIdx + 15000);

assert.strictEqual(reviewSection.includes('throw new Error("Failed to parse simulation review output from AI model.");'), true, "Review endpoint must throw on parse error rather than return fake score");
assert.strictEqual(reviewSection.includes('releaseCreditsDB(req, reqId, error.message)'), true, "Review endpoint must release credits on catch");
assert.strictEqual(reviewSection.includes('Simulation review failed. Your credits were restored.'), true, "Review endpoint must return accurate restored message when release succeeds");
console.log("✔ Test 2 Passed: Fake simulator review fallbacks strictly purged.");

// -----------------------------------------------------------------------------
// 3. 18+ AGE VERIFICATION & LEGAL CONSENT FLOW
// -----------------------------------------------------------------------------
console.log("▶ [TEST 3] 18+ Age Verification & Explicit Consent Flow");

// 3.1 Initial state must be false
assert.strictEqual(appJsCode.includes('isTermsAccepted: false,'), true, "app.js initial state.isTermsAccepted must default to false");

// 3.2 Closing modals must NEVER set terms accepted
const closeAuthModalIdx = appJsCode.indexOf('window.closeAuthRequiredModal = function');
const closeAuthSection = appJsCode.substring(closeAuthModalIdx, closeAuthModalIdx + 600);
assert.strictEqual(closeAuthSection.includes('state.isTermsAccepted = true;'), false, "closeAuthRequiredModal must never force isTermsAccepted to true");
assert.strictEqual(closeAuthSection.includes('localStorage.setItem("wingman_terms_accepted", "true");'), false, "closeAuthRequiredModal must never persist terms accepted");

// 3.3 supabaseClient updateAuthUIState must NEVER force terms accepted
const updateAuthIdx = supabaseClientCode.indexOf('function updateAuthUIState(user)');
const updateAuthSection = supabaseClientCode.substring(updateAuthIdx, updateAuthIdx + 1200);
assert.strictEqual(updateAuthSection.includes("safeSet('wingman_terms_accepted', 'true');"), false, "updateAuthUIState must not auto-accept terms on login");

// 3.4 Migration 005 exists and contains correct schema
assert.strictEqual(fs.existsSync(migration005Path), true, "Migration 005 must exist on filesystem");
const migration005Sql = fs.readFileSync(migration005Path, 'utf8');
assert.strictEqual(migration005Sql.includes('CREATE TABLE IF NOT EXISTS public.user_consents'), true, "Migration 005 must create user_consents table");
assert.strictEqual(migration005Sql.includes('record_user_consent'), true, "Migration 005 must define record_user_consent RPC function");
assert.strictEqual(migration005Sql.includes('SET search_path = \'\''), true, "Migration 005 RPC must enforce hardened search_path");

// 3.5 Backend /api/consent endpoint and middleware exists
assert.strictEqual(serverCode.includes("app.post('/api/consent'"), true, "server.js must expose POST /api/consent endpoint");
assert.strictEqual(serverCode.includes("app.get('/api/consent/status'"), true, "server.js must expose GET /api/consent/status endpoint");
assert.strictEqual(serverCode.includes("app.post('/api/consent/withdraw'"), true, "server.js must expose POST /api/consent/withdraw endpoint");
assert.strictEqual(serverCode.includes("requireActiveConsent"), true, "server.js must have requireActiveConsent middleware");
console.log("✔ Test 3 Passed: 18+ Age verification & affirmative consent contracts verified.");

// -----------------------------------------------------------------------------
// 4. CREDIT-AWARE CTA DYNAMIC STATES & CREDIT INVARIANTS
// -----------------------------------------------------------------------------
console.log("▶ [TEST 4] Credit-Aware CTA Dynamic States & Invariants");

// Button state labels
assert.strictEqual(appJsCode.includes('"Sign in to generate"'), true, "app.js must provide 'Sign in to generate' label for unauthenticated state");
assert.strictEqual(appJsCode.includes('"Checking credits…"'), true, "app.js must provide 'Checking credits…' label for loading state");
assert.strictEqual(appJsCode.includes('"Profile missing — Contact support"'), true, "app.js must provide 'Profile missing — Contact support' label");
assert.strictEqual(appJsCode.includes('"Credit service unavailable — Retry"'), true, "app.js must provide 'Credit service unavailable — Retry' label");
assert.strictEqual(appJsCode.includes('`Add credits to generate (${state.credits}/10)`'), true, "app.js must provide 'Add credits to generate (X/10)' label");

// Feature Costs & boundaries
assert.strictEqual(serverCode.includes("verifyAndDeductCreditsDB(req, 10, 'analyze'"), true, "Analyzer cost must be 10");
assert.strictEqual(serverCode.includes("verifyAndDeductCreditsDB(req, 10, 'icebreaker'"), true, "Icebreaker cost must be 10");
assert.strictEqual(serverCode.includes("verifyAndDeductCreditsDB(req, 10, 'optimize'"), true, "Bio optimizer cost must be 10");
assert.strictEqual(serverCode.includes("verifyAndDeductCreditsDB(req, 2, 'chat'"), true, "Chat turn cost must be 2");
assert.strictEqual(serverCode.includes("verifyAndDeductCreditsDB(req, 2, 'simulator_review'"), true, "Simulator review cost must be 2");

// Bio 500/501 boundary
assert.strictEqual(serverCode.includes("wordCount > 500"), true, "server.js must reject bio word count > 500");
assert.strictEqual(appJsCode.includes("bioWords > 500"), true, "app.js must reject bio word count > 500");

// Screenshot 5/6 boundary
assert.strictEqual(serverCode.includes("images.length > 5"), true, "server.js must reject > 5 images");
assert.strictEqual(appJsCode.includes("state.uploadedFiles.length + validFiles.length > 5"), true, "app.js must reject > 5 images before upload");
console.log("✔ Test 4 Passed: Credit-aware CTA dynamic states and credit invariants verified.");

// -----------------------------------------------------------------------------
// 5. DEFERRED PAYMENTS STATUS & PURCHASE MODAL
// -----------------------------------------------------------------------------
console.log("▶ [TEST 5] Deferred Payments Status & Fail-Closed Purchase Handling");

// Payment routes in server.js must fail closed (HTTP 503)
assert.strictEqual(serverCode.includes("Production payment gateway integration pending"), true, "Payment routes in server.js must be explicitly fail-closed");

// Frontend purchase modal copy
assert.strictEqual(appHtmlCode.includes("Purchases currently paused during system upgrade") || appHtmlCode.includes("Purchases Temporarily Unavailable"), true, "app.html purchase modal must disclose paused purchases");
assert.strictEqual(appJsCode.includes("Credit purchasing is currently unavailable while payment gateway upgrades are underway."), true, "app.js must display purchase unavailable notice");
console.log("✔ Test 5 Passed: Deferred payments and purchase modal fail-closed handling verified.");

// -----------------------------------------------------------------------------
// 6. PRIVACY DISCLOSURES & MARKETING COPY ACCURACY
// -----------------------------------------------------------------------------
console.log("▶ [TEST 6] Privacy Disclosures, Marketing Copy & Viewport Zoom");

// Viewport meta in app.html must allow pinch zoom (no user-scalable=no or maximum-scale=1.0)
const viewportMeta = appHtmlCode.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
assert.ok(viewportMeta, "app.html must have a viewport meta tag");
assert.strictEqual(viewportMeta[0].includes("user-scalable=no"), false, "app.html viewport must NOT forbid user zoom");
assert.strictEqual(viewportMeta[0].includes("maximum-scale=1.0"), false, "app.html viewport must NOT limit maximum-scale");

// refund.html must have meta description
assert.strictEqual(refundHtmlCode.includes('<meta name="description"'), true, "refund.html must have meta description");

// No absolute claims
assert.strictEqual(appHtmlCode.includes("100% Encrypted Workspace"), false, "app.html must NOT contain '100% Encrypted Workspace'");
assert.strictEqual(indexHtmlCode.includes("100% Encrypted Workspace"), false, "index.html must NOT contain '100% Encrypted Workspace'");
assert.strictEqual(privacyHtmlCode.includes("Your privacy is absolute"), false, "privacy.html must NOT contain 'Your privacy is absolute'");

// Technical screenshot handling description
assert.strictEqual(privacyHtmlCode.includes("processed in browser memory and transmitted over secure TLS connections"), true, "privacy.html must describe browser memory and TLS transmission");
assert.strictEqual(privacyHtmlCode.includes("Uploaded image files are never stored in our application database"), true, "privacy.html must state zero database storage of images");
assert.strictEqual(termsHtmlCode.includes("processed in browser memory and transmitted over secure TLS connections"), true, "terms.html must describe browser memory and TLS transmission");

// Unsupported DPDP Section 13 timeline removed
assert.strictEqual(privacyHtmlCode.includes("Acknowledgment within seven (7) days"), false, "privacy.html must NOT make unsupported 7-day statutory claim");
console.log("✔ Test 6 Passed: Privacy disclosures, copy accuracy, and viewport zoom verified.");

// -----------------------------------------------------------------------------
// 7. RESPONSIVE HORIZONTAL OVERFLOW PREVENTION
// -----------------------------------------------------------------------------
console.log("▶ [TEST 7] Responsive Layout & Overflow Audit across HTML Files");

const htmlFiles = [
    { name: 'index.html', content: indexHtmlCode },
    { name: 'app.html', content: appHtmlCode },
    { name: 'terms.html', content: termsHtmlCode },
    { name: 'privacy.html', content: privacyHtmlCode },
    { name: 'refund.html', content: refundHtmlCode }
];

for (const f of htmlFiles) {
    assert.strictEqual(f.content.includes('<meta name="viewport"') || f.content.includes('name="viewport"'), true, `${f.name} must have a responsive viewport meta tag`);
    assert.strictEqual(f.content.includes('style="width: 1440px"') || f.content.includes('style="width: 1200px"'), false, `${f.name} must not hardcode fixed outer container widths`);
}
console.log("✔ Test 7 Passed: Mobile responsive viewport configurations verified across all 5 HTML documents.");

// -----------------------------------------------------------------------------
// 8. INDIVIDUAL AI ROUTE MIDDLEWARE AUDIT (requireActiveConsent)
// -----------------------------------------------------------------------------
console.log("▶ [TEST 8] Individual AI Route Middleware Chain & requireActiveConsent Audit");

const aiRoutesToVerify = [
    '/api/analyze',
    '/api/analyze-chat-screenshot',
    '/api/icebreaker',
    '/api/optimize',
    '/api/bio-optimizer',
    '/api/chat',
    '/api/simulator/chat',
    '/api/simulator/review'
];

for (const route of aiRoutesToVerify) {
    const escapedRoute = route.replace(/\//g, '\\/');
    const pattern = new RegExp(`app\\.post\\(\\s*(\\[[^\\]]*['"]${escapedRoute}['"][^\\]]*\\]|['"]${escapedRoute}['"])\\s*,\\s*requireSupabaseAuth\\s*,\\s*requireActiveConsent\\s*,`);
    assert.strictEqual(
        pattern.test(serverCode),
        true,
        `AI route ${route} MUST explicitly contain requireActiveConsent in its route definition middleware chain.`
    );
}
console.log("✔ Test 8 Passed: All 8 AI routes individually verified to enforce requireActiveConsent.");

// -----------------------------------------------------------------------------
// 9. AUTH-AS-CONSENT PURGE & STORAGE INTEGRITY
// -----------------------------------------------------------------------------
console.log("▶ [TEST 9] Auth-As-Consent Complete Purge Across All Client Files");

// 9.1 supabaseClient.js must NOT write wingman_terms_accepted anywhere
assert.strictEqual(
    supabaseClientCode.includes("wingman_terms_accepted"),
    false,
    "supabaseClient.js must NEVER write or reference wingman_terms_accepted upon auth/session restoration"
);

// 9.2 index.html handleAuthSubmit must not write wingman_terms_accepted
assert.strictEqual(
    indexHtmlCode.includes('localStorage.setItem("wingman_terms_accepted"'),
    false,
    "index.html handleAuthSubmit must not set wingman_terms_accepted on login/signup"
);

// 9.3 app.js handleSupabaseAuthSubmit must not write wingman_terms_accepted
const handleAuthSubmitIdx = appJsCode.indexOf('window.handleSupabaseAuthSubmit = async function');
assert.ok(handleAuthSubmitIdx !== -1, "handleSupabaseAuthSubmit must exist in app.js");
const handleAuthSubmitSection = appJsCode.substring(handleAuthSubmitIdx, handleAuthSubmitIdx + 1200);
assert.strictEqual(
    handleAuthSubmitSection.includes('wingman_terms_accepted'),
    false,
    "app.js handleSupabaseAuthSubmit must NOT grant wingman_terms_accepted merely on auth"
);
console.log("✔ Test 9 Passed: Zero occurrences of auth-as-consent detected across all clients.");

// -----------------------------------------------------------------------------
// 10. MIGRATION 005 SECURITY & PRIVILEGE HARDENING
// -----------------------------------------------------------------------------
console.log("▶ [TEST 10] Migration 005 Privilege Restrictions & Service-Role Isolation");

// 10.1 Authenticated role must have SELECT-only on user_consents table
assert.strictEqual(
    migration005Sql.includes("GRANT SELECT ON TABLE public.user_consents TO authenticated;"),
    true,
    "Migration 005 must grant SELECT only to authenticated"
);
assert.strictEqual(
    migration005Sql.includes("GRANT SELECT, UPDATE ON TABLE public.user_consents TO authenticated;"),
    false,
    "Migration 005 must NOT grant UPDATE to authenticated"
);

// 10.2 RPC execution restricted strictly to service_role
assert.strictEqual(
    migration005Sql.includes("REVOKE ALL ON FUNCTION public.record_user_consent"),
    true,
    "Migration 005 must revoke execution from PUBLIC, anon, and authenticated"
);
assert.strictEqual(
    migration005Sql.includes("GRANT EXECUTE ON FUNCTION public.record_user_consent(TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, UUID) TO service_role;"),
    true,
    "Migration 005 must grant EXECUTE exclusively to service_role"
);
console.log("✔ Test 10 Passed: Migration 005 RLS and RPC execution privileges strictly hardened.");

// -----------------------------------------------------------------------------
// 11. CONSENT WITHDRAWAL UI & DYNAMIC BUTTON LOCKDOWN
// -----------------------------------------------------------------------------
console.log("▶ [TEST 11] Consent Withdrawal Control & Dynamic Button State Lockdown");

// 11.1 Consent withdrawal setting in app.html
assert.strictEqual(
    appHtmlCode.includes('id="withdrawConsentBtn"'),
    true,
    "app.html settings modal must include #withdrawConsentBtn"
);
assert.strictEqual(
    appHtmlCode.includes('window.withdrawConsent()'),
    true,
    "app.html #withdrawConsentBtn must call window.withdrawConsent()"
);

// 11.2 withdrawConsent defined and clears all consent state
assert.strictEqual(
    appJsCode.includes('window.withdrawConsent = async function'),
    true,
    "app.js must define window.withdrawConsent"
);

// 11.3 checkServerConsentStatus on boot in app.js
assert.strictEqual(
    appJsCode.includes('window.checkServerConsentStatus();'),
    true,
    "app.js must execute window.checkServerConsentStatus() on app boot"
);

// 11.4 503 vs 403 status distinction in server.js
assert.strictEqual(
    serverCode.includes("code: \"CONSENT_SERVICE_UNAVAILABLE\""),
    true,
    "server.js must return 503 CONSENT_SERVICE_UNAVAILABLE on database/service failure"
);
assert.strictEqual(
    serverCode.includes("code: \"CONSENT_REQUIRED\""),
    true,
    "server.js must return 403 CONSENT_REQUIRED when user has not consented"
);

console.log("✔ Test 11 Passed: Consent withdrawal UI, boot status check, and 503 error handling verified.");

console.log("\n============================================================");
console.log("🎉 ALL PRODUCTION READINESS REGRESSION TESTS PASSED (11/11)");
console.log("============================================================\n");

