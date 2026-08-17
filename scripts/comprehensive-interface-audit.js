const { chromium, firefox, webkit, devices } = require('playwright');

const SITE = process.env.SITE || 'https://soft-sawine-30785c.netlify.app';
const API = process.env.API || 'https://wingman-production-c6ce.up.railway.app';
const EXPECTED_SHA = process.env.EXPECTED_SHA || '';

const failures = [];
const warnings = [];
const notes = [];

function fail(scope, message, data) {
  failures.push({ scope, message, data });
  console.error(`FAIL [${scope}] ${message}`, data || '');
}
function warn(scope, message, data) {
  warnings.push({ scope, message, data });
  console.warn(`WARN [${scope}] ${message}`, data || '');
}
function note(scope, message, data) {
  notes.push({ scope, message, data });
  console.log(`PASS/INFO [${scope}] ${message}`, data || '');
}

async function get(url, opts = {}) {
  const r = await fetch(url, { redirect: 'follow', ...opts });
  const text = await r.text();
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), text, url: r.url };
}

function visibleDomAuditScript(isMobile) {
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const accessibleName = (el) => {
    const aria = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || '').trim();
    if (aria) return aria;
    const txt = (el.innerText || el.textContent || '').trim();
    if (txt) return txt;
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && (lab.innerText || lab.textContent || '').trim()) return (lab.innerText || lab.textContent).trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel && (parentLabel.innerText || parentLabel.textContent || '').trim()) return (parentLabel.innerText || parentLabel.textContent).trim();
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder').trim();
    if (el.getAttribute('alt')) return el.getAttribute('alt').trim();
    return '';
  };
  const selectorFor = (el) => {
    if (el.id) return `#${el.id}`;
    const cls = [...el.classList].slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  const width = window.innerWidth;
  const height = window.innerHeight;
  const interactives = [...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"]')].filter(isVisible);
  const unnamed = interactives.filter(el => !accessibleName(el)).map(selectorFor);
  const offscreenInteractive = interactives.filter(el => {
    const r = el.getBoundingClientRect();
    return r.right > width + 2 || r.left < -2;
  }).map(el => ({ selector: selectorFor(el), rect: el.getBoundingClientRect().toJSON ? el.getBoundingClientRect().toJSON() : {left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width} }));

  const formControls = [...document.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(isVisible);
  const smallFontControls = isMobile ? formControls.filter(el => parseFloat(getComputedStyle(el).fontSize || '0') < 16).map(el => ({ selector: selectorFor(el), fontSize: getComputedStyle(el).fontSize })) : [];

  const keyTouchTargets = isMobile ? [...document.querySelectorAll('.nav-tab-mobile,.primary-btn,.premium-action-btn,#chatbox-send-btn,#interstitialAcceptBtn,#authRequiredModal button,#purchaseModal button')]
    .filter(isVisible)
    .map(el => { const r = el.getBoundingClientRect(); return { selector: selectorFor(el), width: Math.round(r.width), height: Math.round(r.height), text: (el.innerText || '').trim().slice(0, 60) }; })
    .filter(x => x.width < 40 || x.height < 40) : [];

  const imgsMissingAlt = [...document.images].filter(img => isVisible(img) && !img.hasAttribute('alt')).map(selectorFor);
  const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
  const bodyText = (document.body?.innerText || '').trim();

  return {
    innerWidth: width,
    innerHeight: height,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    hasHorizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) > width + 2,
    viewportMeta,
    bodyTextLength: bodyText.length,
    h1Count: document.querySelectorAll('h1').length,
    unnamed,
    offscreenInteractive,
    smallFontControls,
    keyTouchTargets,
    imgsMissingAlt,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    lang: document.documentElement.lang || ''
  };
}

async function auditPage(browser, contextOptions, path, label, isMobile, appChecks = false) {
  const scope = `${label}:${path}`;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', r => {
    const u = r.url();
    if (r.status() >= 400 && u.startsWith(SITE)) badResponses.push({ status: r.status(), url: u });
  });

  let response;
  try {
    response = await page.goto(SITE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(900);
  } catch (e) {
    fail(scope, 'navigation failed', String(e));
    await context.close();
    return;
  }
  if (!response || response.status() !== 200) fail(scope, `expected HTTP 200, got ${response ? response.status() : 'no response'}`);

  const d = await page.evaluate(visibleDomAuditScript, isMobile);
  if (d.bodyTextLength < 20) fail(scope, 'page appears effectively blank', d.bodyTextLength);
  if (!d.lang) fail(scope, 'html lang attribute missing');
  if (isMobile && !/width=device-width/i.test(d.viewportMeta)) fail(scope, 'mobile viewport meta missing/incorrect', d.viewportMeta);
  if (d.hasHorizontalOverflow) fail(scope, 'document has horizontal overflow', { innerWidth: d.innerWidth, docScrollWidth: d.docScrollWidth, bodyScrollWidth: d.bodyScrollWidth });
  if (d.offscreenInteractive.length) fail(scope, 'visible interactive controls extend beyond viewport horizontally', d.offscreenInteractive.slice(0, 12));
  if (d.unnamed.length) fail(scope, 'visible interactive controls lack an accessible name', d.unnamed.slice(0, 20));
  if (d.smallFontControls.length) fail(scope, 'mobile form controls below 16px can trigger iOS focus zoom', d.smallFontControls);
  if (d.keyTouchTargets.length) fail(scope, 'key mobile touch targets are smaller than 40x40 CSS px', d.keyTouchTargets.slice(0, 20));
  if (d.imgsMissingAlt.length) warn(scope, 'visible images without alt attribute', d.imgsMissingAlt.slice(0, 12));
  if (!d.title) fail(scope, 'document title missing');
  if (!d.description && path !== '/robots.txt' && path !== '/sitemap.xml') warn(scope, 'meta description missing');

  if (pageErrors.length) fail(scope, 'pageerror events observed', pageErrors);
  const meaningfulConsoleErrors = consoleErrors.filter(x => !/requestStorageAccess/i.test(x));
  if (meaningfulConsoleErrors.length) fail(scope, 'console.error observed', meaningfulConsoleErrors.slice(0, 12));
  const meaningfulBad = badResponses.filter(x => !/favicon\.ico/i.test(x.url));
  if (meaningfulBad.length) warn(scope, 'same-origin resources returned 4xx/5xx', meaningfulBad.slice(0, 12));

  if (appChecks) {
    if (isMobile) {
      const nav = page.locator('#mobileNavBar');
      if (!(await nav.isVisible().catch(() => false))) fail(scope, 'mobile bottom navigation is not visible');
      const tabs = page.locator('.nav-tab-mobile[data-tab]');
      const count = await tabs.count();
      if (count !== 4) fail(scope, `expected 4 mobile navigation tabs, got ${count}`);
      for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        const target = await tab.getAttribute('data-tab');
        await tab.click();
        await page.waitForTimeout(120);
        if (target && !(await page.locator('#' + target).isVisible().catch(() => false))) fail(scope, `mobile nav target did not become visible: ${target}`);
        const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2);
        if (overflow) fail(scope, `horizontal overflow after switching to ${target}`);
      }
    } else {
      if (await page.locator('#mobileNavBar').isVisible().catch(() => false)) fail(scope, 'mobile bottom nav is visible on desktop viewport');
    }

    // Logged-out preparation must remain usable without dispatching paid AI.
    const paidRequests = [];
    page.on('request', req => {
      if (/\/api\/(analyze|icebreaker|optimize|chat|simulator\/review)(\?|$)/.test(req.url())) paidRequests.push(req.url());
    });

    await page.evaluate(() => window.switchTab && window.switchTab('icebreakSection'));
    const bio = page.locator('#bioInput');
    if (await bio.count()) {
      await bio.fill('She loves hiking, coffee shops, dogs, and weekend road trips.');
      const btn = page.locator('#generateIcebreakerBtn');
      if (await btn.isDisabled().catch(() => true)) fail(scope, 'logged-out Icebreaker preparation button stayed disabled after valid input');
      await btn.click();
      await page.waitForTimeout(250);
      if (paidRequests.length) fail(scope, 'logged-out Icebreaker dispatched a paid API request', paidRequests);
      const authVisible = await page.locator('#authRequiredModal').isVisible().catch(() => false);
      if (!authVisible) fail(scope, 'logged-out Icebreaker did not show auth-required modal');
      if (authVisible) {
        const modalRect = await page.locator('#authRequiredModal').boundingBox();
        if (modalRect && (modalRect.x < -2 || modalRect.x + modalRect.width > d.innerWidth + 2)) fail(scope, 'auth modal overflows viewport horizontally', modalRect);
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => { if (typeof window.closeAuthRequiredModal === 'function') window.closeAuthRequiredModal(); });
      }
    }

    await page.evaluate(() => window.switchTab && window.switchTab('chatboxSection'));
    const chatInput = page.locator('#simulator-chat-input');
    if (await chatInput.count()) {
      await chatInput.fill('hello there');
      const send = page.locator('#chatbox-send-btn');
      if (await send.isDisabled().catch(() => true)) fail(scope, 'Maeve Send stayed disabled after valid logged-out text');
      const fontSize = await chatInput.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      if (isMobile && fontSize < 16) fail(scope, 'Maeve mobile input is below 16px', fontSize);
    }
  }

  note(scope, 'page/interface audit completed');
  await context.close();
}

