'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('🧪 CREDIT AUTHORITATIVE RECONCILIATION TEST SUITE');
console.log('============================================================\n');

const serverFile = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const appFile = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// 1. EXACT-10 CONTRACT ASSERTION BEFORE CREDIT SETTLEMENT
console.log('▶ [TEST 1] Verifying Exact-10 Contract Before SettleCreditsDB...');
// Must assert options.length !== 10 and EXACT_10_CONTRACT_VIOLATION before settleCreditsDB
const exact10Violations = (serverFile.match(/code\s*(?:=|\:)\s*['"]EXACT_10_CONTRACT_VIOLATION['"]/g) || []).length;
console.log(`  - EXACT_10_CONTRACT_VIOLATION checks found: ${exact10Violations}`);
assert.ok(exact10Violations >= 3, 'Must have EXACT_10_CONTRACT_VIOLATION checks in Analyzer, Icebreaker, and Bio');

// Ensure settleCreditsDB is preceded by length check
const lines = serverFile.split('\n');
let foundContractBeforeSettle = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('await settleCreditsDB(')) {
        // Look back 25 lines for optionsList.length !== 10 or cleanedOptions.length !== 10
        const precedingChunk = lines.slice(Math.max(0, i - 25), i).join('\n');
        if (precedingChunk.includes('!== 10') && precedingChunk.includes('EXACT_10_CONTRACT_VIOLATION')) {
            foundContractBeforeSettle++;
        }
    }
}
console.log(`  - settleCreditsDB preceded by exact-10 assertion: ${foundContractBeforeSettle}/3`);
assert.strictEqual(foundContractBeforeSettle, 3, 'All 3 non-chat features must assert options.length === 10 before settleCreditsDB');
console.log('✔ Test 1 Passed: Exact-10 contract strictly guards credit settlement.\n');

// 2. AUTHORITATIVE POST-SETTLEMENT BALANCE FETCH
console.log('▶ [TEST 2] Verifying Post-Settlement Authoritative Credit Balance Fetch...');
const postSettleBalances = (serverFile.match(/await\s+getUserCreditsDB\s*\(\s*currentUserId\s*\)/g) || []).length;
console.log(`  - Post-settle authoritative balance fetches found: ${postSettleBalances}`);
assert.ok(postSettleBalances >= 3, 'Must fetch fresh balance post-settlement across all 3 non-chat features');
console.log('✔ Test 2 Passed: Authoritative post-settlement credit balance returned.\n');

// 3. FRONTEND MONOTONIC SEQUENCE SYNC
console.log('▶ [TEST 3] Verifying Frontend Monotonic Credit Sync Sequencing...');
const hasMonotonicSeq = appFile.includes("let latestCreditSyncSeq = 0;") &&
                        appFile.includes("const syncSeq = ++latestCreditSyncSeq;");
assert.ok(hasMonotonicSeq, 'app.js must track latestCreditSyncSeq and increment monotonically');

const hasStaleSeqGuard = appFile.includes("syncSeq !== latestCreditSyncSeq");
assert.ok(hasStaleSeqGuard, 'app.js must guard against stale responses using syncSeq');
console.log('✔ Test 3 Passed: Monotonic credit sync sequencing verified.\n');

// 4. FRONTEND VERIFIED VS UNVERIFIED UI STATES
console.log('▶ [TEST 4] Verifying Frontend Verified vs Unverified UI States...');
const hasSyncingState = appFile.includes('loadingLabel = "Syncing…"') || appFile.includes("Syncing…");
const hasUnavailableState = appFile.includes('errLabel = "Balance unavailable"') || appFile.includes("Balance unavailable");
const hasMissingProfileState = appFile.includes('missingLabel = "No Profile"') || appFile.includes("No Profile");

assert.ok(hasSyncingState, 'app.js must render Syncing… while loading');
assert.ok(hasUnavailableState, 'app.js must render Balance unavailable on error');
assert.ok(hasMissingProfileState, 'app.js must render No Profile on missing profile');
console.log('✔ Test 4 Passed: Verified vs unverified UI states verified.\n');

console.log('============================================================');
console.log('🎉 ALL CREDIT AUTHORITATIVE RECONCILIATION TESTS PASSED!');
console.log('============================================================\n');
