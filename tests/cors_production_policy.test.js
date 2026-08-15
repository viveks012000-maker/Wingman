const assert = require('assert');
const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(server.includes("'https://chimerical-granita-c68c5a.netlify.app'"), 'Netlify production origin must remain allowed');
assert.ok(server.includes("'https://wondrous-arithmetic-0ece9d.netlify.app'"), 'Current Netlify demo origin must be explicitly allowed');
assert.ok(server.includes("'https://mywingman.com'"), 'Custom production domain must remain allowed');
assert.ok(!server.includes("'https://*.pages.dev'"), 'Production defaults must not trust every Cloudflare Pages project');
assert.ok(server.includes("if (origin === 'null') return !IS_PROD;"), 'Opaque/null browser origins must be denied in production');
assert.ok(server.includes("if (origin === '*' || origin === 'null' || origin.includes('*')) return false;"), 'Production configured origins must reject wildcard/null values');
assert.ok(server.includes('Development may use arbitrary localhost ports for local tooling, but production may not.'), 'Localhost exception must be explicitly development-only');
assert.ok(server.includes('if (!IS_PROD && /^http:'), 'Localhost runtime allowance must be guarded by !IS_PROD');
assert.ok(server.includes('return callback(null, false);'), 'Disallowed browser origins should omit CORS permission without throwing a 500');
assert.ok(server.includes("if (!origin) return true;"), 'Server-to-server requests without Origin must remain available');

console.log('✔ Production CORS least-privilege policy regression guard passed.');
