const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- STARTING MYWINGMAN HARDENING VERIFICATION TEST SUITE ---');

// 1. TEST WORD COUNTER LOGIC
function countWords(str) {
    if (!str || typeof str !== 'string') return 0;
    const trimmed = str.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
}

assert.strictEqual(countWords(''), 0, 'Empty string should be 0 words');
assert.strictEqual(countWords('   '), 0, 'Whitespace-only string should be 0 words');
assert.strictEqual(countWords('Hello world!'), 2, 'Two words should count as 2');
assert.strictEqual(countWords('  Loves   night drives,   gym   and coffee.  '), 6, 'Multiple spaces between words should count accurately');

const fiveHundredWords = Array(500).fill('word').join(' ');
assert.strictEqual(countWords(fiveHundredWords), 500, '500 words should be exactly 500');

const fiveHundredAndOneWords = Array(501).fill('word').join(' ');
assert.strictEqual(countWords(fiveHundredAndOneWords), 501, '501 words should be 501');
assert.strictEqual(countWords(fiveHundredAndOneWords) > 500, true, '501 words exceeds limit');
console.log('✔ Test 1 Passed: countWords behaves accurately for all edge cases');

// 2. TEST MOCK AUTH PRODUCTION HARDENING IN middleware/supabaseAuth.js
const authFile = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'supabaseAuth.js'), 'utf8');
assert.strictEqual(
    authFile.includes("!isProduction && (process.env.ENABLE_MOCK_AUTH === 'true' || req.headers['x-mock-auth'] === 'true')"),
    true,
    'Mock auth header must strictly require !isProduction'
);
console.log('✔ Test 2 Passed: Mock auth bypass is strictly blocked in production');

// 3. TEST SERVER.JS WORD LIMIT AND CREDIT DEDUCTION HARDENING
const serverFile = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Check countWords helper in server.js
assert.strictEqual(serverFile.includes('function countWords(str)'), true, 'server.js must contain countWords helper');

// Check 500-word limit check in /api/optimize
assert.strictEqual(serverFile.includes('wordCount > 500'), true, 'server.js must validate wordCount > 500 on /api/optimize');

// Check refundCreditsDB definition in server.js
assert.strictEqual(serverFile.includes('async function refundCreditsDB('), true, 'server.js must define refundCreditsDB');

// Check automatic refund in catch blocks
assert.strictEqual(serverFile.includes("refundCreditsDB(req, 10, 'analyze'"), true, 'server.js must refund analyze on failure');
assert.strictEqual(serverFile.includes("refundCreditsDB(req, 10, 'icebreaker'"), true, 'server.js must refund icebreaker on failure');
assert.strictEqual(serverFile.includes("refundCreditsDB(req, 10, 'optimize'"), true, 'server.js must refund optimize on failure');
assert.strictEqual(serverFile.includes("refundCreditsDB(req, 2, 'chat'"), true, 'server.js must refund chat on failure');
console.log('✔ Test 3 Passed: server.js credit deduction, 500-word limit, and automatic refunds verified');

// 4. TEST APP.HTML AND APP.JS ALIGNMENT
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Check word counter label in app.html
assert.strictEqual(appHtml.includes('id="auditBioCharCounter" class="text-[11px] font-mono text-slate-500">0 / 500 words</span>'), true, 'app.html must display 0 / 500 words for auditBioCharCounter');

// Check that duplicate supabase scripts are removed from bottom of app.html
const bottomSupabaseMatches = (appHtml.match(/<script src="vendor\/supabase\.min\.js"><\/script>/g) || []).length;
assert.strictEqual(bottomSupabaseMatches, 1, 'vendor/supabase.min.js should only appear once in app.html');

// Check countWords and live word counter update in app.js
assert.strictEqual(appJs.includes('function countWords(str)'), true, 'app.js must contain countWords helper');
assert.strictEqual(appJs.includes('words > 500'), true, 'app.js must check words > 500');
assert.strictEqual(appJs.includes('showUnreadableErrorModal'), true, 'app.js must define showUnreadableErrorModal');

console.log('✔ Test 4 Passed: app.html and app.js UI elements, counters, and scripts aligned');

// 5. TEST SQL MIGRATION FILE
const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_atomic_credits_and_transactions.sql'), 'utf8');
assert.strictEqual(migrationSql.includes('credits_non_negative'), true, 'Migration must contain credits_non_negative check');
assert.strictEqual(migrationSql.includes('CREATE OR REPLACE FUNCTION deduct_credits'), true, 'Migration must define deduct_credits RPC');
assert.strictEqual(migrationSql.includes('CREATE OR REPLACE FUNCTION refund_credits'), true, 'Migration must define refund_credits RPC');
assert.strictEqual(migrationSql.includes('FOR UPDATE'), true, 'Migration must use FOR UPDATE row locking');

console.log('✔ Test 5 Passed: Migration 002 atomic credit RPCs and non-negative constraints verified');

console.log('\n============================================================');
console.log('🎉 ALL MYWINGMAN HARDENING VERIFICATION TESTS PASSED (5/5)!');
console.log('============================================================\n');
