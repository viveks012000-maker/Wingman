'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'migrations', '015_provision_profile_after_email_verification.sql');
const supabaseClientSrc = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const replaySrc = fs.readFileSync(path.join(root, 'tests', 'migration_replay.test.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err.message });
    console.log(`❌ FAIL: ${name} — ${err.message}`);
  }
}

function normalizedSql(source) {
  return String(source || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

console.log('========================================================================');
console.log('✉️ VERIFIED-SIGNUP PROFILE PROVISIONING REGRESSION SUITE');
console.log('========================================================================\n');

const migrationExists = fs.existsSync(migrationPath);
const migrationSrc = migrationExists ? fs.readFileSync(migrationPath, 'utf8') : '';
const sql = normalizedSql(migrationSrc);
const pendingMessage = 'Check your email to finish signup. Your account and 20 free credits activate after verification.';

test('1. A forward-only migration exists for verified-email provisioning', () => {
  assert.ok(migrationExists, 'migrations/015_provision_profile_after_email_verification.sql must exist');
});

test('2. Unconfirmed email signups cannot receive a profile on auth.users INSERT', () => {
  assert.ok(
    /new\.email_confirmed_at\s+is\s+not\s+null/i.test(migrationSrc),
    'INSERT-time provisioning must require NEW.email_confirmed_at IS NOT NULL'
  );
  assert.ok(
    /insert\s+into\s+public\.profiles[\s\S]*values\s*\(\s*new\.id\s*,\s*20[\s\S]*false[\s\S]*on\s+conflict\s*\(\s*id\s*\)\s+do\s+nothing/i.test(migrationSrc),
    'verified users must receive exactly 20 free credits idempotently'
  );
});

test('3. Email confirmation transition provisions the profile exactly once', () => {
  assert.ok(sql.includes('after update of email_confirmed_at on auth.users'), 'must add an AFTER UPDATE OF email_confirmed_at trigger');
  assert.ok(sql.includes('old.email_confirmed_at is null'), 'confirmation trigger must require OLD.email_confirmed_at IS NULL');
  assert.ok(sql.includes('new.email_confirmed_at is not null'), 'confirmation trigger must require NEW.email_confirmed_at IS NOT NULL');
  assert.ok(sql.includes('on conflict (id) do nothing'), 'confirmation provisioning must be idempotent');
});

test('4. Existing pending profiles are cleaned only when they are untouched free-signup rows', () => {
  assert.ok(sql.includes('delete from public.profiles'), 'migration must remove prematurely-created pending profiles');
  assert.ok(sql.includes('email_confirmed_at is null'), 'cleanup must be limited to unconfirmed auth users');
  assert.ok(sql.includes('p.credits = 20'), 'cleanup must be limited to the default 20-credit balance');
  assert.ok(sql.includes('p.has_paid_credits = false'), 'cleanup must never remove paid-plan profiles');
  assert.ok(sql.includes('public.credit_transactions'), 'cleanup must explicitly preserve transaction-bearing profiles');
});

test('5. Safely recoverable confirmed users missing profiles are backfilled without overwriting balances', () => {
  assert.ok(
    /insert\s+into\s+public\.profiles\s*\(id,\s*credits,\s*created_at,\s*updated_at,\s*has_paid_credits\)\s*select\s+u\.id,\s*20/i.test(migrationSrc),
    'migration must backfill confirmed identities that have no profile'
  );
  assert.ok(/u\.email_confirmed_at\s+is\s+not\s+null/i.test(migrationSrc), 'backfill must require a confirmed email');
  assert.ok(/not\s+exists\s*\([\s\S]*from\s+public\.profiles\s+p[\s\S]*p\.id\s*=\s*u\.id/i.test(migrationSrc), 'backfill must target only missing profiles');
  assert.ok(/not\s+exists\s*\([\s\S]*from\s+public\.credit_transactions\s+t[\s\S]*t\.user_id\s*=\s*u\.id/i.test(migrationSrc), 'backfill must exclude identities with credit history');
  assert.ok(sql.includes('on conflict (id) do nothing'), 'backfill must be idempotent');
});

test('6. Pending signup UI accurately says verification finishes signup and activates credits', () => {
  assert.ok(!supabaseClientSrc.includes('Account created! Please check your email to confirm your account and sign in.'), 'pending signup toast must not claim Account created');
  assert.ok(!indexHtml.includes('Account created. Check your email to verify it before signing in.'), 'pending signup inline message must not claim Account created');
  assert.ok(supabaseClientSrc.includes(pendingMessage), 'Supabase signup helper must show the canonical pending-verification message');
  assert.ok(indexHtml.includes(pendingMessage), 'landing auth form must show the canonical pending-verification message');
});

test('7. Pending signup remains explicitly unauthenticated until Supabase returns a real session', () => {
  assert.ok(/authenticated:\s*false/.test(supabaseClientSrc), 'confirmation-required signup must remain authenticated=false');
  assert.ok(/confirmationRequired:\s*true/.test(supabaseClientSrc), 'confirmation-required signup marker must remain present');
});

test('8. Migration replay is extended through migration 015', () => {
  assert.ok(replaySrc.includes('015_provision_profile_after_email_verification.sql'), 'migration replay must include migration 015');
  assert.ok(replaySrc.includes('unconfirmed signup must not receive a profile or credits'), 'replay must prove pending signups receive no profile/credits');
  assert.ok(replaySrc.includes('confirmed-at-insert user must receive exactly 20 credits'), 'replay must prove confirmed-at-insert/OAuth provisioning');
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed) {
  failures.forEach(f => console.error(`❌ ${f.name}: ${f.error}`));
  process.exit(1);
}
