/**
 * Tests: Runtime Screenshot Analyzer Button State & Cross-Feature Isolation
 * Executes actual application handlers from app.js in a full simulated DOM environment.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('\n============================================================');
console.log('🧪 RUNNING RUNTIME CROSS-FEATURE ISOLATION & BUTTON STATE TESTS');
console.log('============================================================\n');

// Build a full DOM simulation environment for app.js
function setupDOMEnvironment() {
    const elements = new Map();
    const eventListeners = new Map();

    class MockClassList {
        constructor(initial = []) {
            this.classes = new Set(initial);
        }
        add(...cls) { cls.forEach(c => this.classes.add(c)); }
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); }
        toggle(cls, force) {
            if (force === true) this.classes.add(cls);
            else if (force === false) this.classes.delete(cls);
            else if (this.classes.has(cls)) this.classes.delete(cls);
            else this.classes.add(cls);
        }
        contains(cls) { return this.classes.has(cls); }
    }

    class MockElement {
        constructor(id, tag = 'div', initialClasses = []) {
            this.id = id;
            this.tagName = tag.toUpperCase();
            this.classList = new MockClassList(initialClasses);
            this.children = [];
            this.parentNode = null;
            this.value = '';
            this.disabled = false;
            this.checked = false;
            this.textContent = '';
            this.innerHTML = '';
            this.style = {};
            this._listeners = new Map();
        }
        setAttribute(name, val) { this[name] = val; }
        getAttribute(name) { return this[name] || null; }
        removeAttribute(name) { delete this[name]; }
        addEventListener(event, fn) {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push(fn);
        }
        removeEventListener(event, fn) {
            if (this._listeners.has(event)) {
                this._listeners.set(event, this._listeners.get(event).filter(f => f !== fn));
            }
        }
        dispatchEvent(event) {
            const list = this._listeners.get(event.type) || [];
            list.forEach(fn => fn(event));
        }
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        querySelectorAll() { return []; }
        querySelector() { return null; }
        closest() { return null; }
        getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
    }

    function getOrCreate(id, tag = 'div', initialClasses = []) {
        if (!elements.has(id)) {
            elements.set(id, new MockElement(id, tag, initialClasses));
        }
        return elements.get(id);
    }

    // Required DOM elements in app.html
    const runAnalysisBtn = getOrCreate('runAnalysisBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    runAnalysisBtn.disabled = true;
    const generateIcebreakerBtn = getOrCreate('generateIcebreakerBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    generateIcebreakerBtn.disabled = true;
    const runAuditBtn = getOrCreate('runAuditBtn', 'button', ['opacity-40', 'cursor-not-allowed']);
    runAuditBtn.disabled = true;

    const bioInput = getOrCreate('bioInput', 'textarea');
    const bioCharCounter = getOrCreate('bioCharCounter', 'span');
    const auditBioInput = getOrCreate('auditBioInput', 'textarea');
    const auditBioCharCounter = getOrCreate('auditBioCharCounter', 'span');
    const simulatorChatInput = getOrCreate('simulator-chat-input', 'textarea');
    const chatCharCounter = getOrCreate('chatCharCounter', 'span');
    const screenshotInput = getOrCreate('screenshotInput', 'input');
    const dropzone = getOrCreate('dropzone', 'div');
    const dropzoneEmpty = getOrCreate('dropzoneEmpty', 'div');
    const dropzonePreview = getOrCreate('dropzonePreview', 'div');
    const thumbnailGrid = getOrCreate('thumbnailGrid', 'div');
    const uploadedCountLabel = getOrCreate('uploadedCountLabel', 'span');
    const creditCostLabel = getOrCreate('creditCostLabel', 'span');
    const toastContainer = getOrCreate('toastContainer', 'div');
    const privacyConsent = getOrCreate('privacyConsent', 'input');
    privacyConsent.checked = true;
    const interstitialModal = getOrCreate('interstitialModal', 'div', ['hidden', 'opacity-0', 'pointer-events-none']);
    interstitialModal.style.display = 'none';
    getOrCreate('interstitialCard', 'div', ['scale-95']);
    getOrCreate('interstitialAcceptBtn', 'button');

    const toasts = [];
    const windowMock = {
        currentSupabaseUser: { id: 'test-user-id', email: 'test@mywingman.com' },
        currentSupabaseSession: { access_token: 'test-valid-access-token', user: { id: 'test-user-id' } },
        showToast(msg, type) { toasts.push({ msg, type }); },
        showNotification(title, msg, type) { toasts.push({ title, msg, type }); },
        getSupabaseAuthHeaders: async () => ({ 'Authorization': 'Bearer test-valid-access-token' }),
        openPurchaseModal: () => { windowMock._purchaseModalOpened = true; },
        openAuthRequiredModal: () => { windowMock._authModalOpened = true; },
        trackWingmanEvent: () => {},
        addEventListener: (event, fn) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(fn);
        },
        removeEventListener: (event, fn) => {
            if (eventListeners.has(event)) {
                eventListeners.set(event, eventListeners.get(event).filter(f => f !== fn));
            }
        },
        _purchaseModalOpened: false,
        _authModalOpened: false,
        _toasts: toasts,
        focus: () => {}
    };

    const documentMock = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => new MockElement('dyn_' + Math.random().toString(36).substr(2, 5), tag),
        body: new MockElement('body', 'body'),
        addEventListener: (event, fn) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(fn);
        },
        removeEventListener: (event, fn) => {},
        activeElement: null,
        readyState: 'complete'
    };

    class MockFileReader {
        readAsDataURL(file) {
            setTimeout(() => {
                if (this.onload) {
                    this.onload({ target: { result: file._dataUrl || 'data:image/jpeg;base64,mockBase64Data' } });
                }
            }, 0);
        }
    }

    class MockImage {
        constructor() {
            this.naturalWidth = 800;
            this.naturalHeight = 1200;
        }
        set src(val) {
            setTimeout(() => {
                if (this.onload) this.onload();
            }, 0);
        }
    }

    class MockCanvas {
        getContext() {
            return { drawImage: () => {} };
        }
        toDataURL() {
            return 'data:image/jpeg;base64,mockBase64Compressed';
        }
    }

    documentMock.createElement = (tag) => {
        if (tag === 'canvas') return new MockCanvas();
        return new MockElement('dyn_' + Math.random().toString(36).substr(2, 5), tag);
    };

    const storageMap = new Map();
    const mockStorage = {
        getItem: (k) => storageMap.get(k) || null,
        setItem: (k, v) => storageMap.set(k, String(v)),
        removeItem: (k) => storageMap.delete(k),
        clear: () => storageMap.clear()
    };
    mockStorage.setItem('wingman_authenticated', 'true');
    mockStorage.setItem('wingman_terms_accepted', 'true');

    let currentFetch = async (url) => {
        if (String(url).includes('/api/consent/status')) {
            return { ok: true, status: 200, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1', privacyVersion: '2026.1' }) };
        }
        if (String(url).includes('/api/credits')) {
            return { ok: true, json: async () => ({ success: true, credits: 50, status: 'ready' }) };
        }
        return { ok: true, json: async () => ({ success: true }) };
    };

    const sandbox = {
        window: windowMock,
        document: documentMock,
        FileReader: MockFileReader,
        Image: MockImage,
        AbortController: AbortController,
        localStorage: mockStorage,
        sessionStorage: mockStorage,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
        Array: Array,
        Set: Set,
        Map: Map,
        Math: Math,
        JSON: JSON,
        Object: Object,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Date: Date,
        RegExp: RegExp,
        Error: Error,
        parseInt: parseInt,
        isNaN: isNaN,
        fetch: (...args) => currentFetch(...args)
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = documentMock;
    sandbox.window.localStorage = mockStorage;
    sandbox.window.sessionStorage = mockStorage;
    sandbox.window.fetch = (...args) => currentFetch(...args);
    sandbox.global = sandbox;

    // Load and evaluate app.js inside this sandbox
    const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(appJsCode, sandbox);

    const origShowToast = sandbox.window.showToast;
    sandbox.window.showToast = function(msg, type, append) {
        toasts.push({ msg, type });
        if (typeof origShowToast === 'function') origShowToast(msg, type, append);
    };

    return { sandbox, elements, windowMock, setFetch: (fn) => { currentFetch = fn; } };
}

// -------------------------------------------------------------
// EXECUTE FULL RUNTIME BEHAVIORAL SUITE
// -------------------------------------------------------------
(async function runTests() {
    const env = setupDOMEnvironment();
    const runBtn = env.elements.get('runAnalysisBtn');
    const bioBtn = env.elements.get('generateIcebreakerBtn');
    const auditBtn = env.elements.get('runAuditBtn');
    const bioInput = env.elements.get('bioInput');
    const auditBioInput = env.elements.get('auditBioInput');

    // A server-confirmed active record is authoritative after login, refresh, and navigation;
    // browser session markers are not a second consent requirement.
    await env.sandbox.window.checkServerConsentStatus();
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, true, 'active server consent unlocks the app without a browser-session marker');
    assert.strictEqual(env.sandbox.window.state.consentStatus, 'active');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'server-confirmed consent keeps Unlock Workspace closed');
    assert.strictEqual(env.sandbox.sessionStorage.getItem('wingman_consent_session'), null, 'server verification does not require or create a session consent marker');
    await env.sandbox.window.checkServerConsentStatus();
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'refresh and home/app re-entry must not reopen the dialog');

    // A different tab or a fresh page session independently loads consent from the server.
    const otherTab = setupDOMEnvironment();
    otherTab.sandbox.sessionStorage.removeItem('wingman_consent_session');
    otherTab.sandbox.sessionStorage.removeItem('wingman_consent_prompted');
    assert.strictEqual(await otherTab.sandbox.window.checkServerConsentStatus(), true, 'another tab loads the same user’s active server consent');
    assert.strictEqual(otherTab.sandbox.window.state.isTermsAccepted, true);
    assert.strictEqual(otherTab.elements.get('interstitialModal').style.display, 'none');

    assert.strictEqual(await env.sandbox.window.ensureActiveConsent(), true, 'all AI feature entry points can await the authoritative active status');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');

    const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    for (const featureName of ['runAnalysis', 'generateIcebreaker', 'runAudit', 'submitChatboxMessage']) {
        const start = appSource.indexOf(`window.${featureName} = async function`);
        assert.notStrictEqual(start, -1, `${featureName} handler exists`);
        const nextHandler = appSource.indexOf('\n    window.', start + 1);
        const featureSource = appSource.slice(start, nextHandler === -1 ? appSource.length : nextHandler);
        assert(featureSource.includes('await window.ensureActiveConsent()'), `${featureName} waits for server-confirmed consent before AI work`);
    }
    assert(appSource.includes('await window.refreshConsentAfterRejection()'), 'a backend CONSENT_REQUIRED response refreshes authoritative status');

    const pendingTab = setupDOMEnvironment();
    let resolvePendingStatus;
    pendingTab.setFetch(() => new Promise(resolve => { resolvePendingStatus = resolve; }));
    const pendingStatus = pendingTab.sandbox.window.checkServerConsentStatus();
    const pendingFeatureGate = pendingTab.sandbox.window.ensureActiveConsent();
    assert.strictEqual(pendingTab.elements.get('interstitialModal').style.display, 'none', 'a pending status request cannot open Unlock Workspace early');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(typeof resolvePendingStatus, 'function', 'the authoritative status request reached the mocked server');
    resolvePendingStatus({
        ok: true,
        status: 200,
        json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1', privacyVersion: '2026.1' })
    });
    assert.strictEqual(await pendingStatus, true);
    assert.strictEqual(await pendingFeatureGate, true, 'feature submission waits for active server consent');
    assert.strictEqual(pendingTab.elements.get('interstitialModal').style.display, 'none');

    let consentPostCount = 0;
    let consentStatus = { success: true, hasActiveConsent: false, termsVersion: '2026.2', privacyVersion: '2026.2' };
    let acceptResponseResolver = null;
    const consentFetch = async (url, options) => {
        if (String(url).includes('/api/consent/status')) {
            return { ok: true, status: 200, json: async () => consentStatus };
        }
        if (String(url).endsWith('/api/consent') && options && options.method === 'POST') {
            consentPostCount += 1;
            return new Promise(resolve => { acceptResponseResolver = resolve; });
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    env.setFetch(consentFetch);

    // Switching accounts cannot carry the previous user's active state.
    env.sandbox.window.currentSupabaseSession = { access_token: 'user-b-token', user: { id: 'user-b' } };
    env.sandbox.window.currentSupabaseUser = env.sandbox.window.currentSupabaseSession.user;
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a different user without a current consent record remains locked');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false);
    assert.strictEqual(env.sandbox.window.state.consentUserId, 'user-b', 'the new status result is scoped to the new user');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex', 'missing or outdated consent requests a genuine acceptance');
    assert.strictEqual(env.sandbox.window.state.consentTermsVersion, '2026.2', 'the new policy version is shown to the user');
    assert.strictEqual(consentPostCount, 0, 'missing consent is never recorded before an explicit user click');

    // A browser-storage failure must not undo a successful persistent server recording.
    const originalSessionStorageSet = env.sandbox.sessionStorage.setItem;
    env.sandbox.sessionStorage.setItem = () => { throw new Error('session storage blocked'); };
    const accepting = env.sandbox.window.acceptInterstitialTerms();
    const duplicateAccept = env.sandbox.window.acceptInterstitialTerms();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(consentPostCount, 1, 'duplicate acceptance clicks submit only one in-flight request');
    assert.strictEqual(typeof acceptResponseResolver, 'function', 'the acceptance request reached the mocked server');
    acceptResponseResolver({
        ok: true,
        status: 200,
        json: async () => ({ success: true, consentRecorded: true, termsVersion: '2026.2', privacyVersion: '2026.2' })
    });
    await Promise.all([accepting, duplicateAccept]);
    env.sandbox.sessionStorage.setItem = originalSessionStorageSet;
    assert.strictEqual(consentPostCount, 1, 'acceptance is recorded once by the authenticated server');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, true, 'persistent server acceptance unlocks despite blocked sessionStorage');
    assert.strictEqual(env.sandbox.window.state.consentStatus, 'active');
    assert.strictEqual(env.sandbox.sessionStorage.getItem('wingman_consent_session'), null, 'successful acceptance does not depend on a browser session marker');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');

    // A newer policy pair requires fresh consent even if the previous pair was accepted.
    consentStatus = { success: true, hasActiveConsent: false, termsVersion: '2026.3', privacyVersion: '2026.3' };
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'updated Terms or Privacy versions require renewed consent');
    assert.strictEqual(env.sandbox.window.state.consentTermsVersion, '2026.3');
    assert.strictEqual(env.sandbox.window.state.consentPrivacyVersion, '2026.3');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex');

    // Refresh and a later login reload the same server record without requiring acceptance again.
    consentStatus = { success: true, hasActiveConsent: true, termsVersion: '2026.3', privacyVersion: '2026.3' };
    env.sandbox.window.resetConsentSessionState();
    assert.strictEqual(env.sandbox.sessionStorage.getItem('wingman_consent_session'), null, 'resetting ephemeral UI state clears only the optional session marker');
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), true, 'refresh or relogin reloads valid persistent server consent');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, true);
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');

    // Withdrawn/current-policy-missing consent stays locked; status failures do not invent consent or prompt.
    consentStatus = { success: true, hasActiveConsent: false, termsVersion: '2026.3', privacyVersion: '2026.3' };
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'withdrawn or missing consent remains locked');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false);
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex');
    env.setFetch(async () => ({ ok: false, status: 503, json: async () => ({ success: false, hasActiveConsent: false }) }));
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'failed status checks remain locked');
    assert.strictEqual(env.sandbox.window.state.consentStatus, 'service_unavailable');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'network failure does not show an acceptance prompt');
    env.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ success: false, hasActiveConsent: true, termsVersion: '2026.3', privacyVersion: '2026.3' }) }));
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'malformed status responses cannot grant consent');
    assert.strictEqual(env.sandbox.window.state.consentStatus, 'service_unavailable');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false);

    env.setFetch(consentFetch);
    env.sandbox.window.currentSupabaseSession = null;
    env.sandbox.window.currentSupabaseUser = null;
    env.sandbox.window.resetConsentSessionState();
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false);
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a signed-out visitor is never accepted from browser storage');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'consent is not requested before login');
    const originalOpenAuthRequiredModal = env.sandbox.window.openAuthRequiredModal;
    let unauthenticatedAuthRedirects = 0;
    env.sandbox.window.openAuthRequiredModal = (...args) => {
        unauthenticatedAuthRedirects += 1;
        return originalOpenAuthRequiredModal(...args);
    };
    env.sandbox.window.openInterstitialModal();
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'unauthenticated users cannot open the age/Terms consent prompt');
    assert.strictEqual(unauthenticatedAuthRedirects, 1, 'unauthenticated users are directed to sign in first');

    env.sandbox.window.currentSupabaseSession = { access_token: 'test-valid-access-token', user: { id: 'test-user-id' } };
    env.sandbox.window.currentSupabaseUser = env.sandbox.window.currentSupabaseSession.user;
    consentStatus = { success: true, hasActiveConsent: false, termsVersion: '2026.3', privacyVersion: '2026.3' };
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a later login prompts only when the server has no valid consent');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex');
    env.sandbox.window.closeInterstitialModal();
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a dismissed prompt does not pop up again in the same login session');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');
    env.sandbox.window.openInterstitialModal();
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'the prompt stays dismissed until the user signs out');
    consentStatus = { success: true, hasActiveConsent: true, termsVersion: '2026.3', privacyVersion: '2026.3' };
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), true, 'restored server consent unlocks the existing feature cases');

    // A backend rejection triggers a fresh status query and trusts that response before prompting.
    env.setFetch(async url => {
        if (String(url).includes('/api/consent/status')) {
            return { ok: true, status: 200, json: async () => consentStatus };
        }
        return { ok: false, status: 403, json: async () => ({ success: false, code: 'CONSENT_REQUIRED' }) };
    });
    assert.strictEqual(await env.sandbox.window.generateWingmanResponse('/api/test-consent', { text: 'no generation is performed' }), null);
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, true, 'a stale 403 cannot override an active server record');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');
    consentStatus = { success: true, hasActiveConsent: false, termsVersion: '2026.4', privacyVersion: '2026.4' };
    assert.strictEqual(await env.sandbox.window.generateWingmanResponse('/api/test-consent', { text: 'no generation is performed' }), null);
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false, 'a 403 followed by missing server consent keeps the workspace locked');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex', 'confirmed missing consent reopens the acceptance prompt');
    consentStatus = { success: true, hasActiveConsent: true, termsVersion: '2026.4', privacyVersion: '2026.4' };
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), true, 'server-confirmed consent restores feature availability');

    env.sandbox.window.updateUICredits(50);
    env.sandbox.window.updateButtonStates();

    // 1. STATE A: 0 screenshots, Bio empty, Icebreaker empty
    assert.strictEqual(runBtn.disabled, true, 'State A: runAnalysisBtn must be disabled when 0 screenshots loaded');
    assert.strictEqual(bioBtn.disabled, true, 'State A: generateIcebreakerBtn disabled with empty input');
    assert.strictEqual(auditBtn.disabled, true, 'State A: runAuditBtn disabled with empty input');
    console.log('✔ State A Passed: Initial state (0 screenshots, empty inputs) -> Analyzer button disabled (disabled === true)');

    // 2. STATE B: Type 10+ words into Bio Optimizer (auditBioInput) with 0 screenshots
    auditBioInput.value = 'I love traveling, hiking up mountains, drinking espresso, reading classic sci-fi novels and discovering city night lights.';
    auditBioInput.dispatchEvent({ type: 'input' });
    assert.strictEqual(auditBtn.disabled, false, 'State B: runAuditBtn enabled with 10 words');
    assert.strictEqual(runBtn.disabled, true, 'State B: runAnalysisBtn MUST STILL BE DISABLED (Bio input has 0 effect on Analyzer)');
    console.log('✔ State B Passed: 10 words in Bio Optimizer -> Bio button enabled, Analyzer STILL strictly disabled');

    // 3. STATE C: Type 10+ words into Icebreaker (bioInput) with 0 screenshots
    bioInput.value = 'Adventurous soul who loves road trips, listening to vinyl records, and finding the best hidden pizza spots.';
    bioInput.dispatchEvent({ type: 'input' });
    assert.strictEqual(bioBtn.disabled, false, 'State C: generateIcebreakerBtn enabled with 10 words');
    assert.strictEqual(runBtn.disabled, true, 'State C: runAnalysisBtn MUST STILL BE DISABLED (Icebreaker input has 0 effect on Analyzer)');
    console.log('✔ State C Passed: 10 words in Icebreaker -> Icebreaker button enabled, Analyzer STILL strictly disabled');

    // 4. STATE D: Upload exactly ONE valid screenshot
    const mockFile = {
        name: 'screenshot1.jpg',
        type: 'image/jpeg',
        size: 1024 * 100, // 100 KB
        _dataUrl: 'data:image/jpeg;base64,sampleScreenshotDataUrl1'
    };
    await env.sandbox.window.processSelectedFiles([mockFile]);

    // Give microtask / async canvas pipeline time to resolve
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.strictEqual(runBtn.disabled, false, 'State D: runAnalysisBtn MUST BE ENABLED immediately after uploading 1 valid screenshot');
    console.log('✔ State D Passed: Upload 1 screenshot -> Analyzer button IMMEDIATELY enabled (disabled === false)');

    // 5. STATE E: Remove the screenshot while Bio & Icebreaker are populated with 10+ words
    env.sandbox.window.removeThumbnail(0);
    assert.strictEqual(runBtn.disabled, true, 'State E: runAnalysisBtn MUST BE DISABLED after removing screenshot');
    assert.strictEqual(bioBtn.disabled, false, 'State E: Icebreaker button remains enabled');
    assert.strictEqual(auditBtn.disabled, false, 'State E: Bio button remains enabled');
    console.log('✔ State E Passed: Remove screenshot -> Analyzer button disabled, other features remain independent');

    // 6. STATE F: Upload screenshot again with inputs populated
    await env.sandbox.window.processSelectedFiles([mockFile]);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(runBtn.disabled, false, 'State F: runAnalysisBtn re-enabled after uploading screenshot again');
    console.log('✔ State F Passed: Re-upload screenshot -> Analyzer button re-enabled');

    // 7. STATE G: Clear Bio & Icebreaker to empty, keep screenshot
    bioInput.value = '';
    bioInput.dispatchEvent({ type: 'input' });
    auditBioInput.value = '';
    auditBioInput.dispatchEvent({ type: 'input' });

    assert.strictEqual(bioBtn.disabled, true, 'State G: Icebreaker button disabled when empty');
    assert.strictEqual(auditBtn.disabled, true, 'State G: Bio button disabled when empty');
    assert.strictEqual(runBtn.disabled, false, 'State G: Analyzer button MUST REMAIN ENABLED when inputs are empty');
    console.log('✔ State G Passed: Empty Bio & Icebreaker inputs have ZERO effect on Analyzer (Analyzer remains enabled)');

    // 8. STATE H: Upload up to 5 screenshots
    const mockFile2 = { name: 'screenshot2.jpg', type: 'image/jpeg', size: 1024 * 50, _dataUrl: 'data:image/jpeg;base64,mock2' };
    const mockFile3 = { name: 'screenshot3.jpg', type: 'image/jpeg', size: 1024 * 50, _dataUrl: 'data:image/jpeg;base64,mock3' };
    const mockFile4 = { name: 'screenshot4.jpg', type: 'image/jpeg', size: 1024 * 50, _dataUrl: 'data:image/jpeg;base64,mock4' };
    const mockFile5 = { name: 'screenshot5.jpg', type: 'image/jpeg', size: 1024 * 50, _dataUrl: 'data:image/jpeg;base64,mock5' };
    await env.sandbox.window.processSelectedFiles([mockFile2, mockFile3, mockFile4, mockFile5]);
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.strictEqual(runBtn.disabled, false, 'State H: 5 screenshots loaded -> Analyzer enabled');
    console.log('✔ State H Passed: 5 screenshots loaded -> Analyzer button enabled');

    // 9. STATE I: Attempting 6th screenshot rejected
    const mockFile6 = { name: 'screenshot6.jpg', type: 'image/jpeg', size: 1024 * 50, _dataUrl: 'data:image/jpeg;base64,mock6' };
    await env.sandbox.window.processSelectedFiles([mockFile6]);
    assert.strictEqual(runBtn.disabled, false, 'State I: 6th screenshot rejected -> Analyzer remains enabled with 5');
    console.log('✔ State I Passed: 6th screenshot rejected before state insertion -> Analyzer button remains enabled with 5');

    // 10. TEST CREDIT 503 SERVICE UNAVAILABLE HANDLING
    let analyzeCalls = 0;
    let analyticsCalls = 0;
    env.setFetch(async (url) => {
        if (typeof url === 'string' && url.includes('/api/analytics')) {
            analyticsCalls++;
            return { ok: true, json: async () => ({ success: true }) };
        }
        if (typeof url === 'string' && url.includes('/api/analyze')) {
            analyzeCalls++;
            return {
                ok: false,
                status: 503,
                json: async () => ({ success: false, error: 'Credit service temporarily unavailable. Balance unchanged. Please try again.' })
            };
        }
        return { ok: true, json: async () => ({ success: true }) };
    });

    const res503 = await env.sandbox.window.generateWingmanResponse('/api/analyze', { text: 'test' });
    assert.strictEqual(res503, null, '503 must return null without crashing or re-attempting in loop');
    assert.strictEqual(env.windowMock._purchaseModalOpened, false, '503 MUST NOT open purchase modal');

    const lastToast = env.windowMock._toasts[env.windowMock._toasts.length - 1];
    assert.strictEqual(lastToast.msg.includes('temporarily unavailable') || lastToast.msg.includes('Credit service'), true);
    assert.strictEqual(lastToast.msg.includes('Insufficient credits'), false, '503 MUST NOT show Insufficient credits');
    console.log('✔ Test 10 Passed: HTTP 503 Credit Service Unavailable handled cleanly (No purchase modal, no insufficient credit message)');

    // 11. A late feature response must not restore the previous account's balance or output.
    let resolveLateFeatureResponse = null;
    env.setFetch((url) => {
        if (String(url).includes('/api/late-account-response')) {
            return new Promise(resolve => { resolveLateFeatureResponse = resolve; });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });
    const lateFeatureResponse = env.sandbox.window.generateWingmanResponse('/api/late-account-response', {});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(typeof resolveLateFeatureResponse, 'function', 'the previous account request is pending');
    env.sandbox.window.clearAppState();
    env.sandbox.window.currentSupabaseSession = { access_token: 'user-b-token', user: { id: 'user-b' } };
    env.sandbox.window.currentSupabaseUser = env.sandbox.window.currentSupabaseSession.user;
    resolveLateFeatureResponse({
        ok: true,
        status: 200,
        json: async () => ({ creditsVerified: true, credits: 42, text: 'private response from user A' })
    });
    assert.strictEqual(await lateFeatureResponse, null, 'a response from the cleared account is discarded');
    assert.strictEqual(env.sandbox.window.state.credits, null, 'the old response cannot restore a previous account balance');
    assert.strictEqual(env.sandbox.window.state.lastResults, null, 'private prior-account output stays cleared');
    console.log('✔ Test 11 Passed: Late feature response cannot restore previous-account credits or output');

    // 12. TEST SINGLE CLICK SINGLE REQUEST
    assert.strictEqual(analyzeCalls, 1, 'Single generation trigger must produce exactly 1 network request to /api/analyze');
    console.log('✔ Test 12 Passed: Single click produces exactly 1 generation request (zero duplicate dispatch)');

    console.log('\n🎉 ALL RUNTIME CROSS-FEATURE ISOLATION & BUTTON STATE TESTS PASSED!\n');
})();
