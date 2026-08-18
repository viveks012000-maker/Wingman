'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(ROOT, 'migrations', '010_user_consents_browser_zero_access.sql'), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');

assert(/\bBEGIN\s*;/i.test(migration), 'migration must be transactional');
assert(/\bCOMMIT\s*;/i.test(migration), 'migration must commit atomically');
assert(
  /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.user_consents\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i.test(migration),
  'migration must remove every direct browser-role privilege on user_consents'
);
assert(!/\bGRANT\b[\s\S]*?\b(?:anon|authenticated)\b/i.test(migration), 'migration must not re-grant user_consents access to browser roles');
assert(!/\bservice_role\b/i.test(migration), 'migration must not revoke or alter service_role access');

const browserFiles = [
  'app.js',
  'supabaseClient.js',
  'accessibility.js',
  'vendor/production-runtime.js',
  'index.html',
  'app.html'
];

for (const file of browserFiles) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(
    source.includes('user_consents'),
    false,
    `${file} must not directly query or mutate public.user_consents; consent is server-authoritative`
  );
}

assert(server.includes(".from('user_consents')"), 'Railway backend must retain server-side user_consents access');
assert(server.includes(".upsert("), 'Railway backend must retain server-side consent acceptance');
assert(server.includes("withdrawn_at"), 'Railway backend must retain server-side consent withdrawal');

console.log('✅ user_consents is server-only: zero direct browser table privileges or browser queries.');
