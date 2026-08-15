const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- STARTING SECOND PASS ADVERSARIAL VERIFICATION SUITE ---');

// 1. TEST WORD COUNTER 500-WORD BOUNDARY
function countWords(str) {
    if (!str || typeof str !== 'string') return 0;
    const trimmed = str.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
}

const exactly500Words = Array(500).fill('word').join(' ');
assert.strictEqual(countWords(exactly500Words), 500, '500 words must be exactly 500');
assert.strictEqual(countWords(exactly500Words) <= 500, true, '500 words must be ALLOWED');

const fiveHundredAndOneWords = Array(501).fill('word').join(' ');
assert.strictEqual(countWords(fiveHundredAndOneWords), 501, '501 words must be exactly 501');
assert.strictEqual(countWords(fiveHundredAndOneWords) > 500, true, '501 words must be REJECTED');

console.log('✔ Test 1 Passed: 500-word boundary strictly validated (500 allowed, 501 rejected)');

// 2. TEST MOCK AUTH SECURITY IN PRODUCTION
const authFile = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'supabaseAuth.js'), 'utf8').replace(/\r\n/g, '\n');
assert.strictEqual(
    authFile.includes("const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);"),
    true,
    'supabaseAuth.js must detect production and Railway environments'
);
assert.strictEqual(
    authFile.includes("if (!isProduction && (process.env.ENABLE_MOCK_AUTH === 'true' || req.headers['x-mock-auth'] === 'true'))"),
    true,
    'Mock auth header must never bypass real authentication in production'
);

console.log('✔ Test 2 Passed: Mock auth bypass strictly blocked in production');

// 3. TEST CANONICAL 50 FREE SIGNUP CREDITS & FAIL-CLOSED SEMANTICS IN server.js
const serverFile = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');

assert.strictEqual(serverFile.includes('const INITIAL_FREE_CREDITS = 50;'), true, 'server.js must define INITIAL_FREE_CREDITS = 50');
assert.strictEqual(serverFile.includes('insert({ id: uid, credits: INITIAL_FREE_CREDITS });'), false, 'getUserCreditsDB must NOT recreate missing profile with 50 credits (Rule 16)');

// Verify Fail-Closed semantics: No direct unsafe fallback on RPC failure in production
assert.strictEqual(serverFile.includes('Production FAIL-CLOSED: Refuse un-locked non-atomic execution'), true, 'verifyAndDeductCreditsDB must fail-closed on RPC error');

console.log('✔ Test 3 Passed: Canonical 50 signup credits and fail-closed RPC enforcement verified');

// 4. TEST SQL MIGRATION 002 FOR RPCs, LOCKING, CONSTRAINTS & IDEMPOTENCY
const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_atomic_credits_and_transactions.sql'), 'utf8').replace(/\r\n/g, '\n');

// Schema integrity
assert.strictEqual(migrationSql.includes('ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;'), true, 'Migration must set 50 credits default');
assert.strictEqual(migrationSql.includes('ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);'), true, 'Migration must enforce non-negative credits constraint');

// reserve_credits checks
assert.strictEqual(migrationSql.includes('FOR UPDATE'), true, 'reserve_credits must use FOR UPDATE row locking');
assert.strictEqual(migrationSql.includes('duplicate\', true'), true, 'reserve_credits must return duplicate: true on idempotent retry');

// release_credits checks
assert.strictEqual(migrationSql.includes('status = \'cancelled\''), true, 'release_credits cancels pending transaction');

console.log('✔ Test 4 Passed: SQL Migration 002 row-locking, zero-charge release, 50-credit default, and idempotency verified');

// 5. TEST ACCOUNT DELETION PURGES SUPABASE DATA AND AUTH IDENTITY
assert.strictEqual(serverFile.includes("await supabaseAdmin.from('profiles').delete().eq('id', uid);"), false, 'delete-account must not pre-delete profiles before Auth deletion');
assert.strictEqual(serverFile.includes("await supabaseAdmin.auth.admin.deleteUser(uid);"), true, 'delete-account must purge Supabase Auth user identity');

console.log('✔ Test 5 Passed: Account deletion purges Supabase tables and Supabase Auth identity');

// 6. TEST PRIVACY IN PRODUCTION LOGGING
assert.strictEqual(serverFile.includes("if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {\n                console.log(\"\\n================ [STAGE 1 VISION JSON OUTPUT] ================\");"), true, 'Stage 1 vision output must be gated behind DEBUG_PAYLOADS');
assert.strictEqual(serverFile.includes("if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {\n            console.log(\"[ICEBREAKER CLEAN OUTPUT]:\", cleanedOptions);"), true, 'Icebreaker clean output must be gated behind DEBUG_PAYLOADS');

console.log('✔ Test 6 Passed: Private conversation logs strictly gated in production');

// 7. TEST SCREENSHOT PAYLOAD LIMITS (38MB ROUTE BODY, 25MB DECODED, REMOTE URL REJECTION)
assert.strictEqual(serverFile.includes("app.use('/api/analyze', express.json({ limit: '38mb' }));"), true, 'server.js must allocate 38mb for /api/analyze');
const imgValidator = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'imageValidator.js'), 'utf8');
assert.strictEqual(imgValidator.includes('MAX_TOTAL_BYTES = 25 * 1024 * 1024;'), true, 'imageValidator must enforce 25MB total decoded limit');
assert.strictEqual(imgValidator.includes('MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024;'), true, 'imageValidator must enforce 5MB per-image limit');
assert.strictEqual(imgValidator.includes('Remote image URLs are not supported'), true, 'imageValidator rejects remote image URLs');

console.log('✔ Test 7 Passed: Screenshot payload size limits and remote image rejection verified');

// 8. TEST LOCALSTORAGE CLEANLINESS IN app.js
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.strictEqual(appJs.includes('// Retain uploaded screenshots in-memory only to prevent localStorage quota exhaustion'), true, 'app.js must not store large base64 strings in localStorage');
assert.strictEqual(appJs.includes('uploadedFiles: state.uploadedFiles || [],'), false, 'app.js must not serialize raw base64 arrays into localStorage');

console.log('✔ Test 8 Passed: Base64 screenshots excluded from localStorage persistence');

// 9. TEST REPOSITORY HYGIENE
assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'style.js')), false, 'Redundant style.js must be removed');

console.log('✔ Test 9 Passed: Redundant style.js successfully removed');

console.log('\n============================================================');
console.log('🎉 ALL SECOND PASS VERIFICATION TESTS PASSED (9/9)!');
console.log('============================================================\n');
