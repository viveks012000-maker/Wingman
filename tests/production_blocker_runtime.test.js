const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'vendor', 'production-runtime.js'), 'utf8').replace(/\r\n/g, '\n');
const accessibility = fs.readFileSync(path.join(root, 'accessibility.js'), 'utf8').replace(/\r\n/g, '\n');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// Syntax must be valid before this can reach production.
new Function(runtime);
new Function(accessibility);

// The existing public artifact already copies vendor/ recursively. accessibility.js is loaded
// after app.js, so it is a safe bootstrap point for the isolated production runtime.
assert(accessibility.includes("script.src = 'vendor/production-runtime.js'"), 'accessibility.js must load the production runtime module.');
assert(accessibility.includes('data-wingman-production-runtime'), 'runtime loader must be idempotent.');

// Password recovery: follow the current documented Supabase JavaScript flow.
assert(runtime.includes("event === 'PASSWORD_RECOVERY'"), 'runtime must handle the Supabase PASSWORD_RECOVERY auth event.');
assert(runtime.includes('auth.updateUser') || runtime.includes('auth.updateUser({ password:'), 'runtime must update the authenticated recovery user password.');
assert(runtime.includes("searchParams.get('type') === 'recovery'"), 'runtime must recover even if the auth event fired before the extension attached.');
assert(runtime.includes("searchParams.delete('type')"), 'successful recovery must remove the recovery query marker.');

// Landing Forgot Password already exists in source. Guard both its source presence and the
// defensive runtime fallback so a script-order regression cannot turn the button into a no-op.
assert(indexHtml.includes('window.showForgotPasswordView = function'), 'landing page must retain its primary forgot-password view handler.');
assert(indexHtml.includes('window.handleResetPassword = async function'), 'landing page must retain its reset-email handler.');
assert(runtime.includes('installForgotPasswordFallback'), 'production runtime must include the defensive forgot-password fallback.');

// Account deletion must use the same fresh Supabase bearer-token helper as other protected flows.
assert(runtime.includes("typeof window.getSupabaseAuthHeaders"), 'deletion repair must use the canonical Supabase auth header helper.');
assert(runtime.includes("headers.Authorization"), 'deletion repair must fail closed when no bearer token is available.');
assert(runtime.includes("'/api/user/delete-account'"), 'deletion repair must call the existing protected delete-account endpoint.');
assert(!runtime.includes('getSupabaseAccessToken'), 'runtime must not reintroduce the undefined getSupabaseAccessToken helper.');

// Simulator Review must be reachable and must use the protected 2-credit backend endpoint.
assert(runtime.includes("'/api/simulator/review'"), 'runtime must call the simulator review endpoint.');
assert(runtime.includes('Finish & Review · 2 Credits'), 'simulator must expose a visible review action with its exact credit cost.');
assert(runtime.includes('X-Idempotency-Key'), 'review requests must carry an idempotency key.');
assert(runtime.includes('sessionHistory: history'), 'review requests must send bounded session history.');
assert(runtime.includes('messages.slice(-50)'), 'DOM-derived simulator history must be capped at 50 messages.');
assert(runtime.includes('window.updateUICredits(data.credits)'), 'successful review must synchronize authoritative remaining credits.');
assert(runtime.includes('textContent = data[key]'), 'AI-generated review fields must render through textContent rather than an HTML sink.');

// The broken source references are intentionally overridden at runtime; keep this assertion to
// ensure the repair remains necessary/visible until app.js is eventually refactored.
assert(appJs.includes('window.getSupabaseAccessToken ? window.getSupabaseAccessToken() : null'), 'expected legacy deletion defect anchor changed; review the repair instead of silently weakening this test.');
assert(appJs.includes('if (window.triggerFinishAndReview) window.triggerFinishAndReview();'), 'expected legacy simulator review anchor changed; review the repair instead of silently weakening this test.');

console.log('✅ Production blocker runtime regression guard passed.');
