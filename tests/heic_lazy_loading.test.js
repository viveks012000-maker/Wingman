'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const LOADER_SOURCE = fs.readFileSync(path.join(ROOT, 'vendor', 'heic2any-loader.js'), 'utf8').replace(/\r\n/g, '\n');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyLoaderSource() {
    assert.ok(LOADER_SOURCE.includes('import('), 'loader must use dynamic import()');
    assert.ok(LOADER_SOURCE.includes('/vendor/heic-runtime/heic-to-csp.js'), 'loader must reference correct runtime path');
    assert.ok(LOADER_SOURCE.includes('heicTo'), 'loader must handle heicTo export');
    assert.ok(LOADER_SOURCE.includes('loadPromise'), 'loader must cache load promise for coalescing');
    assert.ok(LOADER_SOURCE.includes('loadPromise = null'), 'loader must clear promise on error for retry');
    assert.ok(LOADER_SOURCE.includes('showToast'), 'loader must surface load errors to user');
    assert.ok(!LOADER_SOURCE.includes('appendChild'), 'loader must not use script injection');
    assert.ok(!LOADER_SOURCE.includes('script.src'), 'loader must not create script elements');
}

async function verifyLoaderBehavior() {
    // Test via real browser integration - see test-heic-conversion.js for full test
    // This unit test verifies the source structure matches the dynamic-import architecture
    verifyLoaderSource();
    console.log('✅ Loader source structure verified for dynamic-import architecture');
}

function verifyFinalArtifact() {
    execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(process.execPath, ['scripts/postprocess-lazy-heic.js'], { cwd: ROOT, stdio: 'pipe' });

    const appPath = path.join(OUT, 'app.html');
    const appHtml = fs.readFileSync(appPath, 'utf8');
    assert.ok(appHtml.includes('<script src="./vendor/heic2any-loader.js"></script>'), 'deployed dashboard must load the tiny HEIC loader');
    assert.ok(!appHtml.includes('<script src="./vendor/heic2any.min.js"></script>'), 'deployed dashboard must not eagerly load the heavy HEIC runtime');
    assert.ok(fs.existsSync(path.join(OUT, 'vendor', 'heic2any-loader.js')));
    assert.ok(fs.existsSync(path.join(OUT, 'vendor', 'heic-runtime', 'heic-to-csp.js')), 'real HEIC runtime must remain available for first HEIC use');

    const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
    const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.strictEqual(release.files['app.html'], sha256(appPath), 'release manifest must hash the post-processed app.html');
    assert.strictEqual(release.files['vendor/heic2any-loader.js'], sha256(path.join(OUT, 'vendor', 'heic2any-loader.js')));
    assert.strictEqual(release.files['vendor/heic-runtime/heic-to-csp.js'], sha256(path.join(OUT, 'vendor', 'heic-runtime', 'heic-to-csp.js')));
}

(async () => {
    new Function(LOADER_SOURCE);
    await verifyLoaderBehavior();
    verifyFinalArtifact();
    console.log('✅ HEIC lazy-loading and final-artifact integrity regression guard passed.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});