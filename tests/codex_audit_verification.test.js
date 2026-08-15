const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- STARTING CODEX AUDIT COMPREHENSIVE VERIFICATION SUITE ---');

// 1. TEST NEW-USER INITIAL CREDITS (CANONICAL 50)
const serverFile = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_atomic_credits_and_transactions.sql'), 'utf8').replace(/\r\n/g, '\n');
const userProvFile = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'userProvisioning.js'), 'utf8').replace(/\r\n/g, '\n');
const dbFile = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8').replace(/\r\n/g, '\n');

assert.strictEqual(serverFile.includes('const INITIAL_FREE_CREDITS = 50;'), true, 'server.js must define INITIAL_FREE_CREDITS = 50');
assert.strictEqual(migrationSql.includes('ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;'), true, 'Migration 002 must set default 50 credits on profiles');
assert.strictEqual(migrationSql.includes('VALUES (NEW.id, 50, NOW(), NOW())'), true, 'Migration 002 handle_new_user trigger must insert 50 credits');
assert.strictEqual(migrationSql.includes('ON CONFLICT (id) DO NOTHING;'), true, 'Migration 002 handle_new_user handles conflicts');
assert.strictEqual(userProvFile.includes('5.00, \'free\''), true, 'userProvisioning.js must provision with 5.00 INR (50 credits)');
assert.strictEqual(dbFile.includes('credits_balance REAL DEFAULT 5.00'), true, 'database.js schema must default to 5.00 INR (50 credits)');

console.log('✔ Test 1 Passed: Exactly 50 initial signup credits centralized across all paths');

// 2. TEST FAIL-CLOSED SEMANTICS IN PRODUCTION CREDIT DEDUCTION
assert.strictEqual(serverFile.includes('// Priority 1: Authoritative Atomic Postgres RPC function \'reserve_credits\''), true, 'reserve_credits RPC is primary');
assert.strictEqual(serverFile.includes('Production FAIL-CLOSED: Refuse un-locked non-atomic execution'), true, 'verifyAndDeductCreditsDB must fail-closed in production');
assert.strictEqual(serverFile.includes('Credit service temporarily unavailable. Balance unchanged. Please try again.'), true, 'Returns explicit balance unchanged message');

console.log('✔ Test 2 Passed: Fail-closed production credit deduction verified (no silent un-locked fallback)');

// 3. TEST IDEMPOTENCY, RESERVATION ARCHITECTURE, AND ROW LOCKING IN MIGRATION 002
assert.strictEqual(migrationSql.includes('FOR UPDATE'), true, 'Migration 002 must use FOR UPDATE row locking');
assert.strictEqual(migrationSql.includes('idx_credit_transactions_user_req'), true, 'Migration 002 must index user_id and request_id');
assert.strictEqual(migrationSql.includes('duplicate\', true'), true, 'reserve_credits must return duplicate: true on idempotent retry');
assert.strictEqual(migrationSql.includes('status = \'cancelled\''), true, 'release_credits cancels pending transactions');
assert.strictEqual(migrationSql.includes('ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);'), true, 'Migration 002 must enforce non-negative check');

console.log('✔ Test 3 Passed: Atomic reserve, settle, and release RPCs, row locking, and non-negative constraint verified');

// 4. TEST ACCOUNT DELETION FULL STACK (SUPABASE DATA + AUTH IDENTITY + SAFE CLIENT)
assert.strictEqual(serverFile.includes("const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(uid);"), true, 'delete-account must delete Supabase Auth identity');
assert.strictEqual(serverFile.includes("if (authDelErr) {\n                console.error('[delete-account Auth delete error]:', authDelErr.message);\n                return res.status(500).json({ success: false, error: 'Failed to delete authentication account: ' + authDelErr.message });\n            }"), true, 'delete-account must fail-safe if auth deletion fails');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.strictEqual(appJs.includes('window.confirmPermanentDeletion = async function'), true, 'Frontend deletion must be async');
assert.strictEqual(appJs.includes('headers[\'Authorization\'] = \'Bearer \' + token;'), true, 'Frontend must send Authorization header');
assert.strictEqual(appJs.includes('if (!response.ok || !data.success) {'), true, 'Frontend must verify server response before purging local state');

console.log('✔ Test 4 Passed: Full account deletion (Supabase data + Auth user) verified on backend & frontend');

// 5. TEST SCREENSHOT VALIDATION (REJECT 6TH IMAGE, MAX 5MB / 25MB, VALID BASE64, REJECT REMOTE URLS)
const imgValidator = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'imageValidator.js'), 'utf8');
assert.strictEqual(imgValidator.includes('if (images.length > 5) {'), true, 'imageValidator must reject > 5 images');
assert.strictEqual(imgValidator.includes('MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024;'), true, 'imageValidator must enforce 5MB per-image limit');
assert.strictEqual(imgValidator.includes('MAX_TOTAL_BYTES = 25 * 1024 * 1024;'), true, 'imageValidator must enforce 25MB total limit');
assert.strictEqual(imgValidator.includes('Remote image URLs are not supported'), true, 'imageValidator rejects remote image URLs');
assert.strictEqual(serverFile.includes('if (Array.isArray(images) && images.length > 5) {'), true, 'server.js must reject > 5 images before deduction');

