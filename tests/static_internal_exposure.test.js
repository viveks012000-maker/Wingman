const assert = require('assert');
const { blockSensitiveFiles } = require('../middleware/security');

function invoke(path) {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const req = { path };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  blockSensitiveFiles(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}

const blocked = [
  '/server.js',
  '/package.json',
  '/PROMPT_SYSTEM_MEMORY.json',
  '/tests/production_readiness_regression.test.js',
  '/middleware/security.js',
  '/migrations/004_cleanup_credit_security_and_rls.sql',
  '/migrations/005_user_consent_and_age_verification.sql',
  '/migrations/nested/anything.sql',
  '/scripts/build-netlify-dist.js',
  '/netlify.toml',
  '/whatever/private_dump.sql'
];
for (const path of blocked) {
  const r = invoke(path);
  assert.strictEqual(r.statusCode, 403, `${path} must be denied`);
  assert.strictEqual(r.nextCalled, false, `${path} must not reach express.static`);
}

for (const path of ['/app.js','/config.js','/supabaseClient.js','/app.html','/style.css','/vendor/supabase.min.js']) {
  const r = invoke(path);
  assert.strictEqual(r.nextCalled, true, `${path} must remain public`);
  assert.strictEqual(r.statusCode, null, `${path} must not be denied`);
}
console.log('✔ Static internal-file denylist behavioral test passed.');
