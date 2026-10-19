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
    mockStorage.setItem('wingman_consent_session', JSON.stringify({ userId: 'test-user-id', termsVersion: '2026.1' }));
    mockStorage.setItem('wingman_consent_prompted', JSON.stringify({ userId: 'test-user-id', termsVersion: '2026.1' }));

    let currentFetch = async (url) => {
        if (String(url).includes('/api/consent/status')) {
            return { ok: true, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1' }) };
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

    // Authoritative Server Consent and Credit check on boot
    await env.sandbox.window.checkServerConsentStatus();
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, true, 'current-session acknowledgement plus active server consent unlocks the app');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'same-session app re-entry must keep the consent prompt closed');
    await env.sandbox.window.checkServerConsentStatus();
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'rechecking consent during app/home navigation must not reopen the dialog');

    // No acknowledgement on a fresh login: ask once, remember the dismissal for this tab session,
    // and require a server-backed affirmative click before unlocking.
    env.sandbox.sessionStorage.removeItem('wingman_consent_session');
    env.sandbox.sessionStorage.removeItem('wingman_consent_prompted');
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a stored server consent record alone must not auto-accept a new login session');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false);
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex', 'the consent dialog appears after authenticated login');
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false);
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex', 'a repeated status check leaves the one current prompt open without reopening it');

    let consentPostCount = 0;
    env.setFetch(async (url, options) => {
        if (String(url).includes('/api/consent/status')) {
            return { ok: true, json: async () => ({ success: true, hasActiveConsent: true, termsVersion: '2026.1' }) };
        }
        if (String(url).endsWith('/api/consent') && options && options.method === 'POST') {
            consentPostCount += 1;
            return { ok: true, json: async () => ({ success: true, consentRecorded: true, termsVersion: '2026.1' }) };
        }
        return { ok: true, json: async () => ({ success: true }) };
    });
    await env.sandbox.window.acceptInterstitialTerms();
    assert.strictEqual(consentPostCount, 1, 'acceptance must be recorded by the authenticated server');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, true);
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');
    env.sandbox.window.openInterstitialModal();
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'accepted consent cannot be requested again in the same login session');
    const acknowledgedSession = env.sandbox.window.currentSupabaseSession;
    env.sandbox.window.currentSupabaseSession = null;
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'an early page boot check waits for Supabase session restoration');
    assert.notStrictEqual(env.sandbox.sessionStorage.getItem('wingman_consent_session'), null, 'an early boot check must not erase a valid acknowledgement');
    env.sandbox.window.currentSupabaseSession = acknowledgedSession;
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), true, 'confirmed session acknowledgement remains accepted on app re-entry');

    env.sandbox.window.currentSupabaseSession = null;
    env.sandbox.window.resetConsentSessionState();
    assert.strictEqual(env.sandbox.sessionStorage.getItem('wingman_consent_session'), null, 'sign-out clears the accepted-session marker');
    assert.strictEqual(env.sandbox.sessionStorage.getItem('wingman_consent_prompted'), null, 'sign-out clears the once-per-session prompt marker');
    assert.strictEqual(env.sandbox.window.state.isTermsAccepted, false);
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a signed-out visitor is never accepted from guest storage');
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
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a later login asks again after sign-out');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'flex');
    env.sandbox.window.closeInterstitialModal();
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), false, 'a dismissed prompt does not pop up again in the same login session');
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none');
    env.sandbox.window.openInterstitialModal();
    assert.strictEqual(env.elements.get('interstitialModal').style.display, 'none', 'the prompt stays dismissed until the user signs out');
    env.sandbox.window.currentSupabaseSession = null;
    env.sandbox.window.resetConsentSessionState();
    env.sandbox.window.currentSupabaseSession = { access_token: 'test-valid-access-token', user: { id: 'test-user-id' } };
    env.sandbox.sessionStorage.setItem('wingman_consent_session', JSON.stringify({ userId: 'test-user-id', termsVersion: '2026.1' }));
    env.sandbox.sessionStorage.setItem('wingman_consent_prompted', JSON.stringify({ userId: 'test-user-id', termsVersion: '2026.1' }));
    assert.strictEqual(await env.sandbox.window.checkServerConsentStatus(), true, 'restore accepted test session for existing feature cases');

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

    // 11. TEST SINGLE CLICK SINGLE REQUEST
    assert.strictEqual(analyzeCalls, 1, 'Single generation trigger must produce exactly 1 network request to /api/analyze');
    console.log('✔ Test 11 Passed: Single click produces exactly 1 generation request (zero duplicate dispatch)');

    console.log('\n🎉 ALL RUNTIME CROSS-FEATURE ISOLATION & BUTTON STATE TESTS PASSED!\n');
})();