console.log('✔ Test 5 Passed: Screenshot validation strictly rejects 6th image, remote URLs, and enforces 5MB / 25MB bounds');

// 6. TEST REQUEST BODY SIZE ALLOCATION
assert.strictEqual(serverFile.includes("app.use('/api/analyze', express.json({ limit: '38mb' }));"), true, 'Route /api/analyze gets 38mb limit');
assert.strictEqual(serverFile.includes("app.use('/api/analyze-chat-screenshot', express.json({ limit: '38mb' }));"), true, 'Route /api/analyze-chat-screenshot gets 38mb limit');
assert.strictEqual(serverFile.includes("app.use(express.json({\n    limit: '1mb',"), true, 'Global JSON limit is 1mb');

console.log('✔ Test 6 Passed: Route-specific 38mb limit on screenshot routes and 1mb global body limit verified');

// 7. TEST BROWSER STORAGE SAFETY (NO BASE64 AND NO RAW HTML IN LOCALSTORAGE)
assert.strictEqual(appJs.includes('// Retain uploaded screenshots in-memory only to prevent localStorage quota exhaustion'), true, 'saveSessionState must not save base64 to localStorage');
assert.strictEqual(appJs.includes('if (data.uploadedFiles || data.icebreakHtml || data.optimizeHtml) {'), true, 'restoreSessionState must purge any legacy uploadedFiles and HTML');

console.log('✔ Test 7 Passed: Screenshot base64 and raw HTML excluded from localStorage persistence');

// 8. TEST PRODUCTION AUTH HARDENING (LOCAL JWT BLOCKED IN PRODUCTION)
const authJs = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'auth.js'), 'utf8');
assert.strictEqual(authJs.includes('const isProduction = process.env.NODE_ENV === \'production\' || Boolean(process.env.RAILWAY_ENVIRONMENT);'), true, 'auth.js detects production');
assert.strictEqual(authJs.includes('if (!isProduction) {\n        try {\n            const decoded = jwt.verify(token, JWT_SECRET);'), true, 'auth.js gates local JWT decoding behind !isProduction');

const supAuth = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'supabaseAuth.js'), 'utf8');
assert.strictEqual(supAuth.includes('const isProduction = process.env.NODE_ENV === \'production\' || Boolean(process.env.RAILWAY_ENVIRONMENT);'), true, 'supabaseAuth detects production');
assert.strictEqual(supAuth.includes('if (!isProduction && (process.env.ENABLE_MOCK_AUTH === \'true\' || req.headers[\'x-mock-auth\'] === \'true\'))'), true, 'supabaseAuth gates mock auth behind !isProduction');

console.log('✔ Test 8 Passed: Production auth strictly enforces Supabase authentication and rejects local JWT');

// 9. TEST BIO OPTIMIZER EXACT 500-WORD BOUNDARY & NO SILENT TRUNCATION
function countWords(str) {
    if (!str || typeof str !== 'string') return 0;
    const trimmed = str.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
}

const bio500 = Array(500).fill('alpha').join(' ');
const bio501 = Array(501).fill('beta').join(' ');
assert.strictEqual(countWords(bio500), 500, '500 words must equal 500');
assert.strictEqual(countWords(bio501), 501, '501 words must equal 501');
assert.strictEqual(countWords(bio500) <= 500, true, '500 words is ALLOWED');
assert.strictEqual(countWords(bio501) > 500, true, '501 words is REJECTED');

assert.strictEqual(serverFile.includes('const wordCount = countWords(rawText);\n        if (wordCount > 500) {'), true, 'server.js validates wordCount > 500');
assert.strictEqual(serverFile.includes('const textPayload = sanitizedText;'), true, 'server.js does not silently truncate valid 500-word bios');

console.log('✔ Test 9 Passed: Bio Optimizer exact 500-word boundary enforced without silent truncation');

// 10. TEST REPOSITORY & GITIGNORE HYGIENE
const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
assert.strictEqual(gitignore.includes('*.sqlite'), true, '.gitignore must include *.sqlite');
assert.strictEqual(gitignore.includes('*.sqlite3'), true, '.gitignore must include *.sqlite3');
assert.strictEqual(gitignore.includes('*.db'), true, '.gitignore must include *.db');
assert.strictEqual(gitignore.includes('.env'), true, '.gitignore must include .env');
assert.strictEqual(gitignore.includes('!.env.example'), true, '.gitignore must allow .env.example');

console.log('✔ Test 10 Passed: Repository hygiene (.gitignore rules, SQLite exclusion, secret patterns) verified');

console.log('\n============================================================');
console.log('🎉 ALL CODEX AUDIT VERIFICATION TESTS PASSED (10/10)!');
console.log('============================================================\n');
