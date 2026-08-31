const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3903;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json'
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const server = http.createServer((req, res) => {
    let requestPath = (req.url || '/').split('?')[0];
    if (requestPath === '/') requestPath = '/app.html';
    const filePath = path.join(ROOT, requestPath);
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
    await page.waitForTimeout(150);

    const semantics = await page.evaluate(() => {
      const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const nonNative = [...document.querySelectorAll('[onclick*="openPurchaseModal"]')]
        .filter(el => !/^(BUTTON|A)$/.test(el.tagName));
      const nested = nonNative.filter(el => el.querySelector(focusableSelector));
      const standalone = nonNative.filter(el => !el.querySelector(focusableSelector));
      return {
        nested: nested.map(el => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          tabIndex: el.tabIndex,
          label: el.getAttribute('aria-label'),
          child: (() => {
            const c = el.querySelector(focusableSelector);
            return c ? { tag: c.tagName, id: c.id, tabIndex: c.tabIndex } : null;
          })()
        })),
        standalone: standalone.map(el => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          tabIndex: el.tabIndex,
          label: el.getAttribute('aria-label')
        }))
      };
    });

    assert(semantics.nested.length >= 1, `Expected at least one nested Buy Credits container: ${JSON.stringify(semantics)}`);
    assert(semantics.nested.every(x => x.role !== 'button' && x.tabIndex < 0), `Nested purchase containers must not be promoted to interactive parents: ${JSON.stringify(semantics.nested)}`);
    assert(semantics.nested.every(x => x.child && x.child.tag === 'BUTTON' && x.child.tabIndex >= 0), `Nested native purchase button must remain keyboard accessible: ${JSON.stringify(semantics.nested)}`);
    assert(semantics.standalone.length >= 1, `Expected at least one standalone non-native Buy Credits control: ${JSON.stringify(semantics)}`);
    assert(semantics.standalone.every(x => x.role === 'button' && x.tabIndex >= 0 && x.label === 'Buy credits'), `Standalone non-native Buy Credits controls must retain keyboard semantics: ${JSON.stringify(semantics.standalone)}`);

    const nestedClickCount = await page.evaluate(() => {
      let calls = 0;
      window.openPurchaseModal = () => { calls += 1; };
      document.getElementById('add-credits-btn').click();
      return calls;
    });
    assert(nestedClickCount === 1, `Nested + Add click must open purchase modal exactly once; got ${nestedClickCount}`);

    const outerClickCount = await page.evaluate(() => {
      let calls = 0;
      window.openPurchaseModal = () => { calls += 1; };
      const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const outer = [...document.querySelectorAll('[onclick*="openPurchaseModal"]')]
        .find(el => !/^(BUTTON|A)$/.test(el.tagName) && el.querySelector(focusableSelector));
      outer.click();
      return calls;
    });
    assert(outerClickCount === 1, `Pointer click on outer credit card must still open purchase modal once; got ${outerClickCount}`);

    const keyboardCount = await page.evaluate(() => {
      window.__purchaseKeyboardCalls = 0;
      window.openPurchaseModal = () => { window.__purchaseKeyboardCalls += 1; };
      const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const standalone = [...document.querySelectorAll('[onclick*="openPurchaseModal"]')]
        .find(el => !/^(BUTTON|A)$/.test(el.tagName) && !el.querySelector(focusableSelector));
      standalone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return window.__purchaseKeyboardCalls;
    });
    assert(keyboardCount === 1, `Standalone non-native Buy Credits Enter key must invoke purchase once; got ${keyboardCount}`);

    console.log('✅ Buy Credits controls have no nested interactive parent, preserve keyboard access, and invoke purchase exactly once.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error('❌ Buy Credits nested-interactive regression failed:', err.message);
  process.exit(1);
});
