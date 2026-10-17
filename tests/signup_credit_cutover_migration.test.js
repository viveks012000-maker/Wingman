'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'migrations', '018_signup_credits_fifty_after_verification.sql');
assert.ok(fs.existsSync(migrationPath), 'a new forward-only signup-credit migration must exist');

const sql = fs.readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');
const executableSql = sql.replace(/^\s*--.*$/gm, '').trim();
assert.match(executableSql, /^BEGIN;/i, 'signup-credit migration must be atomic');
assert.match(executableSql, /^BEGIN;\s*LOCK TABLE auth\.users IN SHARE ROW EXCLUSIVE MODE;/i, 'Auth inserts and confirmations must serialize across the grant cutover');
assert.match(executableSql, /COMMIT;\s*$/i, 'signup-credit migration must commit atomically');
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.signup_credit_policy/i, 'migration must persist its cutover rule');
assert.match(sql, /clock_timestamp\(\)/i, 'cutover must be fixed at migration application time');
assert.match(sql, /legacy_credits[^,]*\b20\b/i, 'pre-cutover accounts must retain the previous 20-credit promise');
assert.match(sql, /welcome_credits[^,]*\b50\b/i, 'post-cutover accounts must receive 50 credits');
assert.match(sql, /NEW\.created_at\s*>=\s*v_cutover_at/i, 'eligibility must use account creation time, not confirmation time');
assert.match(sql, /NEW\.email_confirmed_at\s+IS\s+NOT\s+NULL/i, 'unverified email signups must not receive a profile or credits');
assert.match(sql, /ON CONFLICT\s*\(id\)\s+DO NOTHING/i, 'repeat provisioning must not overwrite an existing profile');
assert.match(sql, /ALTER TABLE public\.profiles ALTER COLUMN credits SET DEFAULT 50/i, 'new-profile default must match the new welcome grant');
assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path\s*=\s*''/i, 'trigger function must remain hardened');
assert.match(sql, /REVOKE ALL ON TABLE public\.signup_credit_policy FROM PUBLIC, anon, authenticated, service_role/i, 'cutover metadata must not be readable or writable through API roles');
assert.match(sql, /ENABLE ROW LEVEL SECURITY/i, 'cutover metadata must have RLS enabled');
assert.doesNotMatch(sql, /UPDATE\s+public\.profiles\s+SET\s+credits|DELETE\s+FROM\s+public\.profiles|INSERT\s+INTO\s+public\.profiles[\s\S]*?SELECT/i, 'migration must not backfill or alter existing profile balances');
assert.doesNotMatch(sql, /014_reconcile|UPDATE\s+public\.credit_transactions/i, 'migration must not replay historical reconciliation or rewrite ledger history');

console.log('✔ Signup-credit migration contract: forward-only, verification-gated, cutover-aware, and idempotent.');
