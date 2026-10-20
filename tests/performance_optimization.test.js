'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

const buildScript = fs.readFileSync(path.join(ROOT, 'scripts/build-netlify-dist.js'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1. Versionless assets and release metadata must revalidate after deployment
assert.ok(buildScript.includes("'/fonts/*'"), 'build-netlify-dist.js must define route for /fonts/*');
assert.ok(buildScript.includes("'/vendor/*'"), 'build-netlify-dist.js must define route for /vendor/*');
assert.ok(buildScript.includes("'/logo-384.webp'"), 'build-netlify-dist.js must define route for /logo-384.webp');
assert.ok(buildScript.includes("'/logo.png'"), 'build-netlify-dist.js must define route for /logo.png');
assert.ok(buildScript.includes("'/maeve.jpg'"), 'build-netlify-dist.js must define route for /maeve.jpg');
assert.ok(buildScript.includes("'/favicon*'"), 'build-netlify-dist.js must define route for favicon assets');
assert.ok(buildScript.includes("'/apple-touch-icon.png'"), 'build-netlify-dist.js must define route for the Apple touch icon');
assert.ok(buildScript.includes('Cache-Control: public, max-age=0, must-revalidate'), 'build-netlify-dist.js must revalidate versionless static assets');

// 2. Viewport height deduplication and passive listeners in app.js
assert.ok(appJs.includes('_lastVisualHeight'), 'app.js must deduplicate visual viewport height updates');
assert.ok(appJs.includes("window.addEventListener('resize', scheduleVisualViewportUpdate, { passive: true });"), 'app.js must use the deduplicated passive resize listener');
assert.ok(appJs.includes("window.visualViewport.addEventListener('scroll', scheduleVisualViewportUpdate, { passive: true });"), 'app.js must use the deduplicated passive scroll listener');

// 3. Star plexus canvas optimizations in app.js and index.html
for (const [name, content] of [['app.js', appJs], ['index.html', indexHtml]]) {
  assert.ok(content.includes('maxDistSq'), name + ' must optimize particle distance check with squared distances');
  assert.ok(content.includes('Math.abs(dx) >= maxDist'), name + ' must pre-filter particle delta x');
  assert.ok(content.includes('Math.abs(dy) >= maxDist'), name + ' must pre-filter particle delta y');
  assert.ok(content.includes('mouse.x = e.clientX'), name + ' must map mouse coordinates without forced reflow');
  assert.ok(!content.includes('const rect = canvas.getBoundingClientRect()'), name + ' must not query getBoundingClientRect in mousemove handler');
  assert.ok(content.includes('addEventListener("mousemove"') && content.includes('{ passive: true }'), name + ' must register mousemove with passive: true');
}

// 4. The production build must emit revalidation rules for versionless files
execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], { cwd: ROOT, stdio: 'pipe' });
const headers = fs.readFileSync(path.join(OUT, '_headers'), 'utf8');

for (const route of [
  '/fonts/*', '/vendor/*', '/logo-384.webp', '/logo.png', '/maeve.jpg',
  '/favicon*', '/apple-touch-icon.png', '/robots.txt', '/sitemap.xml', '/release.json'
]) {
  assert.ok(headers.includes(route), 'Generated _headers must include route ' + route);
}
assert.ok(headers.includes('Cache-Control: public, max-age=0, must-revalidate'), 'Generated _headers must include deployment-safe revalidation');
assert.ok(!headers.includes('Cache-Control: public, max-age=31536000, immutable'), 'Versionless assets must not retain stale immutable caching');

// Clean up
fs.rmSync(OUT, { recursive: true, force: true });

console.log('✅ Performance optimization contracts passed: safe asset revalidation, viewport scroll deduplication, and canvas frame budget optimizations verified.');
