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
add('desktopAuthBtnLabel', [], 'Sign In');
add('userEmailBadge', [], 'user@example.com');
add('userAvatarBadge', [], 'U');
add('mobileAuthBtn');
add('mobileAuthBtnLabel', [], 'Sign In');
add('topAuthBanner');
add('analyzeResultsCards');
add('icebreakResultsState', ['hidden']);
add('icebreakEmptyState', ['hidden']);
add('icebreakSkeletonState', ['hidden']);
add('optimizeResultsState', ['hidden']);
add('optimizeEmptyState', ['hidden']);
add('optimizeSkeletonState', ['hidden']);
add('momentum-status-val', [], 'Private analysis');
add('bioInput', [], 'private icebreaker input');
add('auditBioInput', [], 'private bio input');
add('simulator-chat-input', [], 'private chat draft');
add('chatMessagesContainer');
add('thumbnailGrid');
add('cropperTargetImage');

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
    __wingmanAuthStateResolved: true,
    __wingmanAuthStateRevision: 0,
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
        return { ok: true, status: 200, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1', privacyVersion: '2026.1' }) };
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
        'restored authenticated session must hide stale Sign In button');
    assert.strictEqual(elements.get('desktopAuthBtn').getAttribute('aria-hidden'), 'true',
        'hidden desktop auth button must stay out of the accessibility tree');
    assert(!elements.get('sidebarUserCard').classList.contains('hidden'),
        'restored authenticated session must reveal account card');
    assert.strictEqual(elements.get('mobileAuthBtnLabel').textContent, 'Log Out',
        'authenticated mobile viewport must expose Log Out as its only auth action');
    assert.strictEqual(elements.get('mobileAuthBtn').getAttribute('aria-hidden'), null,
        'visible mobile Log Out action must be available to assistive technology');
    assert.strictEqual(elements.get('desktopCreditCount').textContent, '47 Credits',
        'restored authenticated session must refresh authoritative credits after app bootstrap');

    const originalHref = location.href;
    windowMock.handleAuthBtnClick({ preventDefault() {} });
    assert.strictEqual(logoutCalls, 0,
        'stale Sign In control must never sign out a restored authenticated session');
    assert.strictEqual(location.href, originalHref,
        'stale Sign In control must never navigate to the landing page');

    console.log('▶ signed-out click: the visible desktop Sign In control must be wired to the auth modal');
    windowMock.currentSupabaseSession = null;
    windowMock.currentSupabaseUser = null;
    windowMock.__wingmanAuthStateResolved = true;
    windowMock.openAuthRequiredModal = function () { authModalCalls += 1; };
    windowMock.checkDashboardAuth();

    const desktopAuthBtn = elements.get('desktopAuthBtn');
    assert(!desktopAuthBtn.classList.contains('hidden'),
        'signed-out desktop Sign In control must be visible');
    assert.strictEqual(desktopAuthBtn.getAttribute('aria-hidden'), null,
        'visible desktop Sign In control must be available to assistive technology');
    assert.strictEqual(desktopAuthBtn.getAttribute('tabindex'), null,
        'visible desktop Sign In control must be reachable by keyboard');
    assert.strictEqual(typeof desktopAuthBtn.onclick, 'function',
        'signed-out desktop Sign In control must have a real click handler');

    desktopAuthBtn.onclick({ preventDefault() {} });
    assert.strictEqual(authModalCalls, 1,
        'clicking the visible desktop Sign In control must open the canonical auth modal');
    assert.strictEqual(location.href, 'https://mywingmanapp.com/app',
        'signed-out Sign In must remain on the dashboard page');

    console.log('▶ delayed Supabase restore: reconciliation must hydrate canonical session before rendering signed-out UI');
    windowMock.currentSupabaseSession = null;
    windowMock.currentSupabaseUser = null;
    windowMock.__wingmanAuthStateResolved = false;
    windowMock.state.credits = null;
    windowMock.state.creditsStatus = 'idle';
    elements.get('desktopCreditCount').textContent = 'Credits —';
    elements.get('mobileCreditCount').textContent = 'Credits —';
    elements.get('sidebarUserCard').classList.add('hidden');
    elements.get('desktopAuthBtn').classList.remove('hidden');
    supabaseClient.auth.getSession = async () => ({ data: { session: restoredSession }, error: null });

    await Promise.resolve(windowMock.reconcileDashboardSession());
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.strictEqual(windowMock.currentSupabaseSession, restoredSession,
        'reconciliation must hydrate currentSupabaseSession from canonical Supabase getSession()');
    assert.strictEqual(windowMock.currentSupabaseUser, restoredSession.user,
        'reconciliation must hydrate currentSupabaseUser from the restored canonical session');
    assert(elements.get('desktopAuthBtn').classList.contains('hidden'),
        'hydrated restored session must hide stale Sign In button');
    assert(!elements.get('sidebarUserCard').classList.contains('hidden'),
        'hydrated restored session must reveal account card');
    assert.strictEqual(elements.get('desktopCreditCount').textContent, '47 Credits',
        'hydrated restored session must refresh authoritative credits');

    console.log('▶ failed Supabase restore: auth controls must settle to signed-out instead of loading forever');
    windowMock.currentSupabaseSession = null;
    windowMock.currentSupabaseUser = null;
    windowMock.__wingmanAuthStateResolved = false;
    windowMock.__wingmanAuthStateRevision = 0;
    windowMock.state.credits = null;
    windowMock.state.creditsStatus = 'idle';
    supabaseClient.auth.getSession = async () => { throw new Error('Temporary network failure'); };
    await Promise.resolve(windowMock.reconcileDashboardSession());
    assert.strictEqual(windowMock.__wingmanAuthStateResolved, true,
        'failed canonical restoration must resolve the auth state');
    assert(!elements.get('desktopAuthBtn').classList.contains('hidden'),
        'failed restoration must restore the usable Sign In control');
    assert.notStrictEqual(elements.get('desktopCreditCount').textContent, '0 Credits',
        'failed restoration must not fabricate a zero-credit balance');

    console.log('▶ logout cleanup: account-specific results, inputs, and conversation state must be cleared');
    windowMock.state.uploadedFiles = ['data:image/png;base64,private'];
    windowMock.state.rawImageFile = { name: 'private.png' };
    windowMock.state.croppedWebpDataUrl = 'data:image/webp;base64,private';
    windowMock.state.activeTranscriptCache = 'private transcript';
    windowMock.state.lastResults = 'private results';
    windowMock.state.icebreakCardsData = 'private icebreakers';
    windowMock.state.optimizeCardsData = 'private bio results';
    windowMock.state.credits = 12;
    windowMock.state.creditsStatus = 'loaded';
    elements.get('analyzeResultsCards').innerHTML = 'private analyzer output';
    elements.get('icebreakResultsState').innerHTML = 'private icebreaker output';
    elements.get('optimizeResultsState').innerHTML = 'private bio output';
    elements.get('chatMessagesContainer').innerHTML = 'private conversation';
    elements.get('momentum-status-val').textContent = 'private summary';
    elements.get('bioInput').value = 'private icebreaker input';
    elements.get('auditBioInput').value = 'private bio input';
    elements.get('simulator-chat-input').value = 'private chat draft';
    elements.get('userEmailBadge').textContent = 'previous-account@example.com';
    elements.get('sidebarUserCard').classList.remove('hidden');
    windowMock.currentAttractionScore = 98;

    windowMock.clearAppState();
    assert.deepStrictEqual(windowMock.state.uploadedFiles, []);
    assert.strictEqual(windowMock.state.rawImageFile, null);
    assert.strictEqual(windowMock.state.croppedWebpDataUrl, null);
    assert.strictEqual(windowMock.state.activeTranscriptCache, null);
    assert.strictEqual(windowMock.state.lastResults, null);
    assert.strictEqual(windowMock.state.icebreakCardsData, null);
    assert.strictEqual(windowMock.state.optimizeCardsData, null);
    assert.strictEqual(windowMock.state.credits, null);
    assert.strictEqual(windowMock.state.creditsStatus, 'idle');
    assert.strictEqual(elements.get('analyzeResultsCards').innerHTML, '');
    assert.strictEqual(elements.get('icebreakResultsState').innerHTML, '');
    assert.strictEqual(elements.get('optimizeResultsState').innerHTML, '');
    assert.strictEqual(elements.get('chatMessagesContainer').innerHTML, '');
    assert.strictEqual(elements.get('bioInput').value, '');
    assert.strictEqual(elements.get('auditBioInput').value, '');
    assert.strictEqual(elements.get('simulator-chat-input').value, '');
    assert.strictEqual(elements.get('userEmailBadge').textContent, '');
    assert(elements.get('sidebarUserCard').classList.contains('hidden'),
        'logout cleanup must immediately hide the previous account card');
    assert(!elements.get('desktopAuthBtn').classList.contains('hidden'),
        'logout cleanup must restore a usable Sign In control');
    assert.strictEqual(windowMock.currentAttractionScore, 65);
    assert.strictEqual(elements.get('desktopCreditCount').textContent, 'Sign in for credits');
    assert.notStrictEqual(elements.get('desktopCreditCount').textContent, '0 Credits');

    console.log('PASS: refresh session bootstrap keeps credits/auth UI synchronized and the visible desktop auth control is functional');
})();
