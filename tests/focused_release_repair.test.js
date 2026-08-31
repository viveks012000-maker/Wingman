'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { isPrivateDevelopmentOrigin } = require('../middleware/developmentOrigin');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');
const app = read('app.js');
const config = read('config.js');
const index = read('index.html');
const appHtml = read('app.html');
const runtime = read('vendor/production-runtime.js');
const loader = read('vendor/heic2any-loader.js');
const workflow = read('.github/workflows/generate-heic-runtime.yml');
const buildNetlify = read('scripts/build-netlify-dist.js');
const serverSource = read('server.js');
const railwayServerSource = read('railway-server.js');
const heicRuntime = read('vendor/heic-runtime/heic-to-csp.js');

function assertNamedExport(source, name) {
    const exportBlock = source.match(/export\s*\{([^}]*)\}/);
    assert(exportBlock, 'generated HEIC runtime must expose an ES module export block');
    assert(new RegExp('\\b' + name + '\\b').test(exportBlock[1]), `generated HEIC runtime must export ${name}`);
}

function makeStorage(initialValue) {
    const values = new Map([['wingman_session_data', initialValue]]);
    let reads = 0;
    return {
        get length() { return values.size; },
        key(index) { return Array.from(values.keys())[index] || null; },
        getItem() {
            reads += 1;
            throw new Error('legacy transcript must never be read');
        },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        has(key) { return values.has(key); },
        get reads() { return reads; }
    };
}

function evaluateRuntime({ bubbles = [], storageValue = '{not-json' } = {}) {
    const localStorage = makeStorage(storageValue);
    const sessionStorage = makeStorage(storageValue);
    const button = { disabled: false, textContent: '', style: {} };
    const container = {
        querySelectorAll() { return bubbles; }
    };
    const elements = new Map([
        ['chatbox-messages-container', container],
        ['simulatorReviewBtn', button]
    ]);
    const calls = [];
    const document = {
        readyState: 'complete',
        body: {},
        getElementById(id) { return elements.get(id) || null; },
        querySelector() { return null; },
        createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }; }
    };
    const window = {
        localStorage,
        sessionStorage,
        document,
        addEventListener() {},
        getApiBase() { return 'https://wingman-production-c6ce.up.railway.app'; },
        getSupabaseAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
        showToast() {}
    };
    const sandbox = {
        window,
        document,
        localStorage,
        sessionStorage,
        console: { error() {}, log() {} },
        Promise,
        JSON,
        Array,
        Object,
        String,
        Number,
        Math,
        Date,
        Error,
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {},
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: false, status: 400, json: async () => ({ success: false, error: 'test stop' }) };
        }
    };
    window.window = window;
    window.fetch = sandbox.fetch;
    vm.createContext(sandbox);
    vm.runInContext(runtime, sandbox, { filename: 'production-runtime.js' });
    return { window, localStorage, sessionStorage, calls, button };
}

function bubble(role, content) {
    return { style: { alignSelf: role === 'user' ? 'flex-end' : 'flex-start' }, textContent: content };
}

console.log('Running focused release repair regression tests...');