async function authenticatedLayoutAudit(browser, contextOptions, label, isMobile) {
  const scope = `${label}:authenticated`;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(SITE + '/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.signUpUser === 'function' && window.supabaseClient, null, { timeout: 15000 });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `viveks012000+uiaudit-${suffix}@gmail.com`;
  const password = `UiAudit!${Date.now()}Aa`;
  let signup;
  try {
    signup = await page.evaluate(async ({email, password}) => {
      const r = await window.signUpUser(email, password);
      return { success: !!r?.success, confirmationRequired: !!r?.confirmationRequired, hasSession: !!r?.session };
    }, { email, password });
  } catch (e) {
    fail(scope, 'disposable signup threw', String(e));
  }
  if (!signup || !signup.success || !signup.hasSession) {
    fail(scope, 'disposable signup did not establish an authenticated session', signup);
    await context.close();
    return;
  }
  await page.waitForFunction(() => window.currentSupabaseUser && window.currentSupabaseUser.email, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const creditText = await page.locator(isMobile ? '#mobileCreditCount' : '#desktopCreditCount').textContent().catch(() => '');
  if (!/50\s+Credits?/i.test(creditText || '')) fail(scope, 'new authenticated UI did not show canonical 50-credit balance', creditText);

  const emailText = await page.locator('#userEmailBadge').textContent().catch(() => '');
  if (!emailText || !emailText.includes('+uiaudit-')) fail(scope, 'authenticated email badge did not render disposable account', emailText);

  const planText = await page.locator('#userEmailBadge + p').textContent().catch(() => '');
  if (!/Free Plan/i.test(planText || '')) fail(scope, 'new 50-credit account did not render Free Plan', planText);

  // Persist real consent using the same frontend path; this should not spend credits.
  const consent = await page.evaluate(async () => {
    try {
      const headers = await window.getSupabaseAuthHeaders();
      const r = await fetch(window.getApiBase() + '/api/consent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ age18Plus: true, aiProcessingConsent: true }) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch (e) { return { status: 0, body: { error: String(e) } }; }
  });
  if (consent.status !== 200 || !consent.body?.success) fail(scope, 'authenticated consent persistence failed in UI context', consent);
  await page.evaluate(() => { if (typeof window.checkServerConsentStatus === 'function') return window.checkServerConsentStatus(); });
  await page.waitForTimeout(250);

  const d = await page.evaluate(visibleDomAuditScript, isMobile);
  if (d.hasHorizontalOverflow) fail(scope, 'authenticated dashboard has horizontal overflow', d);
  if (d.offscreenInteractive.length) fail(scope, 'authenticated visible controls extend horizontally outside viewport', d.offscreenInteractive.slice(0, 20));
  if (d.smallFontControls.length) fail(scope, 'authenticated mobile form controls below 16px', d.smallFontControls);
  if (d.keyTouchTargets.length) fail(scope, 'authenticated key mobile touch targets below 40x40', d.keyTouchTargets.slice(0, 20));

  // Exercise all four dashboard tabs without spending credits.
  const tabs = ['analyzeSection','icebreakSection','optimizeSection','chatboxSection'];
  for (const target of tabs) {
    await page.evaluate(target => window.switchTab(target), target);
    await page.waitForTimeout(100);
    if (!(await page.locator('#' + target).isVisible().catch(() => false))) fail(scope, `authenticated tab not visible after switch: ${target}`);
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2);
    if (over) fail(scope, `authenticated horizontal overflow on ${target}`);
  }

  if (pageErrors.length) fail(scope, 'authenticated pageerror events observed', pageErrors);
  const meaningfulConsoleErrors = consoleErrors.filter(x => !/requestStorageAccess/i.test(x));
  if (meaningfulConsoleErrors.length) fail(scope, 'authenticated console.error observed', meaningfulConsoleErrors.slice(0, 12));

  // Delete the disposable account through the production backend.
  const deletion = await page.evaluate(async () => {
    try {
      const headers = await window.getSupabaseAuthHeaders();
      const r = await fetch(window.getApiBase() + '/api/user/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch (e) { return { status: 0, body: { error: String(e) } }; }
  });
  if (deletion.status !== 200 || !deletion.body?.success) fail(scope, 'disposable account cleanup failed', deletion);
  else note(scope, 'authenticated disposable account created, audited, consented, and deleted cleanly');
  await context.close();
}

(async () => {
  console.log('=== STATIC PRODUCTION SURFACE ===');
  const required = ['/', '/app', '/terms.html', '/privacy.html', '/refund.html', '/robots.txt', '/sitemap.xml', '/release.json'];
  for (const p of required) {
    const r = await get(SITE + p + (p.includes('?') ? '&' : '?') + 'audit=' + Date.now());
    if (r.status !== 200) fail('surface', `${p} expected 200 got ${r.status}`);
    else note('surface', `${p} returned 200`);
    if (p === '/release.json' && EXPECTED_SHA) {
      try {
        const j = JSON.parse(r.text);
        if (j.sourceCommit !== EXPECTED_SHA) fail('surface', 'release.json sourceCommit does not match expected main', { expected: EXPECTED_SHA, actual: j.sourceCommit });
      } catch (e) { fail('surface', 'release.json is invalid JSON', String(e)); }
    }
  }
  const unknown = await get(SITE + '/definitely-not-a-real-wingman-route-' + Date.now());
  if (unknown.status !== 404) fail('surface', `unknown path should be 404, got ${unknown.status}`);
  else note('surface', 'unknown path correctly returns 404');

  const browserMap = { chromium, firefox, webkit };
  const matrix = [
    { name: 'chromium-1440x900', engine: 'chromium', opts: { viewport: { width: 1440, height: 900 } }, mobile: false },
    { name: 'chromium-1024x768', engine: 'chromium', opts: { viewport: { width: 1024, height: 768 } }, mobile: false },
    { name: 'firefox-1366x768', engine: 'firefox', opts: { viewport: { width: 1366, height: 768 } }, mobile: false },
    { name: 'webkit-1366x768', engine: 'webkit', opts: { viewport: { width: 1366, height: 768 } }, mobile: false },
    { name: 'chromium-320x568', engine: 'chromium', opts: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }, mobile: true },
    { name: 'chromium-360x800', engine: 'chromium', opts: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }, mobile: true },
    { name: 'chromium-412x915', engine: 'chromium', opts: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }, mobile: true },
    { name: 'webkit-iPhone-SE', engine: 'webkit', opts: { ...devices['iPhone SE'] }, mobile: true },
    { name: 'webkit-iPhone-13', engine: 'webkit', opts: { ...devices['iPhone 13'] }, mobile: true }
  ];
  const pages = ['/', '/app', '/terms.html', '/privacy.html', '/refund.html'];
  const launched = {};
  try {
    for (const item of matrix) {
      if (!launched[item.engine]) launched[item.engine] = await browserMap[item.engine].launch({ headless: true });
      for (const p of pages) {
        await auditPage(launched[item.engine], item.opts, p, item.name, item.mobile, p === '/app');
      }
    }

    // Real signed-in layout at representative phone + laptop sizes, no paid AI calls.
    await authenticatedLayoutAudit(launched.chromium, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 'chromium-auth-mobile-390x844', true);
    await authenticatedLayoutAudit(launched.chromium, { viewport: { width: 1366, height: 768 } }, 'chromium-auth-desktop-1366x768', false);
  } finally {
    for (const b of Object.values(launched)) await b.close().catch(() => {});
  }

  console.log('\n=== AUDIT SUMMARY ===');
  console.log(JSON.stringify({ failures, warnings, notesCount: notes.length }, null, 2));
  if (failures.length) {
    console.error(`COMPREHENSIVE_INTERFACE_AUDIT=FAIL (${failures.length} failures, ${warnings.length} warnings)`);
    process.exit(2);
  }
  console.log(`COMPREHENSIVE_INTERFACE_AUDIT=PASS (${warnings.length} warnings)`);
})().catch(err => {
  console.error('AUDIT_FATAL', err);
  process.exit(3);
});
