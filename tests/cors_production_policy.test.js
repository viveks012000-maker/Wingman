const assert = require('assert');
const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const productionOriginsBlock = server.match(/const productionAllowedOrigins = \[([\s\S]*?)\];/);
assert.ok(productionOriginsBlock, 'Production CORS origin block must exist');
assert.ok(!productionOriginsBlock[1].includes('netlify.app'), 'Production CORS defaults must not trust any Netlify origin after Cloudflare cutover');
assert.ok(!productionOriginsBlock[1].includes('https://mywingman.com'), 'Misdirected mywingman.com must not be a production CORS default');
assert.ok(server.includes("'https://mywingman.pages.dev'"), 'Exact Cloudflare Pages production origin must be explicitly allowed');
assert.ok(!server.includes("'https://*.pages.dev'"), 'Production defaults must not trust every Cloudflare Pages project');
assert.ok(server.includes("if (origin === 'null') return !IS_PROD;"), 'Opaque/null browser origins must be denied in production');
assert.ok(server.includes("if (origin === '*' || origin === 'null' || origin.includes('*')) return false;"), 'Production configured origins must reject wildcard/null values');
assert.ok(server.includes("if (origin === 'https://mywingman.com') return false;"), 'Production configured origins must permanently reject the misdirected mywingman.com host');
assert.ok(server.includes("if (/^https:\\/\\/[^/]+\\.netlify\\.app$/i.test(origin)) return false;"), 'Production configured origins must reject every Netlify Pages hostname');
assert.ok(server.includes('Development may use arbitrary localhost ports for local tooling, but production may not.'), 'Localhost exception must be explicitly development-only');
assert.ok(server.includes('if (!IS_PROD && /^http:'), 'Localhost runtime allowance must be guarded by !IS_PROD');
assert.ok(server.includes('return callback(null, false);'), 'Disallowed browser origins should omit CORS permission without throwing a 500');
assert.ok(server.includes("if (!origin) return true;"), 'Server-to-server requests without Origin must remain available');

console.log('✔ Production CORS least-privilege policy regression guard passed.');
