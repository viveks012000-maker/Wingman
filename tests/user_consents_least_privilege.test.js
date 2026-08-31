'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(ROOT, 'migrations', '009_user_consents_least_privilege.sql'), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const supabaseClient = fs.readFileSync(path.join(ROOT, 'supabaseClient.js'), 'utf8').replace(/\r\n/g, '\n');
const migration005 = fs.readFileSync(path.join(ROOT, 'migrations', '005_user_consent_and_age_verification.sql'), 'utf8').replace(/\r\n/g, '\n');

assert(/\bBEGIN\s*;/i.test(migration), 'migration must be transactional');
assert(/\bCOMMIT\s*;/i.test(migration), 'migration must commit atomically');
assert(
  /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.user_consents\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i.test(migration),
  'migration must remove all inherited/direct browser-role table privileges before regranting the minimum'
);
assert(
  /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.user_consents\s+TO\s+authenticated\s*;/i.test(migration),
  'authenticated browser role must retain only read access'
);

assert(
  /CREATE POLICY\s+"Users can read own consent"[\s\S]*?TO authenticated[\s\S]*?USING\s*\(\(SELECT auth\.uid\(\)\) = user_id\)/i.test(migration005),
  'authenticated SELECT must remain protected by own-row RLS'
);

assert(server.includes("supabaseAdmin\n            .from('user_consents')") || server.includes("supabaseAdmin.from('user_consents')"), 'consent persistence must remain server/service-role based');
assert(server.includes(".from('user_consents')\n            .upsert("), 'consent acceptance must remain a server-side upsert');
assert(server.includes(".from('user_consents')\n            .update({ withdrawn_at:"), 'consent withdrawal must remain a server-side update');

const browserMutationPattern = /\.from\(['"]user_consents['"]\)\s*\.(?:insert|upsert|update|delete)\s*\(/g;
assert.strictEqual((app.match(browserMutationPattern) || []).length, 0, 'app.js must not mutate user_consents directly from the browser');
assert.strictEqual((supabaseClient.match(browserMutationPattern) || []).length, 0, 'supabaseClient.js must not mutate user_consents directly from the browser');

console.log('✅ user_consents least-privilege migration preserves authenticated own-row SELECT and server-only mutation.');
