const { chromium, webkit } = require('playwright');
const axeSource = require('axe-core').source;
const SITE = 'https://soft-sawine-30785c.netlify.app';
const EXPECTED = 'd2a917b0d3ea56b4e19c43b2bd80071f5707b989';
const STATES = [
  ['analyzeSection', 'analyzeEmptyState'],
  ['icebreakSection', 'icebreakEmptyState'],
  ['optimizeSection', 'optimizeEmptyState']
];

async function waitRelease() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${SITE}/release.json?audit=${Date.now()}-${i}`, {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      const j = await r.json();
      console.log(`release_attempt=${i + 1} actual=${j.sourceCommit}`);
      if (j.sourceCommit === EXPECTED) return;
    } catch (e) {
      console.warn(`release_attempt=${i + 1} error=${String(e)}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('release mismatch');
}

async function scan(browserType, browserName, width, height) {
  const browser = await browserType.launch({ headless: true });
  let total = 0;
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    await page.goto(`${SITE}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(900);
    await page.addScriptTag({ content: axeSource });

    for (const [section, emptyId] of STATES) {
      await page.evaluate(section => window.switchTab(section), section);
      await page.waitForTimeout(150);

      const rendered = await page.evaluate(emptyId => {
        const root = document.getElementById(emptyId);
        if (!root) throw new Error(`Missing ${emptyId}`);
        const title = root.querySelector('h3');
        const helper = root.querySelector('p');
        function info(el) {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            text: (el.textContent || '').trim().slice(0, 100),
            color: s.color,
            background: s.backgroundColor,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
          };
        }
        return { title: info(title), helper: info(helper) };
      }, emptyId);

      if (!rendered.title.visible || !rendered.helper.visible) {
        console.log('AXE_FAIL ' + JSON.stringify({ browser: browserName, width, section, rule: 'target-visibility', rendered }));
        total++;
        continue;
      }

      const violations = await page.evaluate(async () => {
        const r = await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
        });
        return r.violations
          .filter(x => x.impact === 'serious' || x.impact === 'critical')
          .map(x => ({
            id: x.id,
            impact: x.impact,
            help: x.help,
            nodes: x.nodes.map(n => ({
              target: n.target,
              html: n.html,
              summary: n.failureSummary,
              any: n.any?.map(c => c.message),
              all: n.all?.map(c => c.message),
              none: n.none?.map(c => c.message)
            }))
          }));
      });

      let stateCount = 0;
      for (const rule of violations) {
        for (const node of rule.nodes) {
          stateCount++;
          total++;
          console.log('AXE_FAIL ' + JSON.stringify({
            browser: browserName,
            width,
            section,
            emptyId,
            rule: rule.id,
            impact: rule.impact,
            help: rule.help,
            selector: node.target,
            html: node.html,
            summary: node.summary,
            any: node.any,
            all: node.all,
            none: node.none,
            rendered
          }));
        }
      }
      if (!stateCount) {
        console.log(`AXE_PASS browser=${browserName} width=${width} state=${emptyId} titleColor=${rendered.title.color} helperColor=${rendered.helper.color}`);
      }
    }

    await context.close();
    return total;
  } finally {
    await browser.close();
  }
}

(async () => {
  await waitRelease();
  let total = 0;
  total += await scan(chromium, 'chromium-mobile', 320, 568);
  total += await scan(chromium, 'chromium-mobile', 430, 932);
  total += await scan(webkit, 'webkit-mobile', 320, 568);
  total += await scan(webkit, 'webkit-mobile', 390, 844);
  console.log(`AXE_MOBILE_EMPTY_STATE_TOTAL_NODES=${total}`);
  if (total) process.exit(2);
})().catch(e => {
  console.error('AXE_DETAIL_FATAL ' + String(e));
  process.exit(3);
});
