const { chromium, firefox, webkit, devices } = require('playwright');
const axeSource = require('axe-core').source;

const SITE = process.env.SITE;
const EXPECTED_SHA = process.env.EXPECTED_SHA;
const failures = [];
const warnings = [];
let createdEmail = null;
let cleanupAttempted = false;

function fail(scope, message, details) {
  failures.push({ scope, message, details });
  console.error(`FAIL [${scope}] ${message}`, details || '');
}
function warn(scope, message, details) {
  warnings.push({ scope, message, details });
  console.warn(`WARN [${scope}] ${message}`, details || '');
}
function pass(scope, message) { console.log(`PASS [${scope}] ${message}`); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, attempts = 8) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
      const text = await r.text();
      return { status: r.status, text, headers: Object.fromEntries(r.headers.entries()) };
    } catch (e) {
      last = e;
      if (i < attempts) await sleep(Math.min(1000 * i, 4000));
    }
  }
  throw last;
}

async function waitForExactRelease() {
  const scope = 'deployment';
  for (let i = 1; i <= 30; i++) {
    try {
      const r = await fetchWithRetry(`${SITE}/release.json?audit=${Date.now()}-${i}`, 2);
      if (r.status === 200) {
        const j = JSON.parse(r.text);
        console.log(`release attempt ${i}: ${j.sourceCommit}`);
        if (j.sourceCommit === EXPECTED_SHA) {
          pass(scope, `Netlify release exactly matches ${EXPECTED_SHA}`);
          return;
        }
      }
    } catch (e) { console.warn(`release attempt ${i} transient error:`, String(e)); }
    await sleep(4000);
  }
  throw new Error(`Netlify did not reach expected SHA ${EXPECTED_SHA}`);
}

async function injectAxe(page) {
  await page.addScriptTag({ content: axeSource });
}
async function axeSerious(page, scope, include) {
  await injectAxe(page);
  const result = await page.evaluate(async ({ include }) => {
    const opts = { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } };
    const ctx = include ? { include: [[include]] } : document;
    const r = await window.axe.run(ctx, opts);
    return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 6).map(n => ({ target: n.target, summary: n.failureSummary }))
    }));
  }, { include });
  if (result.length) fail(scope, 'axe serious/critical WCAG violations', result);
  else pass(scope, 'axe serious/critical WCAG scan clean');
}

async function basicGeometry(page, scope) {
  const m = await page.evaluate(() => ({
    innerWidth: innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: document.querySelector('meta[name="viewport"]')?.content || '',
    title: document.title,
    lang: document.documentElement.lang,
    description: document.querySelector('meta[name="description"]')?.content || ''
  }));
  if (Math.max(m.doc, m.body) > m.innerWidth + 2) fail(scope, 'horizontal page overflow', m);
  if (!m.title) fail(scope, 'missing document title');
  if (!m.lang) fail(scope, 'missing html lang');
  if (!m.description) warn(scope, 'missing meta description');
  pass(scope, `geometry checked at ${m.innerWidth}px`);
}

async function internalLinks(page, scope) {
  const data = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')];
    return links.map(a => ({ href: a.getAttribute('href'), text: (a.innerText || a.getAttribute('aria-label') || '').trim() }));
  });
  const seen = new Set();
  for (const l of data) {
    if (!l.href || /^(mailto:|tel:|javascript:)/i.test(l.href) || /^https?:\/\//i.test(l.href)) continue;
    if (l.href.startsWith('#')) {
      const id = decodeURIComponent(l.href.slice(1));
      if (id && !(await page.locator(`#${CSS.escape ? '' : ''}`).count().catch(()=>0))) {
        const exists = await page.evaluate(id => !!document.getElementById(id), id);
        if (!exists) fail(scope, `broken in-page anchor ${l.href}`);
      }
      continue;
    }
    const noHash = l.href.split('#')[0] || '/';
    if (seen.has(noHash)) continue;
    seen.add(noHash);
    const target = new URL(noHash, SITE + page.url().replace(SITE, '')).toString();
    try {
      const r = await fetchWithRetry(target + (target.includes('?') ? '&' : '?') + 'auditlink=' + Date.now(), 3);
      if (r.status >= 400) fail(scope, `internal link returned ${r.status}: ${l.href}`);
    } catch (e) { fail(scope, `internal link request failed: ${l.href}`, String(e)); }
  }
  pass(scope, 'internal links checked');
}

