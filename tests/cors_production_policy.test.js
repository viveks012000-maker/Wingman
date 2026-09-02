const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const productionOriginsBlock = server.match(/const productionAllowedOrigins = \[([\s\S]*?)\];/);
assert.ok(productionOriginsBlock, 'Production CORS origin block must exist');
assert.ok(!productionOriginsBlock[1].includes('netlify.app'), 'Production CORS defaults must not trust any Netlify origin after Cloudflare cutover');
assert.ok(!productionOriginsBlock[1].includes('https://mywingman.com'), 'Misdirected mywingman.com must not be a production CORS default');
const productionOriginLines = productionOriginsBlock[1].split(/\r?\n/).map(line => line.trim());
assert.ok(!productionOriginLines.some(line => line === "'https://mywingman.pages.dev'," || line === "'https://mywingman.pages.dev'"), 'Legacy Cloudflare Pages origin must be revoked after cutover');
assert.ok(server.includes("'https://mywingmanapp.com'"), 'Exact custom production origin must be explicitly allowed');
assert.ok(!server.includes("'https://*.pages.dev'"), 'Production defaults must not trust every Cloudflare Pages project');
assert.ok(server.includes("if (origin === 'null') return !IS_PROD;"), 'Opaque/null browser origins must be denied in production');
assert.ok(server.includes('const configuredAllowedOrigins = IS_PROD ? [] : rawConfiguredAllowedOrigins;'), 'production must ignore every configured browser origin');
assert.ok(server.includes('Development may use arbitrary localhost ports for local tooling, but production may not.'), 'Localhost exception must be explicitly development-only');
assert.ok(server.includes('if (!IS_PROD && /^http:'), 'Localhost runtime allowance must be guarded by !IS_PROD');
assert.ok(server.includes('return callback(null, false);'), 'Disallowed browser origins should omit CORS permission without throwing a 500');
assert.ok(server.includes("if (!origin) return true;"), 'Server-to-server requests without Origin must remain available');

const runtimeProbe = `
  const assert = require('assert');
  const request = require('supertest');
  const { app } = require('./server');
  (async () => {
    const attacker = await request(app)
      .options('/api/csrf-token')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'GET');
    assert.strictEqual(attacker.headers['access-control-allow-origin'], undefined);
    const pages = await request(app)
      .options('/api/csrf-token')
      .set('Origin', 'https://mywingman.pages.dev')
      .set('Access-Control-Request-Method', 'GET');
    assert.strictEqual(pages.headers['access-control-allow-origin'], undefined);
    const custom = await request(app)
      .options('/api/csrf-token')
      .set('Origin', 'https://mywingmanapp.com')
      .set('Access-Control-Request-Method', 'GET');
    assert.strictEqual(custom.headers['access-control-allow-origin'], 'https://mywingmanapp.com');
    process.stdout.write('RUNTIME_CORS_OK');
  })().catch(error => { console.error(error); process.exit(1); });
`;
const runtimeOutput = execFileSync(process.execPath, ['-e', runtimeProbe], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://attacker.example',
    AICREDITS_API_KEY: 'test_key',
    AICREDITS_API_KEY_VISION: 'test_vision_key',
    SUPABASE_URL: 'https://gstnghuhhrxtwjdafufd.supabase.co',
    SUPABASE_ANON_KEY: 'test_anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role'
  }
});
assert.ok(runtimeOutput.endsWith('RUNTIME_CORS_OK'), 'runtime production CORS must ignore arbitrary configured origins');

console.log('✔ Production CORS least-privilege policy regression guard passed.');
