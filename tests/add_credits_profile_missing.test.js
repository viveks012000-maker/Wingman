const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '007_harden_add_credits_profile_missing.sql'), 'utf8');

const helperStart = server.indexOf('async function addUserCreditsDB');
const helperEnd = server.indexOf('function sanitizeResponseText', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'addUserCreditsDB helper must exist');
const helper = server.slice(helperStart, helperEnd);
assert.ok(helper.includes('if (row.success !== true)'), 'server must reject semantic add_credits failures');
assert.ok(helper.includes("rowCode === 'PROFILE_MISSING'"), 'server must preserve PROFILE_MISSING from top-up RPC');
assert.ok(helper.includes("typeof row.new_balance === 'number'"), 'server must require an authoritative numeric minted balance');
assert.ok(!helper.includes(': addCredits);'), 'server must not invent a successful balance when RPC omits one');

assert.ok(migration.includes('IF NOT FOUND THEN'), 'add_credits must fail when the profile row is missing');
assert.ok(migration.includes("'error', 'PROFILE_MISSING'"), 'migration must return explicit PROFILE_MISSING');
const missingBlockStart = migration.indexOf('IF NOT FOUND THEN');
const missingBlockEnd = migration.indexOf('END IF;', missingBlockStart);
const missingBlock = migration.slice(missingBlockStart, missingBlockEnd);
assert.ok(!missingBlock.includes('INSERT INTO public.profiles'), 'missing-profile branch must never auto-create a profile');
assert.ok(migration.includes("'duplicate', true"), 'payment request IDs must be idempotent');
assert.ok(migration.includes('FROM PUBLIC, anon, authenticated'), 'client roles must remain revoked from add_credits');
assert.ok(migration.includes('TO service_role, postgres'), 'add_credits must remain backend-only');

console.log('✔ Privileged add_credits missing-profile and semantic-success invariant passed.');
