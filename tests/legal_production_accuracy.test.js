const assert = require('assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const refund = fs.readFileSync(path.join(__dirname, '..', 'refund.html'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
const terms = fs.readFileSync(path.join(__dirname, '..', 'terms.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const addedPages = ['about.html','contact.html','service-delivery.html'].map(f => fs.readFileSync(path.join(__dirname,'..',f),'utf8'));
const allHtml = [index, refund, privacy, terms, ...addedPages];

// Payment verification and fail-closed state
assert.ok(server.includes('razorpayPayments') && !server.includes('ENABLE_MOCK_PAYMENTS'), 'payment routes must use verified provider service, never mock minting');
assert.ok(refund.includes('Paid credit checkout is currently paused and unavailable in production.'), 'policy must disclose live checkout state');
assert.ok(refund.includes('final customer prices'), 'policy must show final approved pricing');
assert.ok(refund.includes('5–7 days or earlier') && !refund.includes('business days'), 'owner calendar-day timeline must be preserved');
assert.ok(refund.includes('original payment method used for purchase'), 'refund destination must be clear');
assert.ok(refund.includes('none of the purchased credits') && refund.includes('generally non-refundable'), 'unused and used eligibility must be clear');
assert.ok(!refund.includes('secure, immutable logs'), 'no unsupported log claims');

// Retention and privacy disclosures
assert.ok(!privacy.includes('up to ninety (90) days'), 'privacy policy must not promise an unverified exact security-log period');
assert.ok(!privacy.includes('up to seven (7) years'), 'privacy policy must not promise an unverified exact transaction-retention period');
assert.ok(privacy.includes('Actual retention can also depend on infrastructure-provider settings.'), 'privacy policy must acknowledge infrastructure retention settings');
assert.ok(privacy.includes('requirements in force at the relevant time'), 'grievance copy must avoid overclaiming a specific statutory procedure');
assert.ok(privacy.includes('Paid checkout is currently unavailable in production.'), 'billing privacy language must reflect production payment state');
for (const policy of [privacy, terms]) {
    assert.ok(policy.includes('Razorpay') && policy.includes('Standard Checkout'), 'policies must explain the prepared provider flow');
    assert.ok(policy.includes('does not store raw card numbers'), 'policies must disclose raw card-data handling');
}
assert.ok(privacy.includes('account-scoped feature history') && privacy.includes('saved feature history'), 'privacy policy must disclose server-side saved feature history');
assert.ok(privacy.includes('saved bio, icebreaker, screenshot-analysis, and chat-history records'), 'privacy policy must disclose saved feature deletion coverage');
assert.ok(!/https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(terms), 'terms page must not import an external Google font that production CSP blocks');
assert.ok(!/https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(privacy), 'privacy page must not import an external Google font that production CSP blocks');

// Verified owner-provided merchant facts, consistently rendered without JavaScript.
for (const html of allHtml) {
 assert.ok(!/Pooja|Haridwar|Uttarakhand/.test(html), 'stale identity must be absent');
 assert.ok(html.includes('Naresh Kumar') && html.includes('Business type: Individual'), 'merchant and business type required');
 assert.ok(html.includes('Ward No. 6, Sadulpur, Churu, Rajasthan, India – 331023'), 'exact verified address required');
 assert.ok(html.includes('+91 9079666632') && html.includes('tel:+919079666632'), 'consistent callable support number required');
 assert.ok(html.includes('support.mywingman@gmail.com'), 'verified support email required');
 for (const file of ['about','contact','terms','privacy','refund','service-delivery']) assert.ok(html.includes('href="'+file+'.html"'), 'all policy links must exist');
 assert.ok(!/never expire/i.test(html), 'no absolute expiration claims');
}

// Safe credit expiration language
assert.ok(terms.includes('Purchased credits do not currently have a scheduled expiration date'), 'Terms must use safe credit expiration wording');

// One-time purchases vs subscriptions
assert.ok(terms.includes('If paid credit purchases are enabled, they will be one-time payments'), 'Terms must clarify one-time purchases');
assert.ok(refund.includes('Planned purchases are one-time credit bundles, not recurring monthly or annual subscriptions'), 'Refund must clarify one-time purchases');
assert.ok(terms.includes('does not connect users with one another') && terms.includes('does not guarantee dating outcomes'), 'Terms must accurately classify Wingman as coaching software rather than a matching service');
assert.ok(!index.includes('real-world dates') && !index.includes('Match Probability'), 'Landing page must not promise dating outcomes or present fictitious probability scores');
assert.ok(index.includes('not customer testimonials') && index.includes('Paid checkout is currently unavailable in production'), 'Landing page must label demonstrations and paid checkout status accurately');

// Additional Terms clauses
assert.ok(terms.includes('ARTICLE XI: OTHER TERMS'), 'Terms must include the additional legal terms article');
assert.ok(terms.includes('We do not claim ownership of your private messages or conversation content.'), 'Terms must preserve user ownership of private messages');
assert.ok(terms.includes('We also do not claim ownership of third-party AI output where we have no legal basis to do so'), 'Terms must avoid unsupported ownership claims over third-party AI output');
assert.ok(terms.includes('To the maximum extent permitted by law, the Service is provided “as is” and “as available,”'), 'Terms must include a general warranty disclaimer');
assert.ok(terms.includes('We may temporarily suspend or terminate access to the Service, or disable an account, on reasonable grounds'), 'Terms must describe reasonable suspension and termination rights');
assert.ok(terms.includes('For material changes, we will provide reasonable notice where appropriate'), 'Terms must provide reasonable notice for material Terms changes');

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
assert.ok(index.includes('"name": "Naresh Kumar"'), 'JSON-LD publisher must reflect verified operator');

console.log('✔ Production legal/privacy/SEO accuracy guard passed.');
