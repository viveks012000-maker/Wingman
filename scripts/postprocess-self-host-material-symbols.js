'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const FONT_REL = 'fonts/material-symbols-outlined-subset.woff2';
const LICENSE_REL = 'fonts/licenses/material-symbols/LICENSE.txt';
const INLINE_MARKER = 'data-self-hosted-material-symbols';
const TARGETS = ['index.html', 'app.html'];
const ICON_NAMES = 'analytics,arrow_back,arrow_forward,auto_awesome,bolt,broken_image,cancel,check,check_circle,close,content_copy,corporate_fare,crop,delete_forever,edit_note,electric_bolt,error,event_available,forum,home,image_search,info,insights,local_fire_department,lock,menu,play_arrow,progress_activity,psychology,refresh,replay,restart_alt,rocket_launch,rotate_right,settings,shield,smart_toy,support_agent,tips_and_updates,tune,verified,verified_user,visibility,visibility_off,warning';
const GOOGLE_URL = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&icon_names=${ICON_NAMES}&display=block`;

const ASSETS = Object.freeze({
  [FONT_REL]: ['56f6255b1341a07abae9b27ad468ecbf7de7141c6522a078060fb4c5173def70', 16580],
  [LICENSE_REL]: ['58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd', 11357]
});

const LOCAL_CSS = `@font-face {
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: 100 700;
  font-display: block;
  src: url(/${FONT_REL}) format('woff2');
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}`;

function fail(message) { throw new Error(`[self-host-material-symbols] ${message}`); }
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
  if (!fs.readFileSync(path.join(ROOT, LICENSE_REL), 'utf8').includes('Apache License')) fail('Pinned Material Symbols license no longer identifies Apache License');
}

function verifyLocalCss() {
  if (!LOCAL_CSS.includes("font-family: 'Material Symbols Outlined';")) fail('Local CSS lost Material Symbols family');
  if (!LOCAL_CSS.includes('font-weight: 100 700;')) fail('Local CSS lost variable weight range');
  if (!LOCAL_CSS.includes('font-display: block;')) fail('Local CSS must preserve Google font-display:block behavior');
  if (!LOCAL_CSS.includes("-webkit-font-feature-settings: 'liga';")) fail('Local CSS lost ligature semantics');
  if (!LOCAL_CSS.includes(`src: url(/${FONT_REL}) format('woff2');`)) fail('Local CSS does not point at pinned local subset font');
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(LOCAL_CSS)) fail('Local CSS must not depend on Google font hosts');
}

function removeGoogleFontCspHosts(text, label, expectedEach) {
  const googleApisCount = (text.match(/https:\/\/fonts\.googleapis\.com/g) || []).length;
  const gstaticCount = (text.match(/https:\/\/fonts\.gstatic\.com/g) || []).length;
  if (googleApisCount !== expectedEach || gstaticCount !== expectedEach) {
    fail(`${label} Google Fonts CSP allowlist drift: googleapis=${googleApisCount}, gstatic=${gstaticCount}, expected=${expectedEach}`);
  }
  const tightened = text
    .replace(/ https:\/\/fonts\.googleapis\.com/g, '')
    .replace(/ https:\/\/fonts\.gstatic\.com/g, '');
  if (/https:\/\/fonts\.(?:googleapis|gstatic)\.com/i.test(tightened)) fail(`${label} still contains Google Fonts hosts after CSP tightening`);
  return tightened;
}

function replaceExternalLink(relativeFile) {
  const file = path.join(OUT, relativeFile);
  let html = fs.readFileSync(file, 'utf8');
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const matches = tags.filter(tag => tag.includes('fonts.googleapis.com/css2?family=Material+Symbols+Outlined'));
  if (matches.length !== 1) fail(`${relativeFile} expected exactly one Material Symbols stylesheet; found ${matches.length}`);
  const tag = matches[0];
  if (!/rel=["']stylesheet["']/i.test(tag)) fail(`${relativeFile} Material Symbols link is not rel=stylesheet`);
  const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) fail(`${relativeFile} Material Symbols link has no href`);
  const decodedHref = hrefMatch[1].replace(/&amp;/g, '&');
  if (decodedHref !== GOOGLE_URL) fail(`${relativeFile} Material Symbols URL drifted from the pinned 45-icon subset`);
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length) fail(`${relativeFile} already contains local Material Symbols marker`);

  html = html.replace(tag, `<style ${INLINE_MARKER}>\n${LOCAL_CSS}\n</style>`);
  if (/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined/i.test(html)) fail(`${relativeFile} still contains external Material Symbols CSS`);
  html = removeGoogleFontCspHosts(html, relativeFile, 1);
  if ((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length !== 1) fail(`${relativeFile} local Material Symbols marker count is not 1`);
  fs.writeFileSync(file, html, 'utf8');
}

function tightenHeadersCsp() {
  const file = path.join(OUT, '_headers');
  if (!fs.existsSync(file)) fail('_headers is missing');
  const headers = removeGoogleFontCspHosts(fs.readFileSync(file, 'utf8'), '_headers', 7);
  fs.writeFileSync(file, headers, 'utf8');
}

function run() {
  verifyAndCopyAssets();
  verifyLocalCss();
  for (const target of TARGETS) replaceExternalLink(target);
  tightenHeadersCsp();

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('release.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const rel of Object.keys(ASSETS)) manifest.files[rel] = sha256(path.join(OUT, rel));
  for (const target of TARGETS) manifest.files[target] = sha256(path.join(OUT, target));
  manifest.files['_headers'] = sha256(path.join(OUT, '_headers'));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[self-host-material-symbols] Replaced external Material Symbols CSS with pinned local 45-icon subset on ${TARGETS.join(', ')} and removed obsolete Google Fonts CSP origins.`);
}

if (require.main === module) run();
module.exports = { ASSETS, FONT_REL, LICENSE_REL, INLINE_MARKER, ICON_NAMES, GOOGLE_URL, LOCAL_CSS, TARGETS, run };
