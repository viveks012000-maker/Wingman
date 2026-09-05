const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MockClassList {
    constructor(initial = []) { this.values = new Set(initial); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
    }
}

class MockElement {
    constructor(id, classes = []) {
        this.id = id;
        this.classList = new MockClassList(classes);
        this.style = {};
        this.textContent = '';
        this.innerHTML = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.children = [];
        this._listeners = new Map();
    }
    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }
    removeEventListener() {}
    appendChild(child) { this.children.push(child); return child; }
    remove() {}
    focus() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    setAttribute(name, value) { this[name] = String(value); }
    getAttribute(name) { return this[name] || null; }
    removeAttribute(name) { delete this[name]; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; }
}

function createEnvironment({ authenticated }) {
    const elements = new Map();
    const domReady = [];
    const session = authenticated ? {
        user: { id: 'refresh-user-1', email: 'refresh@example.com' },
        access_token: 'refresh-access-token'
    } : null;

    function add(id, classes = [], text = '') {
        const el = new MockElement(id, classes);
        el.textContent = text;
        elements.set(id, el);
        return el;
    }

    add('desktopCreditCount', [], 'Credits —');
    add('mobileCreditCount', [], 'Credits —');
    add('sidebarUserCard', ['hidden']);
    add('desktopAuthBtn');
    add('desktopAuthBtnLabel', [], 'Sign In / Account');
    add('userEmailBadge', [], 'user@example.com');
    add('userAvatarBadge', [], 'U');
    add('mobileAuthBtn');
    add('mobileAuthBtnLabel', [], 'Sign In');
    add('topAuthBanner');

    const documentMock = {
        readyState: 'loading',
        activeElement: null,
        body: new MockElement('body'),
        documentElement: { style: { setProperty() {}, overflow: '' }, classList: new MockClassList() },
        getElementById(id) { return elements.get(id) || null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement(tag) { return new MockElement('dynamic-' + tag); },
        createTextNode(text) { return { textContent: String(text) }; },
        addEventListener(type, fn) {
            if (type === 'DOMContentLoaded') domReady.push(fn);
        },
        removeEventListener() {}
    };

    let logoutCalls = 0;
    let authModalCalls = 0;
    const location = {
        href: 'https://mywingmanapp.com/app',
        origin: 'https://mywingmanapp.com',
        protocol: 'https:',
        hostname: 'mywingmanapp.com',
        pathname: '/app',
        search: '',
        hash: ''
    };

    const supabaseClient = {
        auth: {
            getSession: async () => ({ data: { session }, error: null })
        },
        from() {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                maybeSingle: async () => ({ data: authenticated ? { credits: 47 } : null, error: null })
                            };
                        }
                    };
                }
            };
        }
    };

    const windowMock = {
        window: null,
        document: documentMock,
        location,
        innerWidth: 1280,
        innerHeight: 900,
        devicePixelRatio: 1,
        visualViewport: null,
        currentSupabaseSession: session,
        currentSupabaseUser: session ? session.user : null,
        supabaseClient,
        __memoryStore: {},
        getSupabaseAuthHeaders: async () => session ? { Authorization: 'Bearer ' + session.access_token } : {},
        logoutUser() { logoutCalls += 1; location.href = 'index.html'; },
        openAuthRequiredModal() { authModalCalls += 1; },
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        scrollTo() {},
        requestAnimationFrame(fn) { return setTimeout(fn, 0); },
        cancelAnimationFrame(id) { clearTimeout(id); },
        dispatchEvent() {}
    };
    windowMock.window = windowMock;

    const storage = {
        getItem() { return null; },
        setItem() {},
        removeItem() {},
        clear() {},
        key() { return null; },
        length: 0
    };
    windowMock.localStorage = storage;
    windowMock.sessionStorage = storage;

    const sandbox = {
        window: windowMock,
        document: documentMock,
        localStorage: storage,
        sessionStorage: storage,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame: windowMock.requestAnimationFrame,
        cancelAnimationFrame: windowMock.cancelAnimationFrame,
        fetch: async (url) => {
            if (String(url).includes('/api/consent/status')) {
                return { ok: true, status: 200, json: async () => ({ hasActiveConsent: true, termsVersion: '2026.1' }) };
            }
            return { ok: true, status: 200, json: async () => ({ credits: 47 }) };
        },
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        URLSearchParams,
        AbortController,
        FileReader: class FileReader {},
        Image: class Image {},
        Blob: class Blob {},
        navigator: { clipboard: { writeText: async () => {} } },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', zIndex: '0' }),
        confirm: () => true,
        Math,
        Date,
        JSON,
        Promise,
        Map,
        Set,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        parseInt,
        isNaN
    };
    sandbox.global = sandbox;
    windowMock.fetch = sandbox.fetch;

    const configCode = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(configCode, sandbox);
    vm.runInContext(appCode, sandbox);

    documentMock.readyState = 'complete';
    domReady.forEach((fn) => fn());

    return {
        sandbox,
        elements,
        location,
        get logoutCalls() { return logoutCalls; },
        get authModalCalls() { return authModalCalls; }
    };
}

(async function run() {
    console.log('▶ refresh bootstrap: restored authenticated session must reconcile dashboard state');
    const restored = createEnvironment({ authenticated: true });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert(restored.elements.get('desktopAuthBtn').classList.contains('hidden'),
        'restored authenticated session must hide stale Sign In / Account button');
    assert(!restored.elements.get('sidebarUserCard').classList.contains('hidden'),
        'restored authenticated session must reveal account card');
    assert.strictEqual(restored.elements.get('desktopCreditCount').textContent, '47 Credits',
        'restored authenticated session must refresh authoritative credits after app bootstrap');

    const originalHref = restored.location.href;
    restored.sandbox.window.handleAuthBtnClick({ preventDefault() {} });
    assert.strictEqual(restored.logoutCalls, 0,
        'stale Sign In / Account control must never sign out a restored authenticated session');
    assert.strictEqual(restored.location.href, originalHref,
        'stale Sign In / Account control must never navigate to the landing page');

    console.log('▶ signed-out bootstrap: Sign In / Account must open auth modal in place');
    const signedOut = createEnvironment({ authenticated: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signedOut.sandbox.window.handleAuthBtnClick({ preventDefault() {} });
    assert.strictEqual(signedOut.authModalCalls, 1,
        'signed-out Sign In / Account must open the canonical auth modal');
    assert.strictEqual(signedOut.location.href, 'https://mywingmanapp.com/app',
        'signed-out Sign In / Account must remain on the dashboard page');

    console.log('PASS: refresh session bootstrap keeps credits/auth UI synchronized and prevents accidental logout redirect');
})();