function visibleControlMetricsScript() {
  const vis = e => {
    const s = getComputedStyle(e); const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll('input:not([type=hidden]),textarea,select,button,a[href]')].filter(vis).map(e => {
    const r=e.getBoundingClientRect(); const s=getComputedStyle(e);
    return { id:e.id, tag:e.tagName, type:e.getAttribute('type'), text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').trim().slice(0,80), font:parseFloat(s.fontSize), w:r.width,h:r.height,left:r.left,right:r.right,tabIndex:e.tabIndex, disabled:!!e.disabled };
  });
}

async function landingMobileChecks(browser, options, label) {
  const scope = `${label}:landing`;
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  await page.goto(SITE + '/', { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForTimeout(500);
  await basicGeometry(page, scope);
  await internalLinks(page, scope);
  await axeSerious(page, scope);

  // Hamburger open and close state.
  const menuBtn = page.locator('#mobile-menu-btn');
  if (!(await menuBtn.isVisible())) fail(scope, 'mobile menu button not visible');
  else {
    const b = await menuBtn.boundingBox();
    if (b && (b.width < 40 || b.height < 40)) fail(scope, 'mobile menu touch target <40x40', b);
    await menuBtn.click(); await page.waitForTimeout(80);
    let st = await page.evaluate(() => ({
      open: mobileMenu.classList.contains('opacity-100'), blocked: mobileMenu.classList.contains('pointer-events-none'),
      icon: document.getElementById('menu-icon').textContent.trim(), expanded: document.getElementById('mobile-menu-btn').getAttribute('aria-expanded'),
      label: document.getElementById('mobile-menu-btn').getAttribute('aria-label'), overflow: document.body.style.overflow
    }));
    if (!st.open || st.blocked || st.icon!=='close' || st.expanded!=='true' || st.label!=='Close navigation menu' || st.overflow!=='hidden') fail(scope,'mobile menu open state incorrect',st);
    await menuBtn.click(); await page.waitForTimeout(80);
    st = await page.evaluate(() => ({
      hidden: mobileMenu.classList.contains('opacity-0'), blocked: mobileMenu.classList.contains('pointer-events-none'),
      icon: document.getElementById('menu-icon').textContent.trim(), expanded: document.getElementById('mobile-menu-btn').getAttribute('aria-expanded'),
      label: document.getElementById('mobile-menu-btn').getAttribute('aria-label'), overflow: document.body.style.overflow
    }));
    if (!st.hidden || !st.blocked || st.icon!=='menu' || st.expanded!=='false' || st.label!=='Open navigation menu' || st.overflow!=='') fail(scope,'mobile menu close state incorrect',st);
    else pass(scope,'mobile menu opens and closes cleanly');
  }

  // Consent modal semantics and controls.
  await page.evaluate(() => window.openInterstitialModal()); await page.waitForTimeout(80);
  const inter = page.locator('#interstitialModal');
  if (!(await inter.isVisible())) fail(scope,'interstitial modal not visible after open');
  else {
    const modalMeta = await inter.evaluate(el => ({ role:el.getAttribute('role'), ariaModal:el.getAttribute('aria-modal'), labelledby:el.getAttribute('aria-labelledby') }));
    if (modalMeta.role !== 'dialog' || modalMeta.ariaModal !== 'true') fail(scope,'interstitial lacks dialog semantics',modalMeta);
    const close = inter.locator('button[aria-label="Close age and consent dialog"]');
    const bb=await close.boundingBox(); if(!bb||bb.width<40||bb.height<40) fail(scope,'interstitial close target <40x40',bb);
    const activeInside=await page.evaluate(()=>document.getElementById('interstitialModal').contains(document.activeElement));
    if(!activeInside) fail(scope,'opening interstitial does not move keyboard focus into dialog',await page.evaluate(()=>document.activeElement?.outerHTML?.slice(0,200)));
    await axeSerious(page, `${scope}:interstitial`, '#interstitialModal');
    await page.keyboard.press('Escape'); await page.waitForTimeout(50);
    if(await inter.isVisible()) fail(scope,'Escape does not close interstitial dialog');
  }
  await page.evaluate(()=>window.closeInterstitialModal());

  // Auth modal: input zoom, touch controls, dialog/focus behavior.
  await page.evaluate(()=>window.openAuthRequiredModal()); await page.waitForTimeout(100);
  const modal=page.locator('#authRequiredModal');
  if(!(await modal.isVisible())) fail(scope,'auth modal not visible after open');
  else {
    const meta=await modal.evaluate(el=>({role:el.getAttribute('role'),ariaModal:el.getAttribute('aria-modal'),labelledby:el.getAttribute('aria-labelledby')}));
    if(meta.role!=='dialog'||meta.ariaModal!=='true') fail(scope,'auth modal lacks dialog semantics',meta);
    const close=modal.locator('button[aria-label="Close sign-in dialog"]');
    const eye=modal.locator('#togglePasswordBtn');
    for(const [name,loc] of [['auth close',close],['password visibility',eye]]){
      const bb=await loc.boundingBox(); if(!bb||bb.width<40||bb.height<40) fail(scope,`${name} target <40x40`,bb);
    }
    const eyeInfo=await eye.evaluate(el=>({tabIndex:el.tabIndex,label:el.getAttribute('aria-label')}));
    if(eyeInfo.tabIndex<0||eyeInfo.label!=='Show password') fail(scope,'password visibility control semantics wrong',eyeInfo);
    const formFonts=await modal.evaluate(()=>['authEmailInput','authPasswordInput','forgotEmailInput'].map(id=>document.getElementById(id)).filter(Boolean).filter(el=>getComputedStyle(el).display!=='none').map(el=>({id:el.id,font:parseFloat(getComputedStyle(el).fontSize)})));
    const small=formFonts.filter(x=>x.font<16); if(small.length) fail(scope,'visible auth text inputs <16px (iOS focus zoom risk)',small);
    const activeInside=await page.evaluate(()=>document.getElementById('authRequiredModal').contains(document.activeElement));
    if(!activeInside) fail(scope,'opening auth modal does not move keyboard focus into dialog',await page.evaluate(()=>document.activeElement?.outerHTML?.slice(0,200)));
    await axeSerious(page,`${scope}:auth`,'#authRequiredModal');
    await eye.click(); if(await eye.getAttribute('aria-label')!=='Hide password') fail(scope,'password eye label does not switch to Hide password');
    await eye.click();
    await page.keyboard.press('Escape'); await page.waitForTimeout(50);
    if(await modal.isVisible()) fail(scope,'Escape does not close auth dialog');
  }
  if(pageErrors.length) fail(scope,'page errors',pageErrors);
  await ctx.close();
}

async function appMobileChecks(browser, options, label) {
  const scope=`${label}:app`;
  const ctx=await browser.newContext(options); const page=await ctx.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(String(e.message||e)));
  await page.goto(SITE+'/app',{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(500);
  await basicGeometry(page,scope); await axeSerious(page,scope);
  if(!(await page.locator('#mobileNavBar').isVisible())) fail(scope,'mobile bottom nav missing');
  const tabs=['analyzeSection','icebreakSection','optimizeSection','chatboxSection'];
  for(const target of tabs){
    await page.evaluate(t=>window.switchTab(t),target); await page.waitForTimeout(80);
    if(!(await page.locator('#'+target).isVisible())) fail(scope,`tab ${target} not visible after switch`);
    await basicGeometry(page,`${scope}:${target}`);
    const controls=await page.evaluate(visibleControlMetricsScript);
    const focusableText=controls.filter(x=>['INPUT','TEXTAREA','SELECT'].includes(x.tag) && x.type!=='file');
    const small=focusableText.filter(x=>x.font<16);
    if(small.length) fail(`${scope}:${target}`,'visible mobile text controls <16px',small);
    const off=controls.filter(x=>x.left<-2||x.right>innerWidth+2); if(off.length) fail(`${scope}:${target}`,'controls extend outside viewport',off.slice(0,10));
  }
  const navTargets=await page.locator('.nav-tab-mobile').evaluateAll(els=>els.filter(e=>getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect();return {text:e.innerText.trim(),w:r.width,h:r.height}}));
  const tooSmall=navTargets.filter(x=>x.w<40||x.h<40); if(tooSmall.length) fail(scope,'mobile bottom nav target <40x40',tooSmall);
  if(errors.length) fail(scope,'page errors',errors);
  await ctx.close();
}

async function desktopPageChecks(browser,label) {
  const ctx=await browser.newContext({viewport:{width:1366,height:768}}); const page=await ctx.newPage();
  for(const path of ['/','/app','/terms.html','/privacy.html','/refund.html']){
    const scope=`${label}:${path}`;
    await page.goto(SITE+path,{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(300);
    await basicGeometry(page,scope); await axeSerious(page,scope);
    if(path!=='/app') await internalLinks(page,scope);
  }
  await ctx.close();
}

async function authenticatedChecks(browser) {
  const scope='auth-layout';
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p=await mobile.newPage(); await p.goto(SITE+'/app',{waitUntil:'domcontentloaded',timeout:30000});
  await p.waitForFunction(()=>typeof window.signUpUser==='function'&&window.supabaseClient,null,{timeout:15000});
  const suffix=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const email=`viveks012000+postuiaudit-${suffix}@gmail.com`; const password=`PostUi!${Date.now()}Aa`;
  createdEmail=email;
  const signup=await p.evaluate(async x=>{const r=await window.signUpUser(x.email,x.password);return {ok:!!r?.success,session:!!r?.session};},{email,password});
  if(!signup.ok||!signup.session){fail(scope,'disposable signup did not create session',signup);await mobile.close();return;}
  await p.waitForFunction(()=>window.currentSupabaseUser&&window.currentSupabaseUser.email,null,{timeout:10000});
  await p.waitForFunction(()=>/50\s+Credits?/i.test(document.getElementById('mobileCreditCount')?.textContent||''),null,{timeout:10000}).catch(()=>{});
  const credit=await p.locator('#mobileCreditCount').textContent().catch(()=>null); if(!/50\s+Credits?/i.test(credit||'')) fail(scope,'mobile signed-in credits not canonical 50',credit);
  await p.waitForFunction(()=>/Free Plan|Paid Plan/.test(document.querySelector('#userEmailBadge + p')?.textContent||''),null,{timeout:6000}).catch(()=>{});
  const plan=await p.locator('#userEmailBadge + p').textContent().catch(()=>null); if(plan!=='Free Plan') fail(scope,'fresh 50-credit account plan did not settle to Free Plan',plan);
  await basicGeometry(p,`${scope}:mobile`); await axeSerious(p,`${scope}:mobile`);

  // Desktop login with same disposable account, no paid AI.
  const desktop=await browser.newContext({viewport:{width:1366,height:768}}); const d=await desktop.newPage();
  await d.goto(SITE+'/app',{waitUntil:'domcontentloaded',timeout:30000}); await d.waitForFunction(()=>typeof window.loginUser==='function'&&window.supabaseClient,null,{timeout:15000});
  const login=await d.evaluate(async x=>{const r=await window.loginUser(x.email,x.password);return {ok:!!r?.success};},{email,password});
  if(!login.ok) fail(scope,'disposable desktop login failed',login);
  else { await d.waitForTimeout(300); await basicGeometry(d,`${scope}:desktop`); await axeSerious(d,`${scope}:desktop`); }

  // Delete from mobile production session.
  const deletion=await p.evaluate(async()=>{const h=await window.getSupabaseAuthHeaders();const r=await fetch(window.getApiBase()+'/api/user/delete-account',{method:'POST',headers:{'Content-Type':'application/json',...h},credentials:'include'});return {status:r.status,body:await r.json().catch(()=>({}))};});
  cleanupAttempted=true;
  if(deletion.status!==200||!deletion.body?.success) fail(scope,'disposable account deletion failed',deletion); else pass(scope,'disposable authenticated account deleted');
  await desktop.close(); await mobile.close();
}

(async()=>{
  if(!SITE||!EXPECTED_SHA) throw new Error('SITE and EXPECTED_SHA required');
  await waitForExactRelease();
  const browsers={ chromium:await chromium.launch({headless:true}), firefox:await firefox.launch({headless:true}), webkit:await webkit.launch({headless:true}) };
  try{
    await desktopPageChecks(browsers.chromium,'chromium-desktop');
    await desktopPageChecks(browsers.firefox,'firefox-desktop');
    await desktopPageChecks(browsers.webkit,'webkit-desktop');

    await landingMobileChecks(browsers.chromium,{viewport:{width:320,height:568},isMobile:true,hasTouch:true},'chromium-320');
    await landingMobileChecks(browsers.chromium,{viewport:{width:390,height:844},isMobile:true,hasTouch:true},'chromium-390');
    await landingMobileChecks(browsers.webkit,{...devices['iPhone SE']},'webkit-iPhone-SE');
    await landingMobileChecks(browsers.webkit,{...devices['iPhone 13']},'webkit-iPhone-13');

    await appMobileChecks(browsers.chromium,{viewport:{width:320,height:568},isMobile:true,hasTouch:true},'chromium-320');
    await appMobileChecks(browsers.chromium,{viewport:{width:430,height:932},isMobile:true,hasTouch:true},'chromium-430');
    await appMobileChecks(browsers.webkit,{...devices['iPhone SE']},'webkit-iPhone-SE');
    await appMobileChecks(browsers.webkit,{...devices['iPhone 13']},'webkit-iPhone-13');

    await authenticatedChecks(browsers.chromium);
  } finally {
    await Promise.all(Object.values(browsers).map(b=>b.close().catch(()=>{})));
  }
  console.log('\n=== POST-MOBILE PRODUCTION AUDIT ===');
  console.log(JSON.stringify({failures,warnings,createdEmail,cleanupAttempted},null,2));
  if(failures.length){console.error(`POST_MOBILE_PRODUCTION_AUDIT=FAIL failures=${failures.length}`);process.exit(2);}
  console.log(`POST_MOBILE_PRODUCTION_AUDIT=PASS warnings=${warnings.length}`);
})().catch(e=>{console.error('AUDIT_FATAL',e);process.exit(3);});
