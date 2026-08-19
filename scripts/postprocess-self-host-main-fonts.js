'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const CSS_REL = 'fonts/main-fonts.css';
const INLINE_MARKER = `data-inline-source="${CSS_REL}"`;
const TARGETS = ['index.html', 'app.html'];

const ASSETS = Object.freeze({
  'fonts/main-fonts.css': ['57be9a5a28a7824706517e8d6bc2c1015dc10e137020b72b485ae69254984186', 27742],
  'fonts/geist-normal-cyrillic-ext.woff2': ['2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e', 7420],
  'fonts/geist-normal-cyrillic.woff2': ['6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09', 15084],
  'fonts/geist-normal-vietnamese.woff2': ['8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1', 8004],
  'fonts/geist-normal-latin-ext.woff2': ['824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f', 16512],
  'fonts/geist-normal-latin.woff2': ['19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1', 29400],
  'fonts/inter-normal-cyrillic-ext.woff2': ['ca157063339ac4ad418f214f3abfed119b0798ab4d377386ce5c9e5a7a435ebd', 25960],
  'fonts/inter-normal-cyrillic.woff2': ['71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075', 18748],
  'fonts/inter-normal-greek-ext.woff2': ['6e9e020a25f9b56d418f2c085b1d3c09725a4da23fe693a5b463064606732190', 11232],
  'fonts/inter-normal-greek.woff2': ['1be3448e292fbf05ffe176fe1e43f135013d50b1e7d324ad1a558f623d3bb6f6', 18996],
  'fonts/inter-normal-vietnamese.woff2': ['5c66f9e07e90c6d4ac4922cc68d60de26c17b1858e677fb5e603fce3952b3ff2', 10252],
  'fonts/inter-normal-latin-ext.woff2': ['34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956', 85068],
  'fonts/inter-normal-latin.woff2': ['3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62', 48256],
  'fonts/plus-jakarta-sans-italic-cyrillic-ext.woff2': ['88fd102a6d6c21e3467a155dc9ea39012faee16a5f53630a2c1575e6737fd15f', 1112],
  'fonts/plus-jakarta-sans-italic-vietnamese.woff2': ['c8ac130106e4c6e8d0de35b5bc341b14a6c7649a371aa84aff49a74b562158fc', 4352],
  'fonts/plus-jakarta-sans-italic-latin-ext.woff2': ['4660dc4b0f05c7d7ce655815e33a1b05d28b0b9843cc4e9c857b1ac578106696', 11376],
  'fonts/plus-jakarta-sans-italic-latin.woff2': ['714d8ba058e160238e7ebb5c9b446e3814f859c1473497757cdc75473bc0d88e', 12596],
  'fonts/plus-jakarta-sans-normal-cyrillic-ext.woff2': ['c46a510ab43925a55ecfe6c2d5fad0ce1902cd48ab276621d41f7afa42e4daee', 1716],
  'fonts/plus-jakarta-sans-normal-vietnamese.woff2': ['b275d1258601dda240fc6a1d4a6cad56e691d898f5cdf1b0e4fd6ca0022d8e40', 8352],
  'fonts/plus-jakarta-sans-normal-latin-ext.woff2': ['38e3b8fd8045048eb311d90170a4429ed2c8f405852dc3d91b5af8452758703f', 21728],
  'fonts/plus-jakarta-sans-normal-latin.woff2': ['153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79', 27348],
  'fonts/licenses/geist-OFL.txt': ['1781d2806a07d91c4edf4740b88449fab7d0eadad53f7c351b94cd4d4eb8c00f', 4387],
  'fonts/licenses/inter-OFL.txt': ['5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57', 4377],
  'fonts/licenses/plus-jakarta-sans-OFL.txt': ['995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99', 4402]
});

function fail(message) { throw new Error(`[self-host-main-fonts] ${message}`); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function verifyAndCopyAssets() {
  for (const [rel, [expectedSha, expectedBytes]] of Object.entries(ASSETS)) {
    const source = path.join(ROOT, rel);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) fail(`Missing pinned source asset: ${rel}`);
    const bytes = fs.statSync(source).size;
    const hash = sha256(source);
    if (bytes !== expectedBytes || hash !== expectedSha) fail(`${rel} drift: bytes=${bytes} sha256=${hash}`);
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }
}

function verifyCss(css) {
  if (Buffer.byteLength(css, 'utf8') !== 27742) fail('Pinned main font CSS byte size changed');
  if ((css.match(/@font-face/g) || []).length !== 83) fail('Pinned main font CSS must contain exactly 83 @font-face blocks');
  if ((css.match(/font-display:\s*swap/g) || []).length !== 83) fail('Every pinned @font-face must preserve font-display: swap');
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(css)) fail('Pinned main font CSS must not contain external Google font hosts');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, ''));
  const unique = [...new Set(urls)];
  if (unique.length !== 20) fail(`Expected 20 unique local WOFF2 URLs; found ${unique.length}`);
  for (const url of unique) {
    if (!url.startsWith('/fonts/') || !url.endsWith('.woff2')) fail(`Unexpected font URL: ${url}`);
    const rel = url.replace(/^\//, '');
    if (!ASSETS[rel]) fail(`Font CSS references unpinned asset: ${rel}`);
  }
  for (const family of ["'Geist'", "'Inter'", "'Plus Jakarta Sans'"]) {
    if (!css.includes(`font-family: ${family};`)) fail(`Pinned CSS lost ${family}`);
  }
}

function replaceMainFontLink(relativeFile, css) {
  const file = path.join(OUT, relativeFile);
  let html = fs.readFileSync(file, 'utf8');
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const matches = tags.filter(tag => tag.includes('fonts.googleapis.com/css2?family=Plus+Jakarta+Sans') && tag.includes('family=Inter') && tag.includes('family=Geist'));
  if (matches.length !== 1) fail(`${relativeFile} expected exactly one main Google Fonts link; found ${matches.length}`);
  if (!/rel=["']stylesheet["']/i.test(matches[0])) fail(`${relativeFile} main font link is not a stylesheet`);
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length) fail(`${relativeFile} already contains local main font marker`);
  html = html.replace(matches[0], `<style ${INLINE_MARKER}>\n${css}\n</style>`);
  if (html.includes('fonts.googleapis.com/css2?family=Plus+Jakarta+Sans')) fail(`${relativeFile} still contains external main font CSS link`);
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 1) fail(`${relativeFile} local main font marker count is not 1`);
  if (!html.includes('Material+Symbols+Outlined')) fail(`${relativeFile} must keep the separate Material Symbols stylesheet path`);
  fs.writeFileSync(file, html, 'utf8');
}

function run() {
  verifyAndCopyAssets();
  const css = fs.readFileSync(path.join(ROOT, CSS_REL), 'utf8');
  verifyCss(css);
  for (const target of TARGETS) replaceMainFontLink(target, css);

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('release.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const rel of Object.keys(ASSETS)) manifest.files[rel] = sha256(path.join(OUT, rel));
  for (const target of TARGETS) manifest.files[target] = sha256(path.join(OUT, target));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[self-host-main-fonts] Pinned ${Object.keys(ASSETS).length} font/CSS/license assets and inlined exact typography CSS on ${TARGETS.join(', ')}.`);
}

if (require.main === module) run();
module.exports = { ASSETS, CSS_REL, INLINE_MARKER, TARGETS, run };
