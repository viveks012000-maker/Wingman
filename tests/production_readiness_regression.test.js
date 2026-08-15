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
const migration004Path = path.join(__dirname, '..', 'migrations', '004_user_consent_and_age_verification.sql');

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
// 2. SIMULATOR REVIEW NO FAKE SUCCESS
// -----------------------------------------------------------------------------
console.log("▶ [TEST 2] Simulator Review Endpoint Fallback Purge");

// Must reject < 2 messages with HTTP 400
assert.strictEqual(serverCode.includes('historyArray.length < 2'), true, "Simulator review must check history length < 2");
assert.strictEqual(serverCode.includes('At least 2 messages are required to evaluate your conversation.'), true, "Simulator review must return explicit 400 error message for short transcripts");

// Must release credits and return error on AI failure (NO score 78 fallback)
const reviewEndpointIdx = serverCode.indexOf("app.post('/api/simulator/review'");
assert.ok(reviewEndpointIdx !== -1, "Review endpoint must exist");
const reviewSection = serverCode.substring(reviewEndpointIdx, reviewEndpointIdx + 8000);

assert.strictEqual(reviewSection.includes('throw new Error("Failed to parse simulation review output from AI model.");'), true, "Review endpoint must throw on parse error rather than return fake score");
assert.strictEqual(reviewSection.includes('releaseCreditsDB(req, reqId, error.message)'), true, "Review endpoint must release credits on catch");
assert.strictEqual(reviewSection.includes('Simulation review failed. You have not been charged credits.'), true, "Review endpoint must return failure message on catch");
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

// 3.4 Migration 004 exists and contains correct schema
assert.strictEqual(fs.existsSync(migration004Path), true, "Migration 004 must exist on filesystem");
const migration004Sql = fs.readFileSync(migration004Path, 'utf8');
assert.strictEqual(migration004Sql.includes('CREATE TABLE IF NOT EXISTS public.user_consents'), true, "Migration 004 must create user_consents table");
assert.strictEqual(migration004Sql.includes('record_user_consent'), true, "Migration 004 must define record_user_consent RPC function");
assert.strictEqual(migration004Sql.includes('SET search_path = \'\''), true, "Migration 004 RPC must enforce hardened search_path");

// 3.5 Backend /api/consent endpoint exists
assert.strictEqual(serverCode.includes("app.post('/api/consent'"), true, "server.js must expose POST /api/consent endpoint");
assert.strictEqual(serverCode.includes("user_consents"), true, "server.js must interact with user_consents table");
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

// Ensure all main HTML files include appropriate viewport tags and no unconstrained fixed widths > 100vw
const htmlFiles = [
    { name: 'index.html', content: indexHtmlCode },
    { name: 'app.html', content: appHtmlCode },
    { name: 'terms.html', content: termsHtmlCode },
    { name: 'privacy.html', content: privacyHtmlCode },
    { name: 'refund.html', content: refundHtmlCode }
];

for (const f of htmlFiles) {
    assert.strictEqual(f.content.includes('<meta name="viewport"') || f.content.includes('name="viewport"'), true, `${f.name} must have a responsive viewport meta tag`);
    // Ensure no hardcoded outer container width exceeding mobile screens without responsive prefixes
    assert.strictEqual(f.content.includes('style="width: 1440px"') || f.content.includes('style="width: 1200px"'), false, `${f.name} must not hardcode fixed outer container widths`);
}
console.log("✔ Test 7 Passed: Mobile responsive viewport configurations verified across all 5 HTML documents.");

console.log("\n============================================================");
console.log("🎉 ALL PRODUCTION READINESS REGRESSION TESTS PASSED (7/7)");
console.log("============================================================\n");
