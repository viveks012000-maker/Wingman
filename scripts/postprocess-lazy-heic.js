'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const APP_HTML = path.join(OUT, 'app.html');
const LOADER = path.join(OUT, 'vendor', 'heic2any-loader.js');
const REAL_RUNTIME = path.join(OUT, 'vendor', 'heic-runtime', 'heic-to-csp.js');
const RELEASE = path.join(OUT, 'release.json');

function fail(message) {
    throw new Error(`[lazy-heic-build] ${message}`);
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

for (const required of [APP_HTML, LOADER, REAL_RUNTIME, RELEASE]) {
    if (!fs.existsSync(required) || !fs.statSync(required).isFile()) {
        fail(`Required artifact file is missing: ${path.relative(OUT, required)}`);
    }
}

let html = fs.readFileSync(APP_HTML, 'utf8');
const eagerPattern = /<script\s+src=["']\.\/vendor\/heic2any\.min\.js["']\s*><\/script>/g;
const eagerMatches = html.match(eagerPattern) || [];

// If the eager runtime tag is present, replace it with the lazy loader
if (eagerMatches.length === 1) {
    html = html.replace(eagerPattern, '<script src="./vendor/heic2any-loader.js"></script>');
    if (/<script\s+src=["']\.\/vendor\/heic2any\.min\.js["']\s*><\/script>/.test(html)) {
        fail('Eager HEIC runtime tag survived post-processing.');
    }
    fs.writeFileSync(APP_HTML, html, 'utf8');
} else if (eagerMatches.length === 0) {
    // Already using lazy loader - verify it's present
    if (!html.includes('<script src="./vendor/heic2any-loader.js"></script>')) {
        fail('Neither eager HEIC runtime nor lazy loader found in app.html.');
    }
} else {
    fail(`Expected at most one eager HEIC runtime tag, found ${eagerMatches.length}`);
}

const release = JSON.parse(fs.readFileSync(RELEASE, 'utf8'));
if (!release || !release.files || typeof release.files !== 'object') {
    fail('release.json is missing its file hash map.');
}
release.files['app.html'] = sha256(APP_HTML);
release.files['vendor/heic2any-loader.js'] = sha256(LOADER);
release.files['vendor/heic-runtime/heic-to-csp.js'] = sha256(REAL_RUNTIME);
fs.writeFileSync(RELEASE, JSON.stringify(release, null, 2) + '\n', 'utf8');

const rewrittenRelease = JSON.parse(fs.readFileSync(RELEASE, 'utf8'));
if (rewrittenRelease.files['app.html'] !== sha256(APP_HTML)) fail('app.html release hash is stale after HEIC post-processing.');
if (rewrittenRelease.files['vendor/heic2any-loader.js'] !== sha256(LOADER)) fail('HEIC loader release hash is stale.');
if (rewrittenRelease.files['vendor/heic-runtime/heic-to-csp.js'] !== sha256(REAL_RUNTIME)) fail('HEIC runtime release hash is stale.');

console.log('[lazy-heic-build] HEIC converter moved from eager page load to first HEIC/HEIF use.');
