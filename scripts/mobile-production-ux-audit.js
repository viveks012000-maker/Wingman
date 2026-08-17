const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = 'https://soft-sawine-30785c.netlify.app';
const API = 'https://wingman-production-c6ce.up.railway.app';
const OUT = path.join(process.cwd(), 'mobile-audit');
fs.mkdirSync(OUT, { recursive: true });

const HARD = [];
const WARN = [];
const INFO = [];

const portraitViewports = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
];
const landscapeViewports = [
  { name: '667x375-landscape', width: 667, height: 375 },
  { name: '844x390-landscape', width: 844, height: 390 },
];

function cleanMessage(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function attachRuntimeCollectors(page, bucket, label) {
  page.on('pageerror', err => bucket.push(`${label} pageerror: ${cleanMessage(err && err.message)}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = cleanMessage(msg.text());
    if (/requestStorageAccess/i.test(text)) return;
    if (/favicon/i.test(text)) return;
    bucket.push(`${label} console.error: ${text}`);
  });
}

async function inspectLayout(page, label, { expectMobileNav = null } = {}) {
  const data = await page.evaluate(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const doc = document.documentElement;
    const body = document.body;
    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    const visible = el => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || '1') === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const rectInfo = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };

    const importantSelectors = [
      '#mobileNavBar', '#topAuthBanner', '#runAnalysisBtn', '#generateIcebreakerBtn', '#runAuditBtn',
      '#chatbox-send-btn', '#simulator-chat-input', '#bioInput', '#auditBioInput', '#screenshotInput'
    ];
    const important = [];
    for (const sel of importantSelectors) {
      const el = document.querySelector(sel);
      if (!visible(el)) continue;
      const r = rectInfo(el);
      if (r.bottom < 0 || r.top > h) continue;
      important.push({ selector: sel, ...r, fontSize: getComputedStyle(el).fontSize });
    }

    const inputFonts = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter(visible)
      .map(el => ({
        id: el.id || el.name || el.tagName.toLowerCase(),
        type: el.type || el.tagName.toLowerCase(),
        fontSize: parseFloat(getComputedStyle(el).fontSize || '0'),
        rect: rectInfo(el),
      }));

    const mobileNav = document.querySelector('#mobileNavBar');
    const navVisible = visible(mobileNav);
    const navButtons = mobileNav ? Array.from(mobileNav.querySelectorAll('.nav-tab-mobile')).filter(visible).map(el => ({
      tab: el.getAttribute('data-tab'),
      ...rectInfo(el)
    })) : [];

    const fixedClips = Array.from(document.querySelectorAll('body *')).filter(el => {
      if (!visible(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > h) return false;
      return r.left < -2 || r.right > w + 2;
    }).slice(0, 20).map(el => ({
      tag: el.tagName,
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className.slice(0, 140) : '',
      rect: rectInfo(el)
    }));

    return {
      innerWidth: w,
      innerHeight: h,
      scrollWidth: Math.max(doc.scrollWidth, body ? body.scrollWidth : 0),
      viewportMeta,
      important,
      inputFonts,
      navVisible,
      navButtons,
      fixedClips,
    };
  });

  if (!/width=device-width/i.test(data.viewportMeta)) HARD.push(`${label}: viewport meta is missing width=device-width`);
  if (data.scrollWidth > data.innerWidth + 2) HARD.push(`${label}: horizontal overflow ${data.scrollWidth}px > viewport ${data.innerWidth}px`);

  for (const el of data.important) {
    if (el.left < -2 || el.right > data.innerWidth + 2) {
      HARD.push(`${label}: ${el.selector} clips horizontally [${el.left.toFixed(1)}, ${el.right.toFixed(1)}] in ${data.innerWidth}px viewport`);
    }
  }
  for (const clip of data.fixedClips) {
    HARD.push(`${label}: fixed/sticky element clips horizontally: ${clip.tag}#${clip.id} ${clip.rect.left.toFixed(1)}..${clip.rect.right.toFixed(1)}`);
  }

  if (expectMobileNav === true) {
    if (!data.navVisible) HARD.push(`${label}: mobile bottom navigation is not visible`);
    if (data.navButtons.length !== 4) HARD.push(`${label}: expected 4 visible mobile nav actions, found ${data.navButtons.length}`);
    for (const b of data.navButtons) {
      if (b.width < 44 || b.height < 44) WARN.push(`${label}: mobile nav target ${b.tab} is ${b.width.toFixed(0)}x${b.height.toFixed(0)} (<44px touch target)`);
    }
  }
  if (expectMobileNav === false && data.navVisible) {
    WARN.push(`${label}: mobile bottom navigation remains visible above 767px`);
  }

  for (const input of data.inputFonts) {
    // iOS Safari commonly auto-zooms focused form controls below 16 CSS px.
    if (input.fontSize > 0 && input.fontSize < 16) {
      WARN.push(`${label}: visible form control #${input.id} computes to ${input.fontSize}px (<16px; iOS focus zoom risk)`);
    }
  }

  INFO.push(`${label}: scrollWidth=${data.scrollWidth}, viewport=${data.innerWidth}x${data.innerHeight}, navVisible=${data.navVisible}, visibleInputs=${data.inputFonts.length}`);
  return data;
}

async function assertPanelReachable(page, tabId, viewportName) {
  const mobileButton = page.locator(`#mobileNavBar [data-tab="${tabId}"]`);
  const mobileVisible = await mobileButton.isVisible().catch(() => false);
  let clicked = false;
  if (mobileVisible) {
    await mobileButton.click();
    clicked = true;
  } else {
    const desktopButton = page.locator(`.nav-tab-desktop[data-tab="${tabId}"]`).first();
    if (await desktopButton.isVisible().catch(() => false)) {
      await desktopButton.click();
      clicked = true;
    }
  }
  if (!clicked) {
    HARD.push(`${viewportName}: no visible navigation control reaches ${tabId}`);
    return;
  }
  await page.waitForTimeout(120);
  const panelVisible = await page.locator(`#${tabId}`).isVisible().catch(() => false);
  if (!panelVisible) HARD.push(`${viewportName}: navigation clicked but #${tabId} is not visible`);
}

async function checkActionNotHiddenByBottomNav(page, selector, label) {
  const loc = page.locator(selector);
  if (!(await loc.isVisible().catch(() => false))) return;
  await loc.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await page.waitForTimeout(60);
  const m = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    const nav = document.querySelector('#mobileNavBar');
    if (!el || !nav) return null;
    const er = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const ns = getComputedStyle(nav);
    const navVisible = ns.display !== 'none' && ns.visibility !== 'hidden' && nr.height > 0;
    return { navVisible, er: { top: er.top, bottom: er.bottom }, nr: { top: nr.top, bottom: nr.bottom }, h: innerHeight };
  }, selector);
  if (m && m.navVisible && m.er.bottom > m.nr.top + 1) {
    HARD.push(`${label}: ${selector} remains covered by fixed mobile nav after scrollIntoView`);
  }
}