// HEIC export contract and adapter boundary.
assertNamedExport(heicRuntime, 'heicTo');
assertNamedExport(heicRuntime, 'isHeic');
const adapterPath = path.join(ROOT, 'vendor', 'heic2any-adapter.js');
assert(fs.existsSync(adapterPath), 'lazy HEIC adapter must be checked in beside the generated runtime');
const adapter = read('vendor/heic2any-adapter.js');
assert(adapter.includes("import { heicTo } from './heic-runtime/heic-to-csp.js';"), 'adapter must import the named heicTo export from the pinned local runtime');
assert(/window\.heic2any\s*=\s*async function/.test(adapter), 'adapter must expose the existing lazy window.heic2any contract');
assert(/heicTo\(\{[\s\S]*blob:\s*options\.blob[\s\S]*type:\s*options\.type[\s\S]*quality:\s*options\.quality/.test(adapter), 'adapter must translate the application HEIC arguments to the real runtime contract');
assert(loader.includes("var REAL_SRC = './vendor/heic2any-adapter.js';"), 'lazy loader must load only the small local adapter');
assert(!loader.includes('https://'), 'HEIC loader must not use a remote dependency');
assert(app.includes('type: "image/jpeg"'), 'application HEIC calls must use the real runtime type argument');
assert(!app.includes('toType: "image/jpeg"'), 'application HEIC calls must not use the incompatible legacy toType argument');
assert(/catch \(e\) \{[\s\S]*console\.warn\("HEIC conversion warning:"/.test(app), 'HEIC conversion rejection must remain isolated from the Analyze workflow');
assert(buildNetlify.includes("'heic2any-adapter.js'"), 'production artifact verification must require the HEIC adapter');

// Persistent transcript data is deleted by key and never read, parsed, or used as review input.
assert(!runtime.includes("getItem('wingman_session_data')"), 'production runtime must not read the legacy transcript key');
assert(!runtime.includes('JSON.parse(raw)'), 'production runtime must not parse a legacy transcript');
const privacyRuntime = evaluateRuntime();
assert.strictEqual(privacyRuntime.localStorage.has('wingman_session_data'), false, 'legacy localStorage transcript must be purged');
assert.strictEqual(privacyRuntime.sessionStorage.has('wingman_session_data'), false, 'legacy sessionStorage transcript must be purged');
assert.strictEqual(privacyRuntime.localStorage.reads, 0, 'legacy localStorage transcript must never be read');
assert.strictEqual(privacyRuntime.sessionStorage.reads, 0, 'legacy sessionStorage transcript must never be read');
assert(!app.includes('const legacyRaw'), 'app startup must not read the legacy transcript value');
assert(!app.includes('JSON.parse(legacyRaw)'), 'app startup must not parse the legacy transcript');
assert(app.includes('localStorage.removeItem(SESSION_KEY)'), 'app startup must purge the owned localStorage transcript key directly');
assert(app.includes('sessionStorage.removeItem(SESSION_KEY)'), 'app startup must purge the owned sessionStorage transcript key directly');

// Review payloads use current DOM history only and enforce server-compatible client bounds.
const boundedBubbles = Array.from({ length: 60 }, (_, index) => bubble(index % 2 ? 'assistant' : 'user', 'x'.repeat(6000)));
const boundedRuntime = evaluateRuntime({ bubbles: boundedBubbles });
(async () => {
    await boundedRuntime.window.triggerFinishAndReview();
    assert.strictEqual(boundedRuntime.calls.length, 1, 'review must submit current conversation history');
    const reviewBody = JSON.parse(boundedRuntime.calls[0].options.body);
    assert(reviewBody.sessionHistory.length <= 50, 'review history must contain at most 50 messages');
    assert(reviewBody.sessionHistory.every(message => message.content.length <= 5000), 'review messages must respect the server 5,000-character limit');
    const contentChars = reviewBody.sessionHistory.reduce((total, message) => total + message.content.length, 0);
    assert(contentChars <= 200000, 'review content must respect the 200,000-character client payload bound');

    const noFallback = evaluateRuntime({ bubbles: [bubble('user', 'current message')] });
    await noFallback.window.triggerFinishAndReview();
    assert.strictEqual(noFallback.calls.length, 0, 'one current message must not trigger a review request');
    assert.strictEqual(noFallback.localStorage.reads, 0, 'review must not fall back to localStorage transcript data');
    assert.strictEqual(noFallback.sessionStorage.reads, 0, 'review must not fall back to sessionStorage transcript data');

    // Landing uses config.js resolution, while production build output strips dev-only CSP sources.
    assert(config.includes('window.getApiBase'), 'config.js must own the API-base resolver used by every page');
    assert(index.includes("window.getApiBase() + '/api/consent'"), 'landing consent must use the shared API-base resolver');
    assert(!index.includes('https://wingman-production-c6ce.up.railway.app/api/consent'), 'landing must not hardcode a competing API endpoint');
assert(index.includes('https://wingman-production-c6ce.up.railway.app'), 'landing CSP must allow only the exact configured Railway origin');
assert(buildNetlify.includes('http://localhost:*'), 'production build must explicitly remove localhost CSP sources from copied HTML');
assert(buildNetlify.includes('ws://localhost:*'), 'production build must explicitly remove localhost websocket CSP sources from copied HTML');

function resolveConfiguredApiBase(location) {
    const window = {
        location,
        WINGMAN_CONFIG: { API_BASE_URL: 'https://wingman-production-c6ce.up.railway.app' },
        addEventListener() {}
    };
    const document = { readyState: 'loading', addEventListener() {} };
    const sandbox = { window, document, setTimeout() {}, clearTimeout() {} };
    vm.createContext(sandbox);
    vm.runInContext(config, sandbox, { filename: 'config.js' });
    return window.getApiBase();
}

assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://localhost:4174', hostname: 'localhost' }), 'http://localhost:3000', 'local development must resolve to the local Railway-compatible backend');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://192.168.1.20:4174', hostname: '192.168.1.20' }), 'http://192.168.1.20:3000', 'LAN development must preserve the host while targeting the local backend');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://172.16.4.20:4174', hostname: '172.16.4.20' }), 'http://172.16.4.20:3000', '172.16/12 development must preserve the host while targeting the local backend');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://10.20.4.20:4174', hostname: '10.20.4.20' }), 'http://10.20.4.20:3000', '10/8 development must preserve the host while targeting the local backend');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://printer.local:4174', hostname: 'printer.local' }), 'http://printer.local:3000', 'mDNS development must preserve the host while targeting the local backend');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://127.0.0.2:4174', hostname: '127.0.0.2' }), 'http://127.0.0.2:3000', 'alternate loopback development must preserve the host while targeting the local backend');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'https:', origin: 'https://192.168.1.20:4174', hostname: '192.168.1.20' }), 'https://192.168.1.20:3000', 'HTTPS LAN development must not downgrade the backend URL to HTTP');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://172.15.4.20:4174', hostname: '172.15.4.20' }), 'https://wingman-production-c6ce.up.railway.app', 'non-private 172/12 lookalikes must not be treated as LAN hosts');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'http:', origin: 'http://10.example.com:4174', hostname: '10.example.com' }), 'https://wingman-production-c6ce.up.railway.app', 'public hostnames beginning with 10 must not be treated as LAN hosts');

assert(isPrivateDevelopmentOrigin('http://192.168.1.20:4174'), 'private IPv4 origins must be allowed for development CORS');
assert(isPrivateDevelopmentOrigin('https://172.31.255.254:4174'), 'private HTTPS IPv4 origins must be allowed for development CORS');
assert(isPrivateDevelopmentOrigin('http://[fd00::1]:4174'), 'IPv6 unique-local origins must be allowed for development CORS');
assert(!isPrivateDevelopmentOrigin('http://172.15.4.20:4174'), 'non-private 172/12 origins must not be allowed for development CORS');
assert(!isPrivateDevelopmentOrigin('http://10.example.com:4174'), 'public lookalike hostnames must not be allowed for development CORS');
assert(serverSource.includes('isPrivateDevelopmentOrigin(origin)'), 'inner API CORS must allow only validated private development origins');
assert(railwayServerSource.includes('isPrivateDevelopmentOrigin(origin)'), 'gateway admission CORS must allow only validated private development origins');
assert(!railwayServerSource.includes("res.setHeader('Access-Control-Allow-Origin', origin)"), 'gateway admission CORS must not reflect a request Origin directly');
assert(index.includes('http://*:*'), 'landing development CSP must permit the local private-network backend');
assert(appHtml.includes('http://*:*'), 'dashboard development CSP must permit the local private-network backend');
assert(buildNetlify.includes('http:\\/\\/\\*:\\*'), 'production build must explicitly remove private-network HTTP CSP sources');
assert(buildNetlify.includes('ws:\\/\\/\\*:\\*'), 'production build must explicitly remove private-network websocket CSP sources');
assert.strictEqual(resolveConfiguredApiBase({ protocol: 'https:', origin: 'https://mywingman.pages.dev', hostname: 'mywingman.pages.dev' }), 'https://wingman-production-c6ce.up.railway.app', 'production must resolve to the configured exact Railway backend');

    // PR verification may inspect and compare generated bytes, but never mutate the PR branch.
    assert(/permissions:\n\s+contents:\s+read/.test(workflow), 'HEIC PR workflow contents permission must be read-only');
    assert(!/contents:\s+write/.test(workflow), 'HEIC PR workflow must not grant contents write permission');
    assert(!/git\s+push/.test(workflow), 'HEIC PR workflow must not push generated commits');
    assert(workflow.includes('sha256sum vendor/heic-runtime/heic-to-csp.js'), 'HEIC PR workflow must compare the generated runtime bytes');
    assert(workflow.includes('git diff --exit-code'), 'HEIC PR workflow must fail when generated output differs from the committed artifact');

    console.log('Focused release repair regression tests passed.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
