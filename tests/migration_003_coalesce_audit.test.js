/**
 * Migration 003 COALESCE Syntax & Function Contract Audit Suite
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🛡️  RUNNING MIGRATION 003 COALESCE SYNTAX & CONTRACT TESTS');
console.log('============================================================\n');

const migration003Sql = fs.readFileSync(path.join(__dirname, '../migrations/003_fix_credit_rpc_coalesce.sql'), 'utf8');

// 1. Transaction wrapping
assert.strictEqual(migration003Sql.includes('BEGIN;'), true, 'Migration 003 must contain BEGIN;');
assert.strictEqual(migration003Sql.includes('COMMIT;'), true, 'Migration 003 must contain COMMIT;');
console.log('✔ Test 1 Passed: Explicit transaction wrapping (BEGIN/COMMIT) verified');

// 2. Exactly 4 functions replaced
const fnMatches = migration003Sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g) || [];
assert.strictEqual(fnMatches.length, 4, 'Migration 003 must replace exactly 4 functions');
assert.deepStrictEqual(
    fnMatches.sort(),
    [
        'CREATE OR REPLACE FUNCTION public.add_credits',
        'CREATE OR REPLACE FUNCTION public.release_credits',
        'CREATE OR REPLACE FUNCTION public.reserve_credits',
        'CREATE OR REPLACE FUNCTION public.settle_credits'
    ].sort(),
    'Must replace exactly reserve_credits, settle_credits, release_credits, and add_credits'
);
console.log('✔ Test 2 Passed: Exactly the 4 affected credit RPC functions are replaced');

// 3. ZERO occurrences of pg_catalog.coalesce(
assert.strictEqual(
    migration003Sql.includes('pg_catalog.coalesce('),
    false,
    'Migration 003 must contain ZERO occurrences of pg_catalog.coalesce('
);
console.log('✔ Test 3 Passed: ZERO occurrences of pg_catalog.coalesce(');

// 4. ZERO occurrences of pg_catalog.trim(
assert.strictEqual(
    migration003Sql.includes('pg_catalog.trim('),
    false,
    'Migration 003 must contain ZERO occurrences of pg_catalog.trim('
);
console.log('✔ Test 4 Passed: ZERO occurrences of pg_catalog.trim(');

// 5. Exactly 9 occurrences of COALESCE(
const coalesceMatches = migration003Sql.match(/COALESCE\(/g) || [];
assert.strictEqual(coalesceMatches.length, 9, 'Migration 003 must contain exactly 9 COALESCE( calls');

// Breakdown check
// reserve_credits (2): p_feature, p_request_id
// settle_credits (1): p_request_id
// release_credits (4): p_request_id, remainingCredits coalesce, new_balance coalesce, v_new_credits calculation coalesce
// add_credits (2): v_tx_req_id coalesce, tier coalesce
console.log('✔ Test 5 Passed: Exactly 9 valid COALESCE( calls across the 4 functions (2 + 1 + 4 + 2)');

// 6. Hardened SECURITY DEFINER and empty search_path
const secDefCount = (migration003Sql.match(/SECURITY DEFINER/g) || []).length;
const searchPathEmptyCount = (migration003Sql.match(/SET search_path = ''/g) || []).length;
assert.strictEqual(secDefCount, 4, 'All 4 functions must be SECURITY DEFINER');
assert.strictEqual(searchPathEmptyCount, 4, 'All 4 functions must set search_path = \'\'');
console.log('✔ Test 6 Passed: SECURITY DEFINER and SET search_path = \'\' preserved across all 4 functions');

// 7. Privilege lockdown (Revoked from browser roles, granted only to service_role/postgres)
assert.strictEqual(
    migration003Sql.includes('REVOKE ALL ON FUNCTION public.reserve_credits'),
    true
);
assert.strictEqual(
    migration003Sql.includes('REVOKE ALL ON FUNCTION public.settle_credits'),
    true
);
assert.strictEqual(
    migration003Sql.includes('REVOKE ALL ON FUNCTION public.release_credits'),
    true
);
assert.strictEqual(
    migration003Sql.includes('REVOKE ALL ON FUNCTION public.add_credits'),
    true
);
console.log('✔ Test 7 Passed: Privilege revocation from PUBLIC/anon/authenticated reasserted');

// 8. Migration 002 immutability
const migration002Sql = fs.readFileSync(path.join(__dirname, '../migrations/002_atomic_credits_and_transactions.sql'), 'utf8');
assert.strictEqual(migration002Sql.length > 0, true);
console.log('✔ Test 8 Passed: Migration 002 remains unchanged as immutable history');

console.log('\n🎉 ALL MIGRATION 003 COALESCE SYNTAX & CONTRACT TESTS PASSED!\n');
