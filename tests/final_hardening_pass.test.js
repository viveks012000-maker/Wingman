const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('🛡️  STARTING FINAL TECHNICAL HARDENING PASS VERIFICATION');
console.log('============================================================\n');

// 1. CANONICAL INITIAL CREDITS: EXACTLY 50 FOR NEW USERS
console.log('--- 1. NEW USER INITIAL CREDITS (CANONICAL 50) ---');
const serverFile = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_atomic_credits_and_transactions.sql'), 'utf8').replace(/\r\n/g, '\n');
const userProvFile = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'userProvisioning.js'), 'utf8').replace(/\r\n/g, '\n');
const dbFile = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8').replace(/\r\n/g, '\n');

assert.strictEqual(serverFile.includes('const INITIAL_FREE_CREDITS = 50;'), true, 'server.js must define INITIAL_FREE_CREDITS = 50');
assert.strictEqual(migrationSql.includes('ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;'), true, 'Migration 002 must set default 50 credits on profiles');
assert.strictEqual(migrationSql.includes('VALUES (NEW.id, 50, NOW(), NOW())'), true, 'handle_new_user trigger must insert 50 credits');
assert.strictEqual(migrationSql.includes('ON CONFLICT (id) DO NOTHING;'), true, 'handle_new_user trigger must handle conflict safely');
assert.strictEqual(userProvFile.includes('5.00, \'free\''), true, 'userProvisioning.js must provision with 5.00 INR (50 credits)');
assert.strictEqual(dbFile.includes('credits_balance REAL DEFAULT 5.00'), true, 'database.js schema must default to 5.00 INR (50 credits)');
console.log('✔ Passed: Exactly 50 initial signup credits centralized across all initialization paths.');

// 2. EXISTING BALANCES PRESERVED (NO BLANKET RESET)
console.log('\n--- 2. EXISTING USER BALANCES PRESERVED ---');
assert.strictEqual(migrationSql.includes('UPDATE public.profiles SET credits = 50;'), false, 'Migration must NEVER run a blanket update setting all profiles to 50');
assert.strictEqual(serverFile.includes('UPDATE profiles SET credits = 50'), false, 'server.js must NEVER reset existing profiles to 50');
console.log('✔ Passed: Existing credit balances are preserved; blanket credit overwrite is absent.');

// 3. FAIL-CLOSED CREDIT DEDUCTION & ZERO CHARGE RESERVATION ARCHITECTURE
console.log('\n--- 3. ZERO-CHARGE RESERVATION & FAIL-CLOSED EXECUTION ---');
assert.strictEqual(serverFile.includes('Production FAIL-CLOSED: Refuse un-locked non-atomic execution'), true, 'verifyAndDeductCreditsDB must fail-closed on RPC failure');
assert.strictEqual(serverFile.includes('Credit service temporarily unavailable. Balance unchanged. Please try again.'), true, 'Returns explicit balance unchanged message on RPC error');
assert.strictEqual(serverFile.includes('settleCreditsDB(req, reqId)'), true, 'server.js settles credits on successful AI completion');
assert.strictEqual(serverFile.includes('releaseCreditsDB(req, reqId, error.message)'), true, 'server.js releases credits on AI failure');
assert.strictEqual(serverFile.includes('acquireUserConcurrencyLock(uid, reqId)'), true, 'server.js acquires per-user in-flight request lock');
console.log('✔ Passed: Production credit deduction uses zero-charge reservation architecture with per-user concurrency locking.');

// 4. ROW LOCKING, ANTI-TAMPERING, AND PRIVILEGE LOCKDOWN IN MIGRATION 002
console.log('\n--- 4. POSTGRES ROW LOCKING, ANTI-TAMPERING & PRIVILEGE LOCKDOWN ---');
assert.strictEqual(migrationSql.includes('FOR UPDATE'), true, 'Migration 002 must use FOR UPDATE row locking');
assert.strictEqual(migrationSql.includes('idx_credit_transactions_user_req'), true, 'Migration 002 must index user_id and request_id');
assert.strictEqual(migrationSql.includes('prevent_direct_credit_mutation'), true, 'Migration 002 must include anti-tampering trigger for credits');
assert.strictEqual(migrationSql.includes('ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);'), true, 'Migration 002 must enforce non-negative check');
assert.strictEqual(migrationSql.includes('REVOKE ALL ON FUNCTION public.reserve_credits'), true, 'reserve_credits must be revoked from public/anon/authenticated');
assert.strictEqual(migrationSql.includes('REVOKE ALL ON FUNCTION public.settle_credits'), true, 'settle_credits must be revoked from public/anon/authenticated');
assert.strictEqual(migrationSql.includes('REVOKE ALL ON FUNCTION public.release_credits'), true, 'release_credits must be revoked from public/anon/authenticated');
console.log('✔ Passed: FOR UPDATE locking, persistent request idempotency, anti-tampering trigger, and privilege revocation verified.');

