const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3911;
const VIEWPORTS = [320, 430];
const STATES = [
  { section: 'analyzeSection', empty: 'analyzeEmptyState' },
  { section: 'icebreakSection', empty: 'icebreakEmptyState' },
  { section: 'optimizeSection', empty: 'optimizeEmptyState' }
];
const MIME = {
  '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml'
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const server = http.createServer((req, res) => {
    let rel = (req.url || '/').split('?')[0];
    if (rel === '/') rel = '/app.html';
    const file = path.join(ROOT, rel);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not Found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(PORT, resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${PORT}/app.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(120);

      for (const state of STATES) {
        await page.evaluate(section => window.switchTab(section), state.section);
        await page.waitForTimeout(30);

        const result = await page.evaluate(({ empty }) => {
          function parseColor(value) {
            const m = String(value).match(/rgba?\(([^)]+)\)/i);
            if (!m) throw new Error(`Unsupported color: ${value}`);
            const parts = m[1].split(',').map(v => Number.parseFloat(v.trim()));
            return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
          }
          function composite(fg, bg) {
            const a = fg.a + bg.a * (1 - fg.a);
            if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
            return {
              r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
              g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
              b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
              a
            };
          }
          function effectiveBackground(el) {
            const chain = [];
            for (let node = el; node && node.nodeType === 1; node = node.parentElement) chain.unshift(node);
            let bg = { r: 0, g: 0, b: 0, a: 1 };
            for (const node of chain) {
              const c = parseColor(getComputedStyle(node).backgroundColor);
              if (c.a > 0) bg = composite(c, bg);
            }
            return bg;
          }
          function channel(v) {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          }
          function luminance(c) {
            return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
          }
          function ratio(fg, bg) {
            const L1 = luminance(fg), L2 = luminance(bg);
            return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          }
          function inspect(el) {
            const style = getComputedStyle(el);
            const text = parseColor(style.color);
            const bg = effectiveBackground(el);
            const rendered = composite(text, bg);
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              text: (el.textContent || '').trim().slice(0, 120),
              color: style.color,
              background: bg,
              rendered,
              contrast: ratio(rendered, bg),
              fontSize: Number.parseFloat(style.fontSize),
              fontWeight: style.fontWeight,
              visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
            };
          }

          const root = document.getElementById(empty);
          if (!root) throw new Error(`Missing empty state ${empty}`);
          const title = root.querySelector('h3');
          const helper = root.querySelector('p');
          if (!title || !helper) throw new Error(`Missing title/helper in ${empty}`);
          return { title: inspect(title), helper: inspect(helper) };
        }, state);

        assert(result.title.visible && result.helper.visible, `${state.empty} must be visible at ${width}px: ${JSON.stringify(result)}`);
        // Require normal-text AA for both elements, even though the bold 22px title could legally use 3:1.
        assert(result.title.contrast >= 4.5, `${state.empty} title contrast must be >=4.5 at ${width}px; got ${result.title.contrast.toFixed(2)} (${result.title.color})`);
        assert(result.helper.contrast >= 4.5, `${state.empty} helper contrast must be >=4.5 at ${width}px; got ${result.helper.contrast.toFixed(2)} (${result.helper.color})`);
        console.log(`✔ ${state.empty} @ ${width}px: title=${result.title.contrast.toFixed(2)} helper=${result.helper.contrast.toFixed(2)}`);
      }
    }

    await context.close();
    console.log('✅ Analyzer, Icebreaker and Bio Optimizer mobile empty-state text meets WCAG AA contrast at 320px and 430px.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error('❌ Mobile empty-state contrast regression failed:', err.message);
  process.exit(1);
});
