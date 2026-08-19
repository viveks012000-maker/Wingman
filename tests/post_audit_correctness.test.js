const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(!app.includes('title.textContent = creditMap[tier] + " Credits Added"'),
  'A tier query parameter must never claim credits were minted while purchases are unavailable');
assert.ok(app.includes('cleanUrl.searchParams.delete("tier")'),
  'Stale tier checkout parameters must be removed after the unavailable-purchase notice');

assert.ok(!index.includes("+ msg + '</span>'"),
  'Landing-page toast must not interpolate arbitrary message text into innerHTML');
assert.ok(index.includes('messageSpan.textContent = String(msg == null ? "" : msg);'),
  'Landing-page toast must render message text through textContent');

assert.strictEqual((server.match(/app\.get\('\/api\/csrf-token'/g) || []).length, 1,
  'Exactly one CSRF token issuance route must exist');
assert.ok(server.includes("let csrfToken = cookies['wingman_csrf'];"),
  'The retained CSRF route must reuse an existing token cookie when available');

console.log('✔ Post-audit correctness and DOM-sink regression guard passed.');