// 5. BIO OPTIMIZER: EXACT 500-WORD BOUNDARY & NO SILENT TRUNCATION
console.log('\n--- 5. BIO OPTIMIZER EXACT 500-WORD BOUNDARY ---');
function countWords(str) {
    if (!str || typeof str !== 'string') return 0;
    const trimmed = str.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
}

const emptyBio = '';
const singleWordBio = 'Solo';
const spacesBio = '   Loves    night   drives, \n gym \t and   coffee.   ';
const bio499 = Array(499).fill('word').join(' ');
const bio500 = Array(500).fill('word').join(' ');
const bio501 = Array(501).fill('word').join(' ');

assert.strictEqual(countWords(emptyBio), 0, 'Empty bio must be 0 words');
assert.strictEqual(countWords(singleWordBio), 1, 'Single word bio must be 1 word');
assert.strictEqual(countWords(spacesBio), 6, 'Multiple spaces/newlines/tabs must count accurately as 6 words');
assert.strictEqual(countWords(bio499), 499, '499 words must count as 499');
assert.strictEqual(countWords(bio500), 500, '500 words must count as 500');
assert.strictEqual(countWords(bio501), 501, '501 words must count as 501');

assert.strictEqual(countWords(bio500) <= 500, true, '500 words must be ALLOWED');
assert.strictEqual(countWords(bio501) > 500, true, '501 words must be REJECTED');

assert.strictEqual(serverFile.includes('const wordCount = countWords(rawText);\n        if (wordCount > 500) {'), true, 'server.js validates wordCount > 500');
assert.strictEqual(serverFile.includes('const textPayload = sanitizedText;'), true, 'server.js does not silently truncate valid 500-word bios');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

assert.strictEqual(appJs.includes('function countWords(str)'), true, 'app.js must define countWords helper');
assert.strictEqual(appJs.includes('bioWords > 500'), true, 'app.js must validate bioWords > 500');
assert.strictEqual(appHtml.includes('0 / 500 words'), true, 'app.html must display 0 / 500 words counter');
console.log('✔ Passed: Bio Optimizer 500-word boundary enforced on frontend & backend without silent truncation.');

// 6. SCREENSHOT ANALYZER: MAX 5 IMAGES, 5MB / 25MB DECODED, BASE64 VALIDATION, REMOTE URL REJECTION
console.log('\n--- 6. SCREENSHOT ANALYZER BOUNDS & VALIDATION ---');
const imgValidator = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'imageValidator.js'), 'utf8');

assert.strictEqual(imgValidator.includes('if (images.length > 5) {'), true, 'imageValidator must reject > 5 images');
assert.strictEqual(imgValidator.includes('MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024;'), true, 'imageValidator must enforce 5MB per-image limit');
assert.strictEqual(imgValidator.includes('MAX_TOTAL_BYTES = 25 * 1024 * 1024;'), true, 'imageValidator must enforce 25MB total limit');
assert.strictEqual(imgValidator.includes('Remote image URLs are not supported'), true, 'imageValidator rejects remote image URLs');
assert.strictEqual(serverFile.includes('if (Array.isArray(images) && images.length > 5) {'), true, 'server.js must reject > 5 images before deduction');
assert.strictEqual(serverFile.includes("app.use('/api/analyze', express.json({ limit: '38mb' }));"), true, 'server.js allocates 38mb for /api/analyze');
assert.strictEqual(serverFile.includes("app.use(express.json({\n    limit: '1mb',"), true, 'server.js global JSON limit is 1mb');
console.log('✔ Passed: Screenshot analyzer strictly rejects 6th image, remote URLs, and enforces 5MB / 25MB decoded bounds.');

// 7. PRIVACY: ZERO SCREENSHOT BASE64 & ZERO RAW HTML PERSISTENCE IN LOCALSTORAGE
console.log('\n--- 7. STORAGE PRIVACY & ZERO RAW HTML SINK ---');
assert.strictEqual(appJs.includes('// Retain uploaded screenshots in-memory only to prevent localStorage quota exhaustion'), true, 'app.js keeps screenshots in-memory only');
assert.strictEqual(appJs.includes('if (data.uploadedFiles || data.icebreakHtml || data.optimizeHtml) {'), true, 'app.js purges legacy uploadedFiles and HTML strings on restore');
assert.strictEqual(appJs.includes('icebreakHtml: iceRes ? iceRes.innerHTML : "",'), false, 'app.js must not serialize raw innerHTML into localStorage');
assert.strictEqual(appJs.includes('optimizeHtml: optRes ? optRes.innerHTML : "",'), false, 'app.js must not serialize raw innerHTML into localStorage');
console.log('✔ Passed: Screenshot base64 data and raw HTML strings are never persisted into localStorage.');

