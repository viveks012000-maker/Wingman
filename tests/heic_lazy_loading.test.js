'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const LOADER_SOURCE = fs.readFileSync(path.join(ROOT, 'vendor', 'heic2any-loader.js'), 'utf8').replace(/\r\n/g, '\n');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeBrowserHarness() {
    const scripts = [];
    const toasts = [];
    const head = {
        appendChild(script) {
            script.parentNode = head;
            scripts.push(script);
            return script;
        },
        removeChild(script) {
            const index = scripts.indexOf(script);
            if (index >= 0) scripts.splice(index, 1);
            script.parentNode = null;
            return script;
        }
    };
    const document = {
        head,
        createElement(tag) {
            assert.strictEqual(tag, 'script');
            return {
                tagName: 'SCRIPT',
                attrs: {},
                setAttribute(name, value) { this.attrs[name] = String(value); }
            };
        },
        querySelector(selector) {
            if (selector !== 'script[data-wingman-heic-runtime]') return null;
            return scripts.find(script => script.attrs['data-wingman-heic-runtime'] === 'true') || null;
        }
    };
    const window = {
        showToast(message, type) { toasts.push({ message, type }); }
    };
    const context = { window, document, console, Promise, Error, setTimeout, clearTimeout };
    vm.createContext(context);
    vm.runInContext(LOADER_SOURCE, context, { filename: 'heic2any-loader.js' });
    return { window, scripts, toasts };
}

async function verifyLoaderBehavior() {
    {
        const harness = makeBrowserHarness();
        assert.strictEqual(typeof harness.window.heic2any, 'function', 'loader must expose a compatible heic2any function');
        assert.strictEqual(harness.scripts.length, 0, 'real 1.35 MB HEIC runtime must not load on normal page initialization');

        const first = harness.window.heic2any({ id: 1 });
        const second = harness.window.heic2any({ id: 2 });
        assert.strictEqual(harness.scripts.length, 1, 'concurrent first use must inject exactly one real HEIC script');
        const injected = harness.scripts[0];
         assert.strictEqual(injected.src, './vendor/heic2any-adapter.js');
        assert.strictEqual(injected.attrs['data-wingman-heic-runtime'], 'true');

        harness.window.heic2any = async options => `converted-${options.id}`;
        injected.onload();
        assert.strictEqual(await first, 'converted-1');
        assert.strictEqual(await second, 'converted-2');
        assert.deepStrictEqual(harness.toasts, []);
    }

    {
        const harness = makeBrowserHarness();
        const first = harness.window.heic2any({ id: 'fail' });
        assert.strictEqual(harness.scripts.length, 1);
        harness.scripts[0].onerror();
        await assert.rejects(first, /HEIC converter failed to load/);
        assert.strictEqual(harness.scripts.length, 0, 'failed runtime element must be removed so retry cannot deadlock');
        assert.strictEqual(harness.toasts.length, 1, 'load failure must surface a user-visible error');

        const retry = harness.window.heic2any({ id: 'retry' });
        assert.strictEqual(harness.scripts.length, 1, 'a later user retry must create a fresh runtime request');
        const retryScript = harness.scripts[0];
        harness.window.heic2any = async options => `converted-${options.id}`;
        retryScript.onload();
        assert.strictEqual(await retry, 'converted-retry');
    }
}

function verifyFinalArtifact() {
    fs.rmSync(OUT, { recursive: true, force: true });
    try {
        execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], { cwd: ROOT, stdio: 'pipe' });
        execFileSync(process.execPath, ['scripts/postprocess-lazy-heic.js'], { cwd: ROOT, stdio: 'pipe' });

        const appPath = path.join(OUT, 'app.html');
        const appHtml = fs.readFileSync(appPath, 'utf8');
        assert.ok(appHtml.includes('<script src="./vendor/heic2any-loader.js"></script>'), 'deployed dashboard must load the tiny HEIC loader');
        assert.ok(!appHtml.includes('<script src="./vendor/heic2any.min.js"></script>'), 'deployed dashboard must not eagerly load the heavy HEIC runtime');
        assert.ok(fs.existsSync(path.join(OUT, 'vendor', 'heic2any-loader.js')));
        assert.ok(fs.existsSync(path.join(OUT, 'vendor', 'heic2any-adapter.js')), 'real HEIC adapter must remain available for first HEIC use');
        assert.ok(fs.existsSync(path.join(OUT, 'vendor', 'heic-runtime', 'heic-to-csp.js')), 'real HEIC runtime must remain available for first HEIC use');

        const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
        assert.strictEqual(release.files['app.html'], sha256(appPath), 'release manifest must hash the post-processed app.html');
        assert.strictEqual(release.files['vendor/heic2any-loader.js'], sha256(path.join(OUT, 'vendor', 'heic2any-loader.js')));
        assert.strictEqual(release.files['vendor/heic2any-adapter.js'], sha256(path.join(OUT, 'vendor', 'heic2any-adapter.js')));
        assert.strictEqual(release.files['vendor/heic-runtime/heic-to-csp.js'], sha256(path.join(OUT, 'vendor', 'heic-runtime', 'heic-to-csp.js')));
    } finally {
        fs.rmSync(OUT, { recursive: true, force: true });
    }
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
