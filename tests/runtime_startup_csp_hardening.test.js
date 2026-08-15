const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-netlify-dist.js'), 'utf8');

assert.ok(serverSource.includes('if (require.main === module) {'), 'server must only bind when executed as entry point');
assert.ok(!serverSource.includes('\nstartWingmanServer();'), 'server import must not unconditionally start a listener');
assert.ok(serverSource.includes('module.exports = { app, startWingmanServer, supabaseAdmin };'), 'server must export app and explicit starter');
assert.ok(!serverSource.includes("'unsafe-eval'"), 'Helmet CSP must not allow unsafe-eval');
assert.ok(!buildSource.includes("'unsafe-eval'"), 'Netlify CSP must not allow unsafe-eval');

const output = execFileSync(process.execPath, ['-e', "require('./server'); process.stdout.write('IMPORT_OK')"], {
  cwd: root,
  encoding: 'utf8',
  timeout: 2500,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    AICREDITS_API_KEY: 'test_key',
    AICREDITS_API_KEY_VISION: 'test_vision_key',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test_anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role'
  }
});
assert.ok(output.endsWith('IMPORT_OK'), 'requiring server.js must return promptly after import');
assert.ok(!output.includes('Secure Wingman 3-Tier Backend Online'), 'requiring server.js must not open a listener');
console.log('✔ Runtime startup side-effect and CSP unsafe-eval hardening passed.');
