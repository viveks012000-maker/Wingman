const { chromium, firefox } = require('playwright');
const axeSource = require('axe-core').source;
const SITE = 'https://soft-sawine-30785c.netlify.app';
const EXPECTED = '7ec0570a5ea0a69c15328e6f7972f7a3f1ef36b7';

async function waitRelease() {
  for (let i = 0; i < 30; i++) {
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

async function scan(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.goto(`${SITE}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.addScriptTag({ content: axeSource });
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
    let count = 0;
    for (const rule of violations) {
      for (const node of rule.nodes) {
        count++;
        console.log('AXE_FAIL ' + JSON.stringify({
          browser: name,
          path: '/app',
          rule: rule.id,
          impact: rule.impact,
          help: rule.help,
          selector: node.target,
          html: node.html,
          summary: node.summary,
          any: node.any,
          all: node.all,
          none: node.none
        }));
      }
    }
    if (!count) console.log(`AXE_PASS browser=${name} path=/app`);
    await context.close();
    return count;
  } finally {
    await browser.close();
  }
}

(async () => {
  await waitRelease();
  const chromiumCount = await scan(chromium, 'chromium-desktop');
  const firefoxCount = await scan(firefox, 'firefox-desktop');
  const total = chromiumCount + firefoxCount;
  console.log(`AXE_APP_TOTAL_NODES=${total}`);
  if (total) process.exit(2);
})().catch(e => {
  console.error('AXE_DETAIL_FATAL ' + String(e));
  process.exit(3);
});