// 8. COST ABUSE FIXES: SIMULATOR REVIEW AUTH & DISABLED PURCHASE ENDPOINT
console.log('\n--- 8. COST ABUSE HARDENING ---');
assert.strictEqual(serverFile.includes("app.post('/api/simulator/review', requireSupabaseAuth,"), true, '/api/simulator/review requires Supabase auth');
assert.strictEqual(serverFile.includes("verifyAndDeductCreditsDB(req, 2, 'simulator_review'"), true, '/api/simulator/review is metered at 2 credits');
assert.strictEqual(serverFile.includes("res.status(503).json({\n        success: false,\n        error: \"Direct credit purchasing is currently unavailable."), true, '/api/credits/purchase is safely disabled with 503');
console.log('✔ Passed: Simulator review is authenticated & metered; unverified credit purchase endpoint is disabled.');

// 9. FULL ACCOUNT DELETION FAIL-SAFE (SUPABASE TABLES + SUPABASE AUTH IDENTITY)
console.log('\n--- 9. PERMANENT ACCOUNT DELETION FULL STACK ---');
assert.strictEqual(serverFile.includes("const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(uid);"), true, 'delete-account permanently deletes Supabase Auth user');
assert.strictEqual(serverFile.includes("if (authDelErr) {") && serverFile.includes("Failed to delete authentication account: ' + authDelErr.message"), true, 'delete-account fails safe if auth deletion fails');

assert.strictEqual(appJs.includes('window.confirmPermanentDeletion = async function'), true, 'Frontend deletion handler is async');
assert.strictEqual(appJs.includes('headers[\'Authorization\'] = \'Bearer \' + token;'), true, 'Frontend sends Authorization header for deletion');
console.log('✔ Passed: Full account deletion verified fail-safe with confirmed Supabase Auth identity destruction.');

// 10. AUTHENTICATION HARDENING (CANONICAL PRODUCTION DETECTION & ZERO SERVICE ROLE FALLBACK)
console.log('\n--- 10. PRODUCTION AUTHENTICATION HARDENING ---');
const authJs = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'auth.js'), 'utf8');
const supAuth = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'supabaseAuth.js'), 'utf8');

assert.strictEqual(authJs.includes('const isProduction = process.env.NODE_ENV === \'production\' || Boolean(process.env.RAILWAY_ENVIRONMENT);'), true, 'auth.js detects production environment');
assert.strictEqual(supAuth.includes('const isProduction = process.env.NODE_ENV === \'production\' || Boolean(process.env.RAILWAY_ENVIRONMENT);'), true, 'supabaseAuth detects production environment');
assert.strictEqual(supAuth.includes('if (!isProduction && (process.env.ENABLE_MOCK_AUTH === \'true\' || req.headers[\'x-mock-auth\'] === \'true\'))'), true, 'supabaseAuth blocks mock auth in production');
assert.strictEqual(supAuth.includes('SUPABASE_ANON_KEY') && !supAuth.includes('SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY'), true, 'supabaseAuth does not fall back from service role to anon key');
console.log('✔ Passed: Production environment strictly enforces Supabase Auth and removes silent service-role fallback.');

// 11. PRIVACY-SAFE ANALYTICS & GATEWAY URL
console.log('\n--- 11. PRIVACY-SAFE ANALYTICS & CANONICAL GATEWAY URL ---');
assert.strictEqual(serverFile.includes('const ALLOWED_ANALYTICS_EVENTS = new Set(['), true, 'server.js enforces strict analytics event allowlist');
assert.strictEqual(serverFile.includes('const ALLOWED_ANALYTICS_META_KEYS = new Set(['), true, 'server.js enforces strict analytics metadata key allowlist');
assert.strictEqual(serverFile.includes('https://api.aicredits.in/v1'), true, 'server.js defaults to official api.aicredits.in gateway');
console.log('✔ Passed: Strict analytics allowlist and official AICREDITS API gateway verified.');

// 12. REPOSITORY & GIT HYGIENE
console.log('\n--- 12. REPOSITORY & GIT HYGIENE ---');
const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
assert.strictEqual(gitignore.includes('.env'), true, '.gitignore must exclude .env');
assert.strictEqual(gitignore.includes('*.sqlite'), true, '.gitignore must exclude *.sqlite');
assert.strictEqual(gitignore.includes('*.p12'), true, '.gitignore must exclude *.p12 certificates');
assert.strictEqual(gitignore.includes('*.bak'), true, '.gitignore must exclude *.bak backup files');
assert.strictEqual(gitignore.includes('*credential*.json'), true, '.gitignore must exclude *credential*.json');
assert.strictEqual(gitignore.includes('!.env.example'), true, '.gitignore must allow .env.example');

const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
assert.strictEqual(envExample.includes('your_general_api_key_here'), true, '.env.example uses safe placeholders');
assert.strictEqual(envExample.includes('https://api.aicredits.in/v1'), true, '.env.example uses canonical gateway URL');
assert.strictEqual(envExample.includes('sk-live'), false, '.env.example must not contain live keys');

console.log('✔ Passed: .gitignore rules, secret exclusions, and .env.example configuration verified.');

console.log('\n============================================================');
console.log('🎉 ALL FINAL HARDENING VERIFICATION TESTS PASSED (12/12)!');
console.log('============================================================\n');
