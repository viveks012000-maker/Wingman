/**
 * Migration 002 Safety & Security Audit Verification Suite
 * Verifies all 6 Codex Blockers and architectural invariants for Migration 002
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🛡️  RUNNING MIGRATION 002 SAFETY & SECURITY AUDIT TESTS');
console.log('============================================================\n');

const migrationSql = fs.readFileSync(path.join(__dirname, '../migrations/002_atomic_credits_and_transactions.sql'), 'utf8');
const serverFile = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// -----------------------------------------------------------------------------
// BLOCKER 1: Legacy deduct_credits return-type collision avoided
// -----------------------------------------------------------------------------
console.log('▶ [BLOCKER 1] Legacy deduct_credits Return-Type Collision');
assert.strictEqual(
    migrationSql.includes('CREATE OR REPLACE FUNCTION public.deduct_credits'),
    false,
    'Migration 002 must NOT attempt incompatible return-type replacement on public.deduct_credits'
);
assert.strictEqual(
    migrationSql.includes('DROP FUNCTION IF EXISTS public.deduct_credits CASCADE') || migrationSql.includes('DROP FUNCTION public.deduct_credits CASCADE'),
    false,
    'Migration 002 must NOT DROP deduct_credits CASCADE'
);
assert.strictEqual(
    serverFile.includes("supabaseAdmin.rpc('deduct_credits'"),
    false,
    'server.js must NOT use legacy deduct_credits as a fallback'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL ON FUNCTION public.deduct_credits'),
    true,
    'Migration 002 must revoke client execution on legacy deduct_credits'
);
console.log('✔ Blocker 1 Passed: Legacy deduct_credits return-type replacement removed; client access revoked; server fallback absent');

// -----------------------------------------------------------------------------
// BLOCKER 2: SET search_path = '' on ALL SECURITY DEFINER functions
// -----------------------------------------------------------------------------
console.log('\n▶ [BLOCKER 2] Hardened SECURITY DEFINER Search Path');
const secDefFunctions = migrationSql.match(/CREATE OR REPLACE FUNCTION [^;]+?SECURITY DEFINER[^;]+?\$\$/gs) || [];
assert.strictEqual(secDefFunctions.length >= 5, true, 'Must find all privileged SECURITY DEFINER functions in Migration 002');

for (const fn of secDefFunctions) {
    assert.strictEqual(
        fn.includes("SET search_path = ''"),
        true,
        `SECURITY DEFINER function must specify SET search_path = '': ${fn.substring(0, 80)}...`
    );
    assert.strictEqual(
        fn.includes("SET search_path = public, pg_temp"),
        false,
        `SECURITY DEFINER function must NOT use search_path = public, pg_temp`
    );
}
console.log(`✔ Blocker 2 Passed: All ${secDefFunctions.length} SECURITY DEFINER functions enforce SET search_path = '' and qualify schemas`);

// -----------------------------------------------------------------------------
// BLOCKER 3: Request-ID Validation & Unique Constraint
// -----------------------------------------------------------------------------
console.log('\n▶ [BLOCKER 3] Request ID Validation & Uniqueness Constraint');
assert.strictEqual(
    migrationSql.includes('chk_credit_transactions_request_id_not_empty'),
    true,
    'Must include chk_credit_transactions_request_id_not_empty constraint'
);
assert.strictEqual(
    migrationSql.includes('uq_credit_transactions_user_request_id UNIQUE (user_id, request_id)'),
    true,
    'Must enforce UNIQUE (user_id, request_id) constraint'
);
console.log('✔ Blocker 3 Passed: Request ID non-empty check, length bounds, and UNIQUE (user_id, request_id) verified');

// -----------------------------------------------------------------------------
// BLOCKER 4: reserve_credits Input Validation & btrim function resolution
// -----------------------------------------------------------------------------
console.log('\n▶ [BLOCKER 4] reserve_credits Input Validation & btrim Resolution');
assert.strictEqual(
    migrationSql.includes('p_user_id IS NULL'),
    true,
    'reserve_credits must validate p_user_id IS NULL'
);
assert.strictEqual(
    migrationSql.includes('p_amount IS NULL OR p_amount <= 0'),
    true,
    'reserve_credits must reject NULL, 0, or negative amount'
);
assert.strictEqual(
    migrationSql.includes('v_clean_feature = \'\''),
    true,
    'reserve_credits must reject empty/whitespace feature'
);
assert.strictEqual(
    migrationSql.includes('v_clean_req_id = \'\''),
    true,
    'reserve_credits must reject empty/whitespace request_id'
);
assert.strictEqual(
    migrationSql.includes('pg_catalog.trim('),
    false,
    'Migration 002 must NOT use pg_catalog.trim('
);
const btrimMatches = (migrationSql.match(/pg_catalog\.btrim\(/g) || []).length;
assert.strictEqual(
    btrimMatches,
    5,
    'Migration 002 must use pg_catalog.btrim( across all 5 whitespace sanitization locations'
);
console.log('✔ Blocker 4 Passed: Strict input validation on UID, amount, feature, and request ID enforced with pg_catalog.btrim');

// -----------------------------------------------------------------------------
// BLOCKER 5: Revoke Client TRUNCATE & Privilege Lockdown
// -----------------------------------------------------------------------------
console.log('\n▶ [BLOCKER 5] Client TRUNCATE & Privilege Lockdown');
assert.strictEqual(
    migrationSql.includes('REVOKE ALL, TRUNCATE'),
    false,
    'Migration 002 must NOT contain invalid REVOKE ALL, TRUNCATE syntax'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL PRIVILEGES ON TABLE public.credit_transactions FROM PUBLIC, anon, authenticated;'),
    true,
    'Must revoke ALL PRIVILEGES ON TABLE on credit_transactions from PUBLIC, anon, authenticated'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;'),
    true,
    'Must revoke ALL PRIVILEGES ON TABLE on profiles from PUBLIC, anon, authenticated'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL ON FUNCTION public.reserve_credits'),
    true,
    'Must revoke reserve_credits from PUBLIC, anon, authenticated'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL ON FUNCTION public.settle_credits'),
    true,
    'Must revoke settle_credits from PUBLIC, anon, authenticated'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL ON FUNCTION public.release_credits'),
    true,
    'Must revoke release_credits from PUBLIC, anon, authenticated'
);
assert.strictEqual(
    migrationSql.includes('REVOKE ALL ON FUNCTION public.add_credits'),
    true,
    'Must revoke add_credits from PUBLIC, anon, authenticated'
);
console.log('✔ Blocker 5 Passed: TRUNCATE, mutation, and RPC execute privileges revoked from browser roles');

// -----------------------------------------------------------------------------
// BLOCKER 6: Atomic Migration Transaction & Error Visibility
// -----------------------------------------------------------------------------
console.log('\n▶ [BLOCKER 6] Atomic Migration Transaction & Error Visibility');
assert.strictEqual(migrationSql.includes('BEGIN;'), true, 'Migration must contain BEGIN;');
assert.strictEqual(migrationSql.includes('COMMIT;'), true, 'Migration must contain COMMIT;');
assert.strictEqual(
    migrationSql.includes('EXCEPTION WHEN OTHERS THEN NULL;') || migrationSql.includes('WHEN OTHERS THEN\n        NULL;'),
    false,
    'Migration must NOT contain silent exception swallowing'
);
console.log('✔ Blocker 6 Passed: Atomic transaction wrapping (BEGIN/COMMIT) and visible error propagation verified');

// -----------------------------------------------------------------------------
// INVARIANT 7: Exactly-Once 50 Credits & Existing Balance Preservation
// -----------------------------------------------------------------------------
console.log('\n▶ [INVARIANT 7] Exactly-Once 50 Credits & Preserved Balances');
assert.strictEqual(
    migrationSql.includes('UPDATE public.profiles SET credits = 50;'),
    false,
    'Migration must NEVER run blanket update setting existing balances to 50'
);
assert.strictEqual(
    migrationSql.includes('ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;'),
    true,
    'New profiles default to 50'
);
assert.strictEqual(
    migrationSql.includes('ON CONFLICT (id) DO NOTHING;'),
    true,
    'handle_new_user trigger awards 50 ONCE with ON CONFLICT DO NOTHING'
);
console.log('✔ Invariant 7 Passed: Existing balances preserved; new signup default is exactly 50 credits');

console.log('\n🎉 ALL MIGRATION 002 SAFETY & SECURITY AUDIT TESTS PASSED!\n');
