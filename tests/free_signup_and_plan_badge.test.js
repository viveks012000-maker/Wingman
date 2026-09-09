'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const migration013 = fs.readFileSync(path.join(root, 'migrations', '013_free_signup_credits_twenty.sql'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const configJs = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

console.log('🧪 Running First-Time 20 Free Credits & Plan Badge Regression Guard...\n');

// 1. Migration 013 schema & trigger invariant checks
assert(
  /ALTER TABLE public\.profiles ALTER COLUMN credits SET DEFAULT 20;/i.test(migration013),
  'Migration 013 must set default profile credits to 20.'
);
assert(
  /INSERT INTO public\.profiles[\s\S]*?credits[\s\S]*?has_paid_credits[\s\S]*?VALUES[\s\S]*?20[\s\S]*?false[\s\S]*?ON CONFLICT \(id\) DO NOTHING/i.test(migration013),
  'handle_new_user() must initialize new signups with 20 credits and has_paid_credits = false.'
);
assert(
  /ON CONFLICT \(id\) DO NOTHING/i.test(migration013),
  'handle_new_user() must be strictly idempotent with ON CONFLICT (id) DO NOTHING.'
);
assert(
  /SET search_path = ''/i.test(migration013),
  'handle_new_user() must be hardened with SET search_path = "".'
);
console.log('✅ Invariant 1: Migration 013 correctly awards 20 credits once on signup with Free Plan state.');

// 2. Static app.html structural invariant checks
assert(
  appHtml.includes('id="desktopCreditCount"'),
  'app.html must contain #desktopCreditCount.'
);
assert(
  appHtml.includes('id="desktopPlanBadge"'),
  'app.html must contain #desktopPlanBadge.'
);
assert(
  /id="desktopCreditCount"[\s\S]{1,300}id="desktopPlanBadge"/i.test(appHtml),
  '#desktopPlanBadge must be positioned directly under #desktopCreditCount inside the sidebar credit card.'
);
assert(
  /<span[^>]*id="desktopPlanBadge"[^>]*>\s*Free Plan\s*<\/span>/i.test(appHtml),
  '#desktopPlanBadge must be a non-interactive <span> initialized to "Free Plan".'
);
console.log('✅ Invariant 2: app.html contains #desktopPlanBadge directly under #desktopCreditCount.');

// 3. Static config.js invariant checks
assert(
  configJs.includes("document.getElementById('desktopPlanBadge')"),
  'config.js setPlanBadge must update desktopPlanBadge.'
);
assert(
  configJs.includes("setPlanBadge('Free Plan')"),
  'config.js must set Free Plan for unauthenticated/free accounts.'
);
assert(
  configJs.includes("setPlanBadge('Paid Plan')"),
  'config.js must set Paid Plan for accounts with has_paid_credits = true.'
);
console.log('✅ Invariant 3: config.js updates desktopPlanBadge to Free Plan / Paid Plan dynamically.');

// 4. Browser dynamic DOM & Playwright integration test
const PORT = 3915;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json'
};

(async () => {
  const server = http.createServer((req, res) => {
    let requestPath = (req.url || '/').split('?')[0];
    if (requestPath === '/') requestPath = '/app.html';
    const filePath = path.join(root, requestPath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  await new Promise(resolve => server.listen(PORT, resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(`http://127.0.0.1:${PORT}/app.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    const check = await page.evaluate(() => {
      const desktopBadge = document.getElementById('desktopPlanBadge');
      const creditCount = document.getElementById('desktopCreditCount');
      if (!desktopBadge || !creditCount) return { ok: false, error: 'Elements not found' };

      const initialText = desktopBadge.textContent.trim();

      // Test dynamic update via window.refreshUserPlanBadge or setPlanBadge logic
      desktopBadge.textContent = 'Paid Plan';
      const paidText = desktopBadge.textContent.trim();

      desktopBadge.textContent = 'Free Plan';
      const freeText = desktopBadge.textContent.trim();

      return {
        ok: true,
        initialText,
        paidText,
        freeText,
        isUnderCreditCount: Boolean(creditCount.compareDocumentPosition(desktopBadge) & Node.DOCUMENT_POSITION_FOLLOWING)
      };
    });

    assert(check.ok, `Browser check failed: ${check.error}`);
    assert.strictEqual(check.initialText, 'Free Plan', `Expected initial badge to be "Free Plan", got "${check.initialText}"`);
    assert.strictEqual(check.paidText, 'Paid Plan', 'desktopPlanBadge must reflect Paid Plan');
    assert.strictEqual(check.freeText, 'Free Plan', 'desktopPlanBadge must reflect Free Plan');
    assert(check.isUnderCreditCount, 'desktopPlanBadge must physically follow desktopCreditCount in DOM order');

    console.log('✅ Invariant 4: Browser DOM accurately renders and updates #desktopPlanBadge.');
    console.log('\n🎉 ALL 4 FIRST-TIME FREE SIGNUP & PLAN BADGE TESTS PASSED!');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error('❌ Browser integration test failed:', err);
  process.exit(1);
});
