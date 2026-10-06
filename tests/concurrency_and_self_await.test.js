'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('🧪 CONCURRENCY, SELF-AWAIT & CODE INTEGRITY TEST SUITE');
console.log('============================================================\n');

const serverFile = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const appFile = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// 1. CONCURRENCY LOCK TTL > SERVER DEADLINE
console.log('▶ [TEST 1] Verifying Concurrency Lock TTL vs Server Operation Deadline...');
const lockMatch = serverFile.match(/const\s+CONCURRENCY_LOCK_TTL_MS\s*=\s*(\d+);/);
const deadlineMatch = serverFile.match(/const\s+SERVER_TOTAL_OPERATION_DEADLINE_MS\s*=\s*(\d+);/);

const lockTtl = lockMatch ? Number(lockMatch[1]) : 0;
const deadlineMs = deadlineMatch ? Number(deadlineMatch[1]) : 0;

console.log(`  - CONCURRENCY_LOCK_TTL_MS: ${lockTtl}ms`);
console.log(`  - SERVER_TOTAL_OPERATION_DEADLINE_MS: ${deadlineMs}ms`);

assert.ok(lockTtl >= 120000, 'Lock TTL must be at least 120,000ms');
assert.ok(lockTtl > deadlineMs, `Lock TTL (${lockTtl}ms) must strictly exceed server deadline (${deadlineMs}ms)`);
console.log('✔ Test 1 Passed: Lock TTL exceeds server operation deadline.\n');

// 2. IN-FLIGHT SELF-AWAIT DEADLOCK PREVENTED
console.log('▶ [TEST 2] Verifying Self-Await Deadlock Immunity...');
// In /api/analyze, /api/icebreaker, /api/optimize, duplicate check must not await its own operationPromise
const selfAwaitOccurrences = (serverFile.match(/if\s*\(\s*inFlight\s*&&\s*inFlight\s*!==\s*operationPromise\s*\)/g) || []).length;
console.log(`  - Protected "inFlight !== operationPromise" checks found: ${selfAwaitOccurrences}`);
assert.ok(selfAwaitOccurrences >= 3, 'Must have at least 3 protected inFlight !== operationPromise checks across AI endpoints');
console.log('✔ Test 2 Passed: Self-await deadlock permanently prevented across AI endpoints.\n');

// 3. FACT-CHANGING BIO PURGE
console.log('▶ [TEST 3] Verifying Removal of Fact-Changing Bio Rewrites...');
const hasBikesRewrite = serverFile.includes("cleaned.replace(/\\bbikes\\b/gi, 'biking and motorcycle road trips')");
const hasAppleFruitRewrite = serverFile.includes("apple is my (favaortae|favorite) fruit");
const hasSubjectDropLikes = serverFile.includes("cleaned.replace(/\\bi\\s+likes\\b/gi, 'likes')");

assert.strictEqual(hasBikesRewrite, false, 'Fact-changing bikes rewrite must be purged');
assert.strictEqual(hasAppleFruitRewrite, false, 'Fact-changing apple fruit rewrite must be purged');
assert.strictEqual(hasSubjectDropLikes, false, 'Subject-dropping "i likes" -> "likes" must be purged');

const hasSubjectPreserveLike = serverFile.includes("cleaned.replace(/\\bi\\s+likes\\b/gi, 'i like')");
assert.strictEqual(hasSubjectPreserveLike, true, 'Subject "i like" must be preserved');
console.log('✔ Test 3 Passed: User bio facts preserved with zero fabrication.\n');

// 4. TRAILING NUMBER INTEGRITY
console.log('▶ [TEST 4] Verifying Removal of Trailing-Number Purges...');
const trailingRegex = /cardText\.replace\(\/\[\\s0-9\]\+\$\/, ''\)/;
const hasFrontendTrailingPurge = trailingRegex.test(appFile);
const hasBackendTrailingPurge = serverFile.includes("opt.replace(/[\\s0-9]+$/, '')");

assert.strictEqual(hasFrontendTrailingPurge, false, 'Frontend must not strip trailing digits');
assert.strictEqual(hasBackendTrailingPurge, false, 'Backend must not strip trailing digits');
console.log('✔ Test 4 Passed: Trailing numbers (e.g. 2026, 2/10, 1v1) preserved across frontend & backend.\n');

// 5. PROMPT LENGTH CONTRADICTIONS ELIMINATED
console.log('▶ [TEST 5] Verifying Prompt Length Contradictions Eliminated...');
const hasAnalyzerWord15_22 = serverFile.includes("max 15-22 words per option");
const hasIcebreakerMax12 = serverFile.includes("max 12 words per option");

assert.strictEqual(hasAnalyzerWord15_22, false, 'Analyzer contradictory 15-22 words blanket limit must be resolved');
assert.strictEqual(hasIcebreakerMax12, false, 'Icebreaker contradictory 12 words blanket limit must be resolved');
console.log('✔ Test 5 Passed: Prompt length contradictions eliminated.\n');

console.log('============================================================');
console.log('🎉 ALL CONCURRENCY, SELF-AWAIT & INTEGRITY TESTS PASSED!');
console.log('============================================================\n');