async function auditAppViewport(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  attachRuntimeCollectors(page, runtimeErrors, vp.name);
  const response = await page.goto(`${SITE}/app.html?mobileAudit=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  if (!response || response.status() !== 200) HARD.push(`${vp.name}: app navigation status=${response ? response.status() : 'no response'}`);
  await page.waitForTimeout(500);

  const mobileExpected = vp.width <= 767;
  await inspectLayout(page, `${vp.name}/app/analyze`, { expectMobileNav: mobileExpected });

  const tabs = ['analyzeSection', 'icebreakSection', 'optimizeSection', 'chatboxSection'];
  const actionByTab = {
    analyzeSection: '#runAnalysisBtn',
    icebreakSection: '#generateIcebreakerBtn',
    optimizeSection: '#runAuditBtn',
    chatboxSection: '#simulator-chat-input',
  };
  for (const tab of tabs) {
    await assertPanelReachable(page, tab, vp.name);
    await inspectLayout(page, `${vp.name}/app/${tab}`, { expectMobileNav: mobileExpected });
    if (mobileExpected) await checkActionNotHiddenByBottomNav(page, actionByTab[tab], `${vp.name}/${tab}`);
  }

  await page.screenshot({ path: path.join(OUT, `${vp.name}-app.png`), fullPage: true });
  if (runtimeErrors.length) HARD.push(...runtimeErrors);
  await context.close();
}

async function auditPublicPage(browser, route, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  attachRuntimeCollectors(page, errors, `${vp.name}${route}`);
  const res = await page.goto(`${SITE}${route}?mobileAudit=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  if (!res || res.status() !== 200) HARD.push(`${vp.name}${route}: HTTP ${res ? res.status() : 'none'}`);
  await page.waitForTimeout(250);
  await inspectLayout(page, `${vp.name}${route}`);
  if (errors.length) HARD.push(...errors);
  await context.close();
}

async function modalFits(page, id, label) {
  const result = await page.evaluate(id => {
    const modal = document.querySelector(id);
    if (!modal) return { exists: false };
    const cs = getComputedStyle(modal);
    const r = modal.getBoundingClientRect();
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && !modal.classList.contains('hidden') && r.width > 0 && r.height > 0;
    const card = modal.firstElementChild;
    const cr = card ? card.getBoundingClientRect() : r;
    return {
      exists: true, visible,
      card: { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom, width: cr.width, height: cr.height },
      viewport: { width: innerWidth, height: innerHeight },
      overflowY: cs.overflowY
    };
  }, id);
  if (!result.exists || !result.visible) {
    HARD.push(`${label}: ${id} did not become visible`);
    return;
  }
  if (result.card.left < -2 || result.card.right > result.viewport.width + 2) HARD.push(`${label}: ${id} card clips horizontally`);
  if (result.card.height > result.viewport.height + 2 && result.overflowY !== 'auto' && result.overflowY !== 'scroll') {
    HARD.push(`${label}: ${id} card taller than viewport without scrollable modal`);
  }
}

async function auditLoggedOutGates(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const paidRequests = [];
  const errors = [];
  attachRuntimeCollectors(page, errors, '390x844/gates');
  page.on('request', req => {
    const u = req.url();
    if (/\/api\/(analyze|icebreaker|optimize|chat|simulator\/review)(?:\?|$)/.test(u)) paidRequests.push(`${req.method()} ${u}`);
  });
  await page.goto(`${SITE}/app.html?mobileGateAudit=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(500);

  // Icebreaker: preparation must work, action must auth-gate before paid API.
  await page.locator('#mobileNavBar [data-tab="icebreakSection"]').click();
  await page.locator('#bioInput').fill('She likes coffee, hiking, dogs and weekend road trips.');
  await page.locator('#generateIcebreakerBtn').click();
  await page.waitForTimeout(250);
  await modalFits(page, '#authRequiredModal', 'mobile logged-out Icebreaker');
  await page.evaluate(() => { if (typeof window.closeAuthRequiredModal === 'function') window.closeAuthRequiredModal(); });

  // Bio.
  await page.locator('#mobileNavBar [data-tab="optimizeSection"]').click();
  await page.locator('#auditBioInput').fill('Coffee lover, weekend hiker, dog person, always looking for the next road trip.');
  await page.locator('#runAuditBtn').click();
  await page.waitForTimeout(250);
  await modalFits(page, '#authRequiredModal', 'mobile logged-out Bio');
  await page.evaluate(() => { if (typeof window.closeAuthRequiredModal === 'function') window.closeAuthRequiredModal(); });

  // Maeve.
  await page.locator('#mobileNavBar [data-tab="chatboxSection"]').click();
  await page.locator('#simulator-chat-input').fill('Give me one short dating tip.');
  await page.locator('#chatbox-send-btn').click();
  await page.waitForTimeout(250);
  await modalFits(page, '#authRequiredModal', 'mobile logged-out Maeve');
  await page.evaluate(() => { if (typeof window.closeAuthRequiredModal === 'function') window.closeAuthRequiredModal(); });

  // Analyzer upload/crop + auth gate.
  await page.locator('#mobileNavBar [data-tab="analyzeSection"]').click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.locator('#screenshotInput').setInputFiles({ name: 'mobile-audit.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(500);
  if (await page.locator('#cropModal').isVisible().catch(() => false)) {
    await modalFits(page, '#cropModal', 'mobile crop modal');
    const confirm = page.getByRole('button', { name: /Confirm Crop & Use/i });
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
      await page.waitForTimeout(500);
    }
  }
  if (await page.locator('#runAnalysisBtn').isEnabled().catch(() => false)) {
    await page.locator('#runAnalysisBtn').click();
    await page.waitForTimeout(250);
    await modalFits(page, '#authRequiredModal', 'mobile logged-out Analyzer');
  } else {
    HARD.push('mobile logged-out Analyzer: upload completed but runAnalysisBtn did not become enabled');
  }

  if (paidRequests.length) HARD.push(`mobile logged-out gates dispatched paid API requests: ${paidRequests.join(' | ')}`);
  if (errors.length) HARD.push(...errors);
  await page.screenshot({ path: path.join(OUT, '390x844-logged-out-gates.png'), fullPage: true });
  await context.close();
}

async function auditAuthenticatedMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const errors = [];
  attachRuntimeCollectors(page, errors, '390x844/authenticated');
  const email = `viveks012000+wingmanmobile${Date.now()}@gmail.com`;
  const password = `Mob!${Date.now()}x9A`;
  let created = false;
  try {
    await page.goto(`${SITE}/app.html?mobileAuthAudit=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.signUpUser === 'function' && !!window.supabaseClient, null, { timeout: 15000 });
    const signup = await page.evaluate(async ({ email, password }) => {
      const result = await window.signUpUser(email, password);
      return { success: !!result?.success, hasSession: !!result?.session, error: result?.error || null };
    }, { email, password });
    if (!signup.success || !signup.hasSession) {
      HARD.push(`authenticated mobile: disposable signup failed ${signup.error || ''}`);
      return;
    }
    created = true;
    await page.waitForFunction(() => window.currentSupabaseUser && window.state && window.state.creditsStatus === 'loaded', null, { timeout: 20000 });
    await page.waitForTimeout(800);

    const authState = await page.evaluate(() => {
      const email = document.getElementById('userEmailBadge')?.textContent?.trim() || '';
      const credit = document.getElementById('mobileCreditCount')?.textContent?.trim() || document.getElementById('desktopCreditCount')?.textContent?.trim() || '';
      const badge = document.getElementById('userEmailBadge')?.nextElementSibling?.textContent?.trim() || '';
      return { email, credit, badge, stateCredits: window.state?.credits, status: window.state?.creditsStatus };
    });
    INFO.push(`authenticated mobile state: ${JSON.stringify(authState)}`);
    if (authState.stateCredits !== 50) HARD.push(`authenticated mobile: new signup expected 50 credits, got ${authState.stateCredits}`);
    if (!/50 Credits?/i.test(authState.credit)) HARD.push(`authenticated mobile: UI credit badge does not show 50, got "${authState.credit}"`);
    if (authState.badge !== 'Free Plan') HARD.push(`authenticated mobile: expected Free Plan, got "${authState.badge}"`);
    if (authState.email.toLowerCase() !== email.toLowerCase()) HARD.push(`authenticated mobile: email badge mismatch "${authState.email}"`);

    await inspectLayout(page, '390x844/authenticated', { expectMobileNav: true });
    for (const tab of ['analyzeSection', 'icebreakSection', 'optimizeSection', 'chatboxSection']) {
      await assertPanelReachable(page, tab, '390x844/authenticated');
      await inspectLayout(page, `390x844/authenticated/${tab}`, { expectMobileNav: true });
    }
    await page.screenshot({ path: path.join(OUT, '390x844-authenticated.png'), fullPage: true });
  } finally {
    if (created) {
      const cleanup = await page.evaluate(async api => {
        try {
          const authHeaders = typeof window.getSupabaseAuthHeaders === 'function' ? await window.getSupabaseAuthHeaders() : {};
          const res = await fetch(api + '/api/user/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            credentials: 'include'
          });
          return { status: res.status, body: await res.text() };
        } catch (e) {
          return { status: 0, body: String(e && e.message || e) };
        }
      }, API).catch(e => ({ status: 0, body: String(e) }));
      INFO.push(`authenticated mobile cleanup: status=${cleanup.status}`);
      if (cleanup.status !== 200) HARD.push(`authenticated mobile cleanup failed status=${cleanup.status} body=${cleanMessage(cleanup.body)}`);
    }
    if (errors.length) HARD.push(...errors);
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of [...portraitViewports, ...landscapeViewports]) {
      await auditAppViewport(browser, vp);
    }

    // Whole-site public pages at smallest and representative modern phone widths.
    for (const vp of [portraitViewports[0], portraitViewports[3]]) {
      for (const route of ['/', '/terms.html', '/privacy.html', '/refund.html']) {
        await auditPublicPage(browser, route, vp);
      }
    }

    await auditLoggedOutGates(browser);
    await auditAuthenticatedMobile(browser);
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    site: SITE,
    hardFailures: HARD,
    warnings: Array.from(new Set(WARN)),
    info: INFO,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  console.log('=== MOBILE AUDIT INFO ===');
  for (const x of INFO) console.log('INFO:', x);
  console.log('=== MOBILE AUDIT WARNINGS ===');
  for (const x of Array.from(new Set(WARN))) console.log('WARN:', x);
  console.log('=== MOBILE AUDIT HARD FAILURES ===');
  for (const x of HARD) console.log('FAIL:', x);
  console.log(`MOBILE_AUDIT_COUNTS hard=${HARD.length} warnings=${Array.from(new Set(WARN)).length}`);

  if (HARD.length) {
    console.log('MOBILE_PRODUCTION_UX_AUDIT=FAIL');
    process.exit(1);
  }
  console.log('MOBILE_PRODUCTION_UX_AUDIT=PASS');
})().catch(err => {
  console.error('MOBILE_PRODUCTION_UX_AUDIT=CRASH', err && err.stack ? err.stack : err);
  process.exit(2);
});
