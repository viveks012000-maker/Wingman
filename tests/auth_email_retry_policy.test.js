'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'migrations', '016_auth_email_retry_policy.sql');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clientSrc = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');
const securitySrc = fs.readFileSync(path.join(root, 'middleware', 'security.js'), 'utf8');
const replaySrc = fs.readFileSync(path.join(root, 'tests', 'migration_replay.test.js'), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ FAIL: ${name}: ${error.message}`);
  }
}

const migrationExists = fs.existsSync(migrationPath);
const migrationSrc = migrationExists ? fs.readFileSync(migrationPath, 'utf8') : '';
const sql = migrationSrc.replace(/\s+/g, ' ').toLowerCase();

console.log('========================================================================');
console.log('✉️ AUTH EMAIL RETRY POLICY REGRESSION SUITE');
console.log('========================================================================\n');

test('1. Forward-only migration 016 defines persistent retry state', () => {
  assert.equal(migrationExists, true, 'migrations/016_auth_email_retry_policy.sql must exist');
  assert.match(sql, /create table if not exists public\.auth_email_retry_guards/);
  assert.match(sql, /attempt_count/);
  assert.match(sql, /blocked_until/);
  assert.match(sql, /last_email_sent_at/);
});

test('2. Retry state is private and service-role only', () => {
  assert.match(sql, /alter table public\.auth_email_retry_guards enable row level security/);
  assert.match(sql, /revoke all on table public\.auth_email_retry_guards from public/);
  assert.match(sql, /revoke all on table public\.auth_email_retry_guards from anon/);
  assert.match(sql, /revoke all on table public\.auth_email_retry_guards from authenticated/);
  assert.match(sql, /grant .* on table public\.auth_email_retry_guards to service_role/);
});

test('3. Atomic database policy allows first request, suppresses attempts 2-4, blocks attempt 5 for 60 seconds', () => {
  assert.match(sql, /create or replace function public\.auth_email_retry_policy/);
  assert.match(sql, /attempt_count[^;]*>=\s*5|>=\s*5[^;]*attempt_count/);
  assert.match(sql, /interval\s+'60 seconds'/);
  assert.ok(sql.includes("'allow'"), 'policy must return allow');
  assert.ok(sql.includes("'suppressed'"), 'policy must return suppressed');
  assert.ok(sql.includes("'blocked'"), 'policy must return blocked');
});

test('4. Policy supports every email-triggering MyWingman auth flow in use', () => {
  for (const flow of ['signup', 'recovery', 'reauthentication']) {
    assert.ok(sql.includes(`'${flow}'`), `migration must support ${flow}`);
  }
});

test('5. Retry subject is an opaque server-derived hash, never plaintext email', () => {
  assert.match(serverSrc, /createHmac\(['"]sha256['"]/);
  assert.match(serverSrc, /auth-email-retry/i);
  assert.ok(!/auth_email_retry_guards[\s\S]{0,300}\bemail\b/i.test(migrationSrc), 'retry table must not persist plaintext email');
});

test('6. Backend exposes a narrow rate-limited retry-policy endpoint', () => {
  assert.match(serverSrc, /\/api\/auth\/email-retry-policy/);
  assert.match(serverSrc, /authLimiter/);
  assert.match(serverSrc, /auth_email_retry_policy/);
});

test('7. Frontend checks policy before signup, password recovery, and reauthentication email requests', () => {
  assert.match(clientSrc, /checkAuthEmailRetryPolicy/);
  const guardCalls = (clientSrc.match(/checkAuthEmailRetryPolicy\(/g) || []).length;
  assert.ok(guardCalls >= 4, `expected helper definition + at least 3 flow uses, found ${guardCalls}`);
  assert.match(clientSrc, /client\.auth\.signUp/);
  assert.match(clientSrc, /client\.auth\.resetPasswordForEmail/);
  assert.match(clientSrc, /client\.auth\.reauthenticate/);
});

test('8. Successful email requests are recorded and redundant retries do not call Supabase again', () => {
  assert.match(clientSrc, /recordAuthEmailRequestSent/);
  assert.match(clientSrc, /status\s*===\s*['"]suppressed['"]/);
  assert.match(clientSrc, /status\s*===\s*['"]blocked['"]/);
});

test('9. Native Supabase email-frequency 429 is absorbed into the same policy instead of exposed raw', () => {
  assert.match(clientSrc, /over_email_send_rate_limit|email.*rate.*limit/i);
  assert.match(clientSrc, /recordNativeAuthEmailRateLimit/);
  assert.ok(!/return\s+String\(error\.message\)[\s\S]{0,120}over_email_send_rate_limit/i.test(clientSrc), 'native cooldown must not bypass policy formatting');
});

test('10. Passwords never pass through MyWingman retry-policy backend', () => {
  const retryHelperMatch = clientSrc.match(/async function checkAuthEmailRetryPolicy[\s\S]*?\n\s*}\n/);
  if (retryHelperMatch) assert.ok(!/password/i.test(retryHelperMatch[0]), 'preflight helper must never send a password');
  assert.match(serverSrc, /email-retry-policy/);
  assert.ok(!/email-retry-policy[\s\S]{0,1200}req\.body\.password/i.test(serverSrc), 'retry endpoint must not read passwords');
});

test('11. Existing IP-level auth limiter remains an additional security backstop', () => {
  assert.match(securitySrc, /windowMs:\s*60\s*\*\s*1000/);
  assert.match(securitySrc, /max:\s*10/);
});

test('12. Migration replay is extended through migration 016', () => {
  assert.ok(replaySrc.includes("'016'"), 'migration replay must explicitly include 016');
  assert.ok(replaySrc.includes('auth_email_retry_policy'), 'migration replay must exercise retry policy');
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
