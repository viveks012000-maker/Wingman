'use strict';

const assert = require('assert');

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
        this.nextElementSibling = null;
        this.onclick = null;
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

const elements = new Map();
const domReady = [];
const restoredSession = {
    user: { id: 'refresh-user-1', email: 'refresh@example.com' },
    access_token: 'refresh-access-token'
};

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
        getSession: async () => ({ data: { session: windowMock.currentSupabaseSession }, error: null })
    },
    from() {
        return {
            select() {
                return {
                    eq() {
                        return {
                            maybeSingle: async () => ({ data: { credits: 47 }, error: null })
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
    currentSupabaseSession: restoredSession,
    currentSupabaseUser: restoredSession.user,
    supabaseClient,
    __memoryStore: {},
    getSupabaseAuthHeaders: async () => windowMock.currentSupabaseSession ? { Authorization: 'Bearer ' + windowMock.currentSupabaseSession.access_token } : {},
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

const fetchMock = async (url) => {
    if (String(url).includes('/api/consent/status')) {
        return { ok: true, status: 200, json: async () => ({ hasActiveConsent: true, termsVersion: '2026.1' }) };
    }
    return { ok: true, status: 200, json: async () => ({ credits: 47 }) };
};
windowMock.fetch = fetchMock;

Object.assign(global, {
    window: windowMock,
    document: documentMock,
    localStorage: storage,
    sessionStorage: storage,
    fetch: fetchMock,
    requestAnimationFrame: windowMock.requestAnimationFrame,
    cancelAnimationFrame: windowMock.cancelAnimationFrame,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    FileReader: class FileReader {},
    Image: class Image {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', zIndex: '0' }),
    confirm: () => true
});

require('../config.js');
require('../app.js');

documentMock.readyState = 'complete';
domReady.forEach((fn) => fn());

(async function run() {
    console.log('▶ refresh bootstrap: restored authenticated session must reconcile dashboard state');
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert(elements.get('desktopAuthBtn').classList.contains('hidden'),
        'restored authenticated session must hide stale Sign In / Account button');
    assert(!elements.get('sidebarUserCard').classList.contains('hidden'),
        'restored authenticated session must reveal account card');
    assert.strictEqual(elements.get('desktopCreditCount').textContent, '47 Credits',
        'restored authenticated session must refresh authoritative credits after app bootstrap');

    const originalHref = location.href;
    windowMock.handleAuthBtnClick({ preventDefault() {} });
    assert.strictEqual(logoutCalls, 0,
        'stale Sign In / Account control must never sign out a restored authenticated session');
    assert.strictEqual(location.href, originalHref,
        'stale Sign In / Account control must never navigate to the landing page');

    console.log('▶ signed-out click: the visible desktop Sign In / Account control must be wired to the auth modal');
    windowMock.currentSupabaseSession = null;
    windowMock.currentSupabaseUser = null;
    windowMock.openAuthRequiredModal = function () { authModalCalls += 1; };
    windowMock.checkDashboardAuth();

    const desktopAuthBtn = elements.get('desktopAuthBtn');
    assert(!desktopAuthBtn.classList.contains('hidden'),
        'signed-out desktop Sign In / Account control must be visible');
    assert.strictEqual(typeof desktopAuthBtn.onclick, 'function',
        'signed-out desktop Sign In / Account control must have a real click handler');

    desktopAuthBtn.onclick({ preventDefault() {} });
    assert.strictEqual(authModalCalls, 1,
        'clicking the visible desktop Sign In / Account control must open the canonical auth modal');
    assert.strictEqual(location.href, 'https://mywingmanapp.com/app',
        'signed-out Sign In / Account must remain on the dashboard page');

    console.log('PASS: refresh session bootstrap keeps credits/auth UI synchronized and the visible desktop auth control is functional');
})();
