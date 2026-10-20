'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyProductionCss, EXPECTED_BYTES } = require('./verify-production-css');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const HTML = path.join(OUT, 'index.html');
const CSS = path.join(OUT, 'landing-output.css');
const FULL_CSS = path.join(OUT, 'output.css');
const INPUT = path.join(ROOT, 'input.landing.css');
const CANDIDATE_CSS = path.join(ROOT, 'tmp', 'landing-tailwind.css');
const TAILWIND_CLI = path.join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const INLINE_STYLE_MARKER = 'data-inline-source="style.css"';

function fail(message) {
  throw new Error(`[landing-css-build] ${message}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findTopLevelLayer(css, layerName) {
  const starts = [];
  let searchFrom = 0;
  while (true) {
    const start = css.indexOf(layerName, searchFrom);
    if (start < 0) break;
    starts.push(start);
    searchFrom = start + layerName.length;
  }
  if (starts.length !== 1) fail(`Expected one ${layerName} block; found ${starts.length}.`);

  const start = starts[0];
  let openingBrace = start + layerName.length;
  while (/\s/.test(css[openingBrace] || '')) openingBrace++;
  if (css[openingBrace] !== '{') fail(`The ${layerName} layer is missing its opening brace.`);

  let depth = 1;
  let quote = '';
  let escaped = false;
  let comment = false;
  for (let index = openingBrace + 1; index < css.length; index++) {
    const character = css[index];
    const next = css[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return { start, end: index + 1 };
  }
  fail(`The ${layerName} block is not closed.`);
}

function findOpeningBrace(css, start, end) {
  for (let index = start; index < end; index++) {
    if (css[index] === '\\') {
      index++;
      continue;
    }
    if (css[index] === '{') return index;
  }
  fail('A CSS layer is missing its opening brace.');
}

function findClosingBrace(css, openingBrace, end) {
  let depth = 1;
  let quote = '';
  let escaped = false;
  let comment = false;
  for (let index = openingBrace + 1; index < end; index++) {
    const character = css[index];
    const next = css[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return index;
  }
  fail('A CSS rule block is not closed.');
}

function skipWhitespaceAndComments(css, start, end) {
  let index = start;
  while (index < end) {
    if (/\s/.test(css[index])) {
      index++;
      continue;
    }
    if (css[index] === '/' && css[index + 1] === '*') {
      const commentEnd = css.indexOf('*/', index + 2);
      if (commentEnd < 0 || commentEnd + 2 > end) fail('A CSS comment is not closed.');
      index = commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
}

function findRuleBoundary(css, start, end) {
  let quote = '';
  let escaped = false;
  let comment = false;
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < end; index++) {
    const character = css[index];
    const next = css[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '(') parentheses++;
    else if (character === ')' && parentheses > 0) parentheses--;
    else if (character === '[') brackets++;
    else if (character === ']' && brackets > 0) brackets--;
    else if (parentheses === 0 && brackets === 0 && character === '{') return { type: 'block', index };
    else if (parentheses === 0 && brackets === 0 && character === ';') return { type: 'statement', index };
  }
  return { type: 'end', index: end };
}

function splitSelectors(selectorText) {
  const selectors = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < selectorText.length; index++) {
    const character = selectorText[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '(') parentheses++;
    else if (character === ')' && parentheses > 0) parentheses--;
    else if (character === '[') brackets++;
    else if (character === ']' && brackets > 0) brackets--;
    else if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(selectorText.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = selectorText.slice(start).trim();
  if (last) selectors.push(last);
  return selectors;
}

function visitRuleBlock(css, contentStart, contentEnd, onSelector) {
  let cursor = contentStart;
  while (cursor < contentEnd) {
    const preludeStart = skipWhitespaceAndComments(css, cursor, contentEnd);
    if (preludeStart >= contentEnd) return;
    const boundary = findRuleBoundary(css, preludeStart, contentEnd);
    if (boundary.type === 'end') return;
    if (boundary.type === 'statement') {
      cursor = boundary.index + 1;
      continue;
    }
    const prelude = css.slice(preludeStart, boundary.index).trim();
    const closingBrace = findClosingBrace(css, boundary.index, contentEnd);
    if (prelude.startsWith('@')) visitRuleBlock(css, boundary.index + 1, closingBrace, onSelector);
    else for (const selector of splitSelectors(prelude)) onSelector(selector);
    cursor = closingBrace + 1;
  }
}

function collectSelectors(css, layer) {
  const openingBrace = findOpeningBrace(css, layer.start, layer.end);
  const selectors = new Set();
  visitRuleBlock(css, openingBrace + 1, layer.end - 1, selector => selectors.add(selector));
  return selectors;
}

function filterRuleBlock(css, contentStart, contentEnd, allowedSelectors) {
  let cursor = contentStart;
  let output = '';
  let keptAnything = false;
  while (cursor < contentEnd) {
    const preludeStart = skipWhitespaceAndComments(css, cursor, contentEnd);
    if (preludeStart >= contentEnd) break;
    const prefix = css.slice(cursor, preludeStart);
    const boundary = findRuleBoundary(css, preludeStart, contentEnd);
    if (boundary.type === 'end') break;
    if (boundary.type === 'statement') {
      output += prefix + css.slice(preludeStart, boundary.index + 1);
      keptAnything = true;
      cursor = boundary.index + 1;
      continue;
    }
    const prelude = css.slice(preludeStart, boundary.index).trim();
    const closingBrace = findClosingBrace(css, boundary.index, contentEnd);
    if (prelude.startsWith('@')) {
      const nested = filterRuleBlock(css, boundary.index + 1, closingBrace, allowedSelectors);
      if (nested.keptAnything) {
        output += prefix + css.slice(preludeStart, boundary.index + 1) + nested.output + '}';
        keptAnything = true;
      }
    } else if (splitSelectors(prelude).some(selector => allowedSelectors.has(selector))) {
      output += prefix + css.slice(preludeStart, closingBrace + 1);
      keptAnything = true;
    }
    cursor = closingBrace + 1;
  }
  return { output, keptAnything };
}

function run() {
  const lockedBefore = verifyProductionCss();
  if (!fs.existsSync(HTML)) fail('index.html is missing from the built artifact.');
  if (!fs.existsSync(FULL_CSS)) fail('The locked workspace stylesheet is missing from the built artifact.');
  if (!fs.existsSync(INPUT)) fail('input.landing.css is missing.');
  if (!fs.existsSync(TAILWIND_CLI)) fail('The pinned Tailwind CLI is missing.');
  fs.mkdirSync(path.dirname(CANDIDATE_CSS), { recursive: true });

  const built = spawnSync(process.execPath, [
    TAILWIND_CLI,
    '-i', './input.landing.css',
    '-o', './tmp/landing-tailwind.css',
    '--minify'
  ], { cwd: ROOT, encoding: 'utf8' });
  if (built.error) throw built.error;
  if (built.status !== 0) fail((built.stderr || built.stdout || 'Tailwind CSS build failed.').trim());
  if (!fs.existsSync(CANDIDATE_CSS) || fs.statSync(CANDIDATE_CSS).size === 0) fail('The homepage Tailwind utility candidate was not generated.');

  const workspaceCss = fs.readFileSync(FULL_CSS, 'utf8');
  const candidateCss = fs.readFileSync(CANDIDATE_CSS, 'utf8');
  const workspaceUtilities = findTopLevelLayer(workspaceCss, '@layer utilities');
  const landingUtilities = findTopLevelLayer(candidateCss, '@layer utilities');
  const allowedSelectors = collectSelectors(candidateCss, landingUtilities);
  const workspaceOpeningBrace = findOpeningBrace(workspaceCss, workspaceUtilities.start, workspaceUtilities.end);
  const filteredUtilities = filterRuleBlock(workspaceCss, workspaceOpeningBrace + 1, workspaceUtilities.end - 1, allowedSelectors);
  if (!filteredUtilities.keptAnything) fail('No existing homepage utility rules survived CSS isolation.');
  const generatedCss = workspaceCss.slice(0, workspaceUtilities.start) +
    workspaceCss.slice(workspaceUtilities.start, workspaceOpeningBrace + 1) + filteredUtilities.output + '}' +
    workspaceCss.slice(workspaceUtilities.end);
  fs.writeFileSync(CSS, generatedCss, 'utf8');
  if (!fs.existsSync(CSS) || fs.statSync(CSS).size === 0) fail('The landing stylesheet was not generated.');
  if (fs.statSync(CSS).size >= EXPECTED_BYTES * 0.75) {
    fail(`The landing stylesheet is not sufficiently isolated (${fs.statSync(CSS).size} bytes).`);
  }
  if (!generatedCss.includes('.scroll-reveal{opacity:0;')) {
    fail('The production custom scroll-reveal behavior was not preserved.');
  }

  let html = fs.readFileSync(HTML, 'utf8');
  if ((html.match(new RegExp(INLINE_STYLE_MARKER, 'g')) || []).length !== 1) {
    fail('The existing inlined custom styles must remain in the homepage to preserve their cascade.');
  }
  const stylesheetLink = /<link\b[^>]*\bhref=(['"])\/?output\.css\1[^>]*>/gi;
  const matches = [...html.matchAll(stylesheetLink)];
  if (matches.length !== 1 || !/\brel=(['"])stylesheet\1/i.test(matches[0][0])) {
    fail(`Expected one output.css stylesheet link on index.html; found ${matches.length}.`);
  }
  const landingFontPreload = '<link rel="preload" href="/fonts/geist-normal-latin.woff2" as="font" type="font/woff2" crossorigin>';
  if (html.includes(landingFontPreload) || /rel=(['"])preload\1[^>]+geist-normal-latin\.woff2/i.test(html)) {
    fail('The homepage already contains a Geist Latin font preload.');
  }
  if (/<\/style/i.test(generatedCss)) fail('The generated landing CSS contains a closing style tag and cannot be inlined safely.');
  html = html.replace(stylesheetLink, '');
  const viewportMeta = /<meta\b[^>]*\bname=(['"])viewport\1[^>]*>/gi;
  const viewportMatches = [...html.matchAll(viewportMeta)];
  if (viewportMatches.length !== 1) fail(`Expected one homepage viewport declaration; found ${viewportMatches.length}.`);
  const inlineLandingCss = '<style data-inline-source="landing-output.css">\n' + generatedCss + '\n</style>';
  html = html.replace(viewportMeta, viewportMatches[0][0] + '\n    ' + inlineLandingCss + '\n    ' + landingFontPreload);
  if ((html.match(/data-inline-source="landing-output\.css"/g) || []).length !== 1) {
    fail('The homepage must inline its page-specific stylesheet exactly once after the viewport declaration.');
  }
  if ((html.match(/<link rel="preload" href="\/fonts\/geist-normal-latin\.woff2" as="font" type="font\/woff2" crossorigin>/g) || []).length !== 1) {
    fail('The homepage must preload exactly one copy of the measured LCP Geist Latin font.');
  }
  if (/\bhref=(['"])\/?output\.css\1/i.test(html)) fail('The homepage still references the shared workspace stylesheet.');
  if (/\bhref=(['"])\/?landing-output\.css\1/i.test(html)) fail('The homepage still requests the page-specific stylesheet separately.');
  fs.writeFileSync(HTML, html, 'utf8');

  const lockedAfter = verifyProductionCss();
  if (lockedBefore.hash !== lockedAfter.hash || lockedBefore.bytes !== lockedAfter.bytes) {
    fail('The workspace CSS compatibility artifact changed during landing stylesheet generation.');
  }

  const manifestPath = path.join(OUT, 'release.json');
  if (!fs.existsSync(manifestPath)) fail('The release manifest is missing.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files['index.html'] = sha256(HTML);
  manifest.files['landing-output.css'] = sha256(CSS);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[landing-css-build] Homepage uses ${fs.statSync(CSS).size} bytes of page-specific CSS; shared app CSS remains locked at ${lockedAfter.bytes} bytes.`);
}

if (require.main === module) run();

module.exports = {
  filterRuleBlock,
  run,
  splitSelectors,
  visitRuleBlock
};
