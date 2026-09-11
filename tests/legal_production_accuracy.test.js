const assert = require('assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const refund = fs.readFileSync(path.join(__dirname, '..', 'refund.html'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
const terms = fs.readFileSync(path.join(__dirname, '..', 'terms.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const allHtml = [index, refund, privacy, terms];

// Payment verification and fail-closed state
assert.ok(server.includes("if (IS_PROD || process.env.ENABLE_MOCK_PAYMENTS !== 'true')"), 'production payment verification must remain disabled');
assert.ok(server.includes("Production payment gateway integration pending. Real payment gateway required."), 'payment endpoint must remain fail-closed');
assert.ok(refund.includes('Paid credit checkout is currently paused/deferred and is not available in production.'), 'refund policy must disclose current payment availability');
assert.ok(refund.includes('anticipated pricing schedule only'), 'listed future prices must not be presented as a live purchase offer');
assert.ok(!refund.includes('Users acquire credit bundles through authorized payment gateways'), 'refund page must not claim active paid checkout');
assert.ok(!refund.includes('secure, immutable logs'), 'refund page must not make an unsupported immutable-log claim');
assert.ok(refund.includes('If paid checkout is enabled in the future'), 'refund/payment terms must be conditional while checkout is disabled');

// Retention and privacy disclosures
assert.ok(!privacy.includes('up to ninety (90) days'), 'privacy policy must not promise an unverified exact security-log period');
assert.ok(!privacy.includes('up to seven (7) years'), 'privacy policy must not promise an unverified exact transaction-retention period');
assert.ok(privacy.includes('Actual retention can also depend on infrastructure-provider settings.'), 'privacy policy must acknowledge infrastructure retention settings');
assert.ok(privacy.includes('requirements in force at the relevant time'), 'grievance copy must avoid overclaiming a specific statutory procedure');
assert.ok(privacy.includes('Paid checkout is currently disabled.'), 'billing privacy language must reflect production payment state');
assert.ok(!/https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(terms), 'terms page must not import an external Google font that production CSP blocks');
assert.ok(!/https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(privacy), 'privacy page must not import an external Google font that production CSP blocks');

// Operator identity & location locking
for (const html of allHtml) {
  assert.ok(!/Naresh/i.test(html), 'Old operator Naresh must not appear in any public HTML');
  assert.ok(!/Churu/i.test(html), 'Old location Churu must not appear in any public HTML');
  assert.ok(!/Rajasthan/i.test(html), 'Old state Rajasthan must not appear in any public HTML');
  assert.ok(!/never expire/i.test(html), 'Absolute "never expire" claims must not appear in any public HTML');
}

// Pooja as sole operator and Haridwar, Uttarakhand as location
assert.ok(terms.includes('owned and operated by Pooja'), 'Terms must identify Pooja as operator');
assert.ok(terms.includes('Haridwar, Uttarakhand, India'), 'Terms must state Haridwar, Uttarakhand, India');
assert.ok(privacy.includes('Pooja (Operator & Data Fiduciary)'), 'Privacy must identify Pooja as Data Fiduciary');
assert.ok(privacy.includes('Haridwar, Uttarakhand, India'), 'Privacy must state Haridwar, Uttarakhand, India');
assert.ok(refund.includes('owned and operated by Pooja, located in Haridwar, Uttarakhand, India'), 'Refund must identify Pooja and Haridwar');
assert.ok(index.includes('owned and operated by Pooja (Trading as MyWingman). Haridwar, Uttarakhand, India'), 'Index footer must identify Pooja and Haridwar');

// Safe credit expiration language
assert.ok(terms.includes('Purchased credits do not currently have a scheduled expiration date'), 'Terms must use safe credit expiration wording');

// One-time purchases vs subscriptions
assert.ok(terms.includes('Credit purchases are one-time payments and do not constitute recurring monthly or annual subscriptions'), 'Terms must clarify one-time purchases');
assert.ok(refund.includes('Future purchases will consist of one-time credit bundles, not recurring monthly or annual subscriptions'), 'Refund must clarify one-time purchases');

// Account deletion disclosures
assert.ok(privacy.includes('Settings modal') && privacy.includes('/api/user/delete-account'), 'Privacy must disclose in-app deletion via Settings modal and API endpoint');

// Auth methods disclosed
assert.ok(privacy.includes('Email & Password Authentication') && privacy.includes('Google OAuth 2.0'), 'Privacy must disclose both Email and Google OAuth auth methods');

// Storage & cookie disclosures
assert.ok(privacy.includes('wingman_csrf') && privacy.includes('localStorage'), 'Privacy must disclose wingman_csrf cookie and localStorage boundaries');

// Analytics disclosures
assert.ok(privacy.includes('Cloudflare Pages Web Analytics') && privacy.includes('/api/analytics/event'), 'Privacy must disclose Cloudflare Pages beacon and server event endpoint');
assert.ok(!privacy.includes('Google Analytics'), 'Privacy must not load or claim active Google Analytics');
assert.ok(!privacy.includes('Meta Pixel'), 'Privacy must not load or claim active Meta Pixel');
assert.ok(privacy.includes('commercial tracking pixels'), 'Privacy must explicitly disclaim third-party tracking pixels');

// Canonical links on all legal documents
assert.ok(terms.includes('<link rel="canonical" href="https://mywingmanapp.com/terms.html" />'), 'Terms must have canonical link');
assert.ok(privacy.includes('<link rel="canonical" href="https://mywingmanapp.com/privacy.html" />'), 'Privacy must have canonical link');
assert.ok(refund.includes('<link rel="canonical" href="https://mywingmanapp.com/refund.html" />'), 'Refund must have canonical link');

// Schema.org JSON-LD on landing page
assert.ok(index.includes('application/ld+json'), 'Index must have JSON-LD structured data');
assert.ok(index.includes('"@type": "WebSite"'), 'JSON-LD must include WebSite');
assert.ok(index.includes('"@type": "WebApplication"'), 'JSON-LD must include WebApplication');
assert.ok(index.includes('"name": "Pooja"'), 'JSON-LD publisher/creator must be Pooja');

console.log('✔ Production legal/privacy/SEO accuracy guard passed.');
