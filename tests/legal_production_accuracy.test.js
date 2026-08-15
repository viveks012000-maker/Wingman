const assert = require('assert');
const fs = require('fs');
const path = require('path');

const refund = fs.readFileSync(path.join(__dirname, '..', 'refund.html'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(server.includes("if (IS_PROD || process.env.ENABLE_MOCK_PAYMENTS !== 'true')"), 'production payment verification must remain disabled');
assert.ok(server.includes("Production payment gateway integration pending. Real payment gateway required."), 'payment endpoint must remain fail-closed');
assert.ok(refund.includes('Paid credit checkout is currently paused/deferred and is not available in production.'), 'refund policy must disclose current payment availability');
assert.ok(refund.includes('anticipated pricing schedule only'), 'listed future prices must not be presented as a live purchase offer');
assert.ok(!refund.includes('Users acquire credit bundles through authorized payment gateways'), 'refund page must not claim active paid checkout');
assert.ok(!refund.includes('secure, immutable logs'), 'refund page must not make an unsupported immutable-log claim');
assert.ok(refund.includes('If paid checkout is enabled in the future'), 'refund/payment terms must be conditional while checkout is disabled');

assert.ok(!privacy.includes('up to ninety (90) days'), 'privacy policy must not promise an unverified exact security-log period');
assert.ok(!privacy.includes('up to seven (7) years'), 'privacy policy must not promise an unverified exact transaction-retention period');
assert.ok(privacy.includes('Actual retention can also depend on infrastructure-provider settings.'), 'privacy policy must acknowledge infrastructure retention settings');
assert.ok(privacy.includes('requirements in force at the relevant time'), 'grievance copy must avoid overclaiming a specific statutory procedure');
assert.ok(privacy.includes('Paid checkout is currently disabled.'), 'billing privacy language must reflect production payment state');

console.log('✔ Production legal/privacy accuracy guard passed.');
