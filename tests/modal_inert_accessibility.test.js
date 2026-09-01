const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3907;
const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg' };

function assert(cond, message, detail) {
  if (!cond) throw new Error(message + (detail ? `: ${JSON.stringify(detail)}` : ''));
}

async function verifyModal(page, id, openFn, closeFn) {
  const initial = await page.evaluate(id => {
    const m = document.getElementById(id);
    return { ariaHidden:m.getAttribute('aria-hidden'), inert:m.inert, inertAttr:m.hasAttribute('inert') };
  }, id);
  assert(initial.ariaHidden === 'true' && initial.inert === true && initial.inertAttr === true, `${id} must initialize closed, aria-hidden and inert`, initial);

  await page.evaluate(openFn => window[openFn](), openFn);
  await page.waitForTimeout(20);
  const opened = await page.evaluate(id => {
    const m = document.getElementById(id);
    return {
      ariaHidden:m.getAttribute('aria-hidden'), inert:m.inert, inertAttr:m.hasAttribute('inert'),
      focused:m.contains(document.activeElement), role:m.getAttribute('role'), ariaModal:m.getAttribute('aria-modal')
    };
  }, id);
  assert(opened.ariaHidden === 'false' && opened.inert === false && opened.inertAttr === false, `${id} must remove inert before interaction`, opened);
  assert(opened.focused === true && opened.role === 'dialog' && opened.ariaModal === 'true', `${id} must be a focused modal dialog`, opened);

  await page.evaluate(closeFn => window[closeFn](), closeFn);
  await page.waitForTimeout(20);
  const closed = await page.evaluate(id => {
    const m = document.getElementById(id);
    return { ariaHidden:m.getAttribute('aria-hidden'), inert:m.inert, inertAttr:m.hasAttribute('inert') };
  }, id);
  assert(closed.ariaHidden === 'true' && closed.inert === true && closed.inertAttr === true, `${id} must restore inert on close`, closed);
}

(async () => {
  const server = http.createServer((req,res) => {
    let rel = req.url.split('?')[0];
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    fs.readFile(file, (err,data) => {
      if (err) { res.writeHead(404); return res.end('Not Found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(PORT, resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page = await context.newPage();

    await page.goto(`http://localhost:${PORT}/index.html`, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(40);
    await verifyModal(page, 'interstitialModal', 'openInterstitialModal', 'closeInterstitialModal');
    await verifyModal(page, 'authRequiredModal', 'openAuthRequiredModal', 'closeAuthRequiredModal');

    // Regression: closing one dialog and immediately opening another must not let
    // the first dialog's delayed focus restoration steal focus from the new dialog.
    await page.evaluate(() => {
      const trigger = document.getElementById('mobile-menu-btn');
      if (trigger) trigger.focus();
      window.openInterstitialModal();
    });
    await page.waitForTimeout(10);
    await page.evaluate(() => {
      window.closeInterstitialModal();
      window.openAuthRequiredModal();
    });
    await page.waitForTimeout(30);
    const transition = await page.evaluate(() => {
      const oldModal = document.getElementById('interstitialModal');
      const newModal = document.getElementById('authRequiredModal');
      return {
        oldHidden: oldModal.getAttribute('aria-hidden'),
        oldInert: oldModal.inert,
        newHidden: newModal.getAttribute('aria-hidden'),
        newInert: newModal.inert,
        newFocused: newModal.contains(document.activeElement),
        activeId: document.activeElement && document.activeElement.id
      };
    });
    assert(transition.oldHidden === 'true' && transition.oldInert === true, 'Closed first dialog must remain inert during immediate transition', transition);
    assert(transition.newHidden === 'false' && transition.newInert === false && transition.newFocused === true, 'Immediate second dialog must retain focus after previous close restoration fires', transition);
    await page.evaluate(() => window.closeAuthRequiredModal());
    await page.waitForTimeout(20);

    // Regression: when a new dialog is opened from a control inside a dialog
    // that is closed as part of the transition, focus must not return to inert content.
    await page.evaluate(() => {
      window.openInterstitialModal();
      const trigger = document.getElementById('interstitialAcceptBtn');
      if (trigger) trigger.focus();
      window.openAuthRequiredModal('Please sign in first.');
    });
    await page.waitForTimeout(20);
    await page.evaluate(() => window.closeAuthRequiredModal());
    await page.waitForTimeout(30);
    const restored = await page.evaluate(() => ({
      active: document.activeElement && document.activeElement.id,
      activeIsAuthTrigger: !!(document.activeElement && document.activeElement.matches('button[onclick*="openAuthRequiredModal"]'))
    }));
    assert(restored.activeIsAuthTrigger, 'Closing auth must not restore focus into the closed interstitial', restored);

    await page.goto(`http://localhost:${PORT}/app.html`, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(40);
    await verifyModal(page, 'authRequiredModal', 'openAuthRequiredModal', 'closeAuthRequiredModal');

    console.log('✅ Closed dialogs are inert; open dialogs are focused; immediate modal transitions preserve focus in the active dialog.');
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('❌ Modal inert accessibility regression failed:', err.message);
  process.exit(1);
});
