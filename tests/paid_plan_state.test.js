'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '011_persist_paid_plan_state.sql'), 'utf8');

console.log('Running persisted paid-plan state regression guard...');

// Browser plan detection must be O(1): exactly one own-profile lookup and no ledger scan.
assert(
  config.includes(".select('has_paid_credits')"),
  'Plan badge must read the persisted has_paid_credits profile flag.'
);
assert(
  !config.includes(".from('credit_transactions')"),
  'Plan badge must never scan credit_transactions in the browser.'
);
assert(
  !config.includes("select('amount')"),
  'Legacy unbounded transaction amount fetch must be removed.'
);

// Schema state is monotonic and backward compatible for existing profiles.
assert(
  /ADD COLUMN IF NOT EXISTS has_paid_credits pg_catalog\.bool NOT NULL DEFAULT false/i.test(migration),
  'Migration must add a non-null boolean paid-state flag with a safe default.'
);
assert(
  /status = 'completed' AND amount < 0/i.test(migration) &&
    /p\.credits::pg_catalog\.int8 \+ COALESCE\(u\.consumed_credits, 0\)\) > 50/i.test(migration),
  'Legacy backfill must reconstruct lifetime granted credits from current balance plus completed usage.'
);
assert(
  /purchase\.type = 'purchase'/i.test(migration) && /purchase\.amount > 0/i.test(migration),
  'Canonical positive purchase rows must independently backfill paid state.'
);

// Future privileged top-ups must update the paid marker atomically with the balance.
assert(
  /SET\s+credits = v_new_credits,\s+has_paid_credits = true,\s+updated_at = pg_catalog\.now\(\)/is.test(migration),
  'Successful add_credits must atomically set has_paid_credits=true.'
);
assert(
  /SECURITY DEFINER[\s\S]*SET search_path = ''/i.test(migration),
  'add_credits must preserve SECURITY DEFINER search_path hardening.'
);
assert(
  /REVOKE ALL ON FUNCTION public\.add_credits[\s\S]*FROM PUBLIC, anon, authenticated;/i.test(migration),
  'Browser roles must remain unable to execute add_credits.'
);
assert(
  /GRANT EXECUTE ON FUNCTION public\.add_credits[\s\S]*TO service_role, postgres;/i.test(migration),
  'Only privileged server roles may execute add_credits.'
);

// Duplicate payment replay remains non-minting and cannot create a second top-up.
assert(
  /IF EXISTS \([\s\S]*request_id = v_tx_req_id[\s\S]*'duplicate', true/is.test(migration),
  'Existing add_credits idempotency behavior must be preserved.'
);

console.log('✅ Paid-plan state is persisted, legacy-safe, monotonic, service-role-only, and O(1) for the browser.');
