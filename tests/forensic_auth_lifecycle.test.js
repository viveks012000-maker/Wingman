'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const supabaseClientSrc = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const configSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, error: e.message });
        console.log(`❌ FAIL: ${name} — ${e.message}`);
    }
}

async function runTests() {
    console.log('========================================================================');
    console.log('🔍 FORENSIC AUTHENTICATION & CREDITS REGRESSION TEST SUITE');
    console.log('========================================================================\n');

    // -------------------------------------------------------------------------
    // STATIC & ARCHITECTURAL VERIFICATION
    // -------------------------------------------------------------------------
    await test('1. logoutUser must be an asynchronous function that can be awaited', () => {
        const isAsync = /window\.logoutUser\s*=\s*async\s+function/.test(supabaseClientSrc);
        assert.ok(isAsync, 'window.logoutUser must be defined as an async function');
    });

    await test('2. logoutUser must await supabaseClient.auth.signOut() before navigation', () => {
        const signOutCall = /await\s+Promise\.race\(\[\s*window\.supabaseClient\.auth\.signOut/.test(supabaseClientSrc) ||
                            /await\s+[^;]*auth\.signOut\([^)]*\)/.test(supabaseClientSrc);
        assert.ok(signOutCall, 'supabaseClient.auth.signOut() must be awaited inside logoutUser');
    });

    await test('3. Navigation to index.html must only occur after logout settling', () => {
        const logoutBodyMatch = supabaseClientSrc.match(/window\.logoutUser\s*=\s*async\s+function[^{]*\{([\s\S]*?)\n\s*\};/);
        assert.ok(logoutBodyMatch, 'window.logoutUser body must be findable');
        const body = logoutBodyMatch[1];
        const signOutIdx = body.indexOf('.signOut(');
        const navIdx = body.indexOf('location.href');
        assert.ok(signOutIdx !== -1, 'signOut must be called in logoutUser');
        assert.ok(navIdx !== -1, 'navigation must be present in logoutUser');
        assert.ok(signOutIdx < navIdx, 'signOut must precede navigation');
    });

    await test('4. Storage purge must safely target the application Supabase auth storage key', () => {
        assert.ok(supabaseClientSrc.includes('getApplicationAuthStorageKeys'),
            'logoutUser must define and call getApplicationAuthStorageKeys');
        assert.ok(supabaseClientSrc.includes('sb-gstnghuhhrxtwjdafufd-auth-token'),
            'exact production auth storage key must be included in application storage cleanup list');
    });

    await test('5. logoutUser must guard against concurrent re-entrant execution', () => {
        assert.ok(supabaseClientSrc.includes('logoutInFlight'),
            'logoutUser must use logoutInFlight guard');
    });

    await test('6. handleSignOut must coordinate asynchronously with logoutUser', () => {
        const handleSignOutMatch = appSrc.match(/window\.handleSignOut\s*=\s*async\s+function[^{]*\{([\s\S]*?)\n\s*\};/);
        assert.ok(handleSignOutMatch, 'window.handleSignOut must be async function');
        assert.ok(handleSignOutMatch[1].includes('await window.logoutUser'),
            'handleSignOut must await window.logoutUser');
    });

    await test('7. app.html submit button must not have redundant onclick handler', () => {
        const btnMatch = appHtml.match(/<button[^>]*id="authSubmitBtn"[^>]*>/);
        assert.ok(btnMatch, '#authSubmitBtn must exist in app.html');
        assert.ok(!btnMatch[0].includes('onclick='),
            '#authSubmitBtn in app.html must not have redundant onclick attribute');
    });

    await test('8. index.html submit button must not have redundant onclick handler', () => {
        const btnMatch = indexHtml.match(/<button[^>]*id="authSubmitBtn"[^>]*>/);
        assert.ok(btnMatch, '#authSubmitBtn must exist in index.html');
        assert.ok(!btnMatch[0].includes('onclick='),
            '#authSubmitBtn in index.html must not have redundant onclick attribute');
    });

    await test('9. handleSupabaseAuthSubmit must prevent duplicate in-flight submissions', () => {
        assert.ok(appSrc.includes('authSubmitInFlight'),
            'handleSupabaseAuthSubmit must use authSubmitInFlight guard');
    });

    // -------------------------------------------------------------------------
    // RUNTIME LIFECYCLE SIMULATION (12 REQUIRED PRODUCTION CASES)
    // -------------------------------------------------------------------------
    async function createRuntimeSandbox(options = {}) {
        const storageData = {
            'sb-gstnghuhhrxtwjdafufd-auth-token': JSON.stringify({
                access_token: 'valid-test-access-token',
                refresh_token: 'valid-test-refresh-token',
                user: { id: 'user-12345', email: 'testuser@example.com' }
            }),
            'wingman_authenticated': 'true',
            'wingman_user_email': 'testuser@example.com',
            'wingman_setting_plexus': 'false',
            'wingman_setting_shorthand': 'false',
            'wingman_setting_emoji': '0',
            'wingman_setting_currency': 'USD',
            'unrelated_vendor_key': 'keep-me'
        };

        const localStorageMock = {
            getItem(key) { return storageData[key] !== undefined ? storageData[key] : null; },
            setItem(key, val) { storageData[key] = String(val); },
            removeItem(key) { delete storageData[key]; },
            get length() { return Object.keys(storageData).length; },
            key(idx) { return Object.keys(storageData)[idx] || null; }
        };

        const sessionStorageMock = {
            _data: {},
            getItem(key) { return this._data[key] !== undefined ? this._data[key] : null; },
            setItem(key, val) { this._data[key] = String(val); },
            removeItem(key) { delete this._data[key]; },
            get length() { return Object.keys(this._data).length; },
            key(idx) { return Object.keys(this._data)[idx] || null; }
        };

        let signOutCallCount = 0;
        let signOutScopes = [];
        let navigatedTo = null;
        let authStateChangeCallback = null;
        let consentResetCount = 0;
        let consentStatusCheckCount = 0;
        let creditRefreshCount = 0;
        let appStateClearCount = 0;
        let deferInitialGetSession = options.deferInitialGetSession === true;
        let pendingInitialGetSessionResolver = null;

        const fakeSupabase = {
            storageKey: 'sb-gstnghuhhrxtwjdafufd-auth-token',
            auth: {
                storageKey: 'sb-gstnghuhhrxtwjdafufd-auth-token',
                signOut: async (opts) => {
                    signOutCallCount++;
                    signOutScopes.push(opts && opts.scope);
                    // Simulate gotrue token cleanup
                    delete storageData['sb-gstnghuhhrxtwjdafufd-auth-token'];
                    return { error: null };
                },
                getSession: async () => {
                    if (deferInitialGetSession) {
                        deferInitialGetSession = false;
                        return new Promise((resolve) => { pendingInitialGetSessionResolver = resolve; });
                    }
                    const raw = storageData['sb-gstnghuhhrxtwjdafufd-auth-token'];
                    if (!raw) return { data: { session: null }, error: null };
                    return { data: { session: JSON.parse(raw) }, error: null };
                },
                signInWithPassword: async ({ email, password }) => {
                    if (password === 'wrong-password') {
                        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
                    }
                    const session = {
                        access_token: 'new-valid-token',
                        user: { id: 'user-new', email }
                    };
                    storageData['sb-gstnghuhhrxtwjdafufd-auth-token'] = JSON.stringify(session);
                    return { data: { user: session.user, session }, error: null };
                },
                onAuthStateChange: (callback) => {
                    authStateChangeCallback = callback;
                    return { data: { subscription: { unsubscribe: () => {} } } };
                }
            }
        };

        const windowMock = {
            SUPABASE_URL: 'https://gstnghuhhrxtwjdafufd.supabase.co',
            SUPABASE_ANON_KEY: 'test-anon-key',
            localStorage: localStorageMock,
            sessionStorage: sessionStorageMock,
            supabase: {
                createClient: () => fakeSupabase
            },
            currentSupabaseUser: null,
            currentSupabaseSession: null,
            supabaseClient: null,
            state: { isTermsAccepted: true, consentStatus: 'active', consentUserId: 'user-12345' },
            resetConsentSessionState: () => {
                consentResetCount += 1;
                windowMock.state.isTermsAccepted = false;
                windowMock.state.consentStatus = 'unauthenticated';
                windowMock.state.consentUserId = null;
            },
            clearAppState: () => {
                appStateClearCount++;
                windowMock.currentSupabaseUser = null;
                windowMock.currentSupabaseSession = null;
                windowMock.privateWorkspaceData = null;
            },
            loadUserCreditState: () => {
                creditRefreshCount++;
            },
            privateWorkspaceData: 'private-user-a-content',
            checkServerConsentStatus: () => {
                consentStatusCheckCount += 1;
                const userId = windowMock.currentSupabaseUser && windowMock.currentSupabaseUser.id;
                const hasActiveConsent = userId === 'user-12345';
                windowMock.state.isTermsAccepted = hasActiveConsent;
                windowMock.state.consentStatus = hasActiveConsent ? 'active' : 'consent_required';
                windowMock.state.consentUserId = userId || null;
                return Promise.resolve(hasActiveConsent);
            },
            __memoryStore: {},
            location: {
                href: 'app.html',
                assign(url) { navigatedTo = url; this.href = url; }
            },
            console: { log() {}, warn() {}, error() {} }
        };

        Object.defineProperty(windowMock.location, 'href', {
            get() { return navigatedTo || 'app.html'; },
            set(val) { navigatedTo = val; }
        });

        // Run supabaseClient.js natively
        global.window = windowMock;
        global.document = {
            readyState: 'complete',
            addEventListener() {},
            removeEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            documentElement: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} },
            body: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} }
        };
        global.localStorage = localStorageMock;
        global.sessionStorage = sessionStorageMock;

        delete require.cache[require.resolve('../supabaseClient.js')];
        require('../supabaseClient.js');

        // Allow microtasks and initSupabase to resolve
        await new Promise((resolve) => setTimeout(resolve, 20));

        return {
            window: windowMock,
            storageData,
            getSignOutCount: () => signOutCallCount,
            getSignOutScopes: () => signOutScopes,
            getConsentResetCount: () => consentResetCount,
            getConsentStatusCheckCount: () => consentStatusCheckCount,
            getCreditRefreshCount: () => creditRefreshCount,
            getAppStateClearCount: () => appStateClearCount,
            emitAuthEvent: (event, session) => {
                if (typeof authStateChangeCallback !== 'function') throw new Error('Supabase auth callback was not registered');
                return authStateChangeCallback(event, session);
            },
            resolveInitialGetSession: (session) => {
                if (!pendingInitialGetSessionResolver) throw new Error('No deferred initial getSession() request');
                pendingInitialGetSessionResolver({ data: { session }, error: null });
                pendingInitialGetSessionResolver = null;
            },
            getNavigatedTo: () => navigatedTo,
            fakeSupabase
        };
    }

    await test('12. Existing authenticated user → click Sign Out once → exactly 1 signOut execution occurs', async () => {
        const runtime = await createRuntimeSandbox();
        assert.ok(runtime.window.currentSupabaseSession, 'Session must exist before logout');
        assert.ok(runtime.storageData['sb-gstnghuhhrxtwjdafufd-auth-token'], 'Storage token must exist before logout');

        await runtime.window.logoutUser();

        assert.strictEqual(runtime.getSignOutCount(), 1, 'Exactly one signOut execution must occur');
        assert.deepStrictEqual(runtime.getSignOutScopes(), ['local'], 'Logout should use local session scope');
    });

    await test('13. Logout finishes before redirect and sets index.html destination', async () => {
        const runtime = await createRuntimeSandbox();
        await runtime.window.logoutUser();
        assert.strictEqual(runtime.getNavigatedTo(), 'index.html', 'Must navigate to index.html after logout');
    });

    await test('14. Supabase persisted session is wiped and no longer restores', async () => {
        const runtime = await createRuntimeSandbox();
        await runtime.window.logoutUser();

        assert.strictEqual(runtime.storageData['sb-gstnghuhhrxtwjdafufd-auth-token'], undefined,
            'Application Supabase token must be removed from storage');
        const sessionResp = await runtime.fakeSupabase.auth.getSession();
        assert.strictEqual(sessionResp.data.session, null, 'getSession() must return null after logout');
    });

    await test('15. Application session and global state is cleared', async () => {
        const runtime = await createRuntimeSandbox();
        await runtime.window.logoutUser();

        assert.strictEqual(runtime.window.currentSupabaseUser, null, 'currentSupabaseUser must be null');
        assert.strictEqual(runtime.window.currentSupabaseSession, null, 'currentSupabaseSession must be null');
        assert.strictEqual(runtime.storageData['wingman_authenticated'], undefined, 'wingman_authenticated must be cleared');
    });

    await test('16. Unrelated origin data is preserved during logout', async () => {
        const runtime = await createRuntimeSandbox();
        await runtime.window.logoutUser();
        assert.strictEqual(runtime.storageData['unrelated_vendor_key'], 'keep-me',
            'Unrelated keys must not be deleted');
        assert.strictEqual(runtime.storageData['wingman_setting_plexus'], 'false',
            'Legitimate UI preferences must remain persisted across logout');
        assert.strictEqual(runtime.storageData['wingman_setting_shorthand'], 'false');
        assert.strictEqual(runtime.storageData['wingman_setting_emoji'], '0');
        assert.strictEqual(runtime.storageData['wingman_setting_currency'], 'USD');
    });

    await test('17. Rapid concurrent calls to logoutUser coalesce into exactly 1 signOut execution', async () => {
        const runtime = await createRuntimeSandbox();
        const p1 = runtime.window.logoutUser();
        const p2 = runtime.window.logoutUser();
        const p3 = runtime.window.logoutUser();

        await Promise.all([p1, p2, p3]);
        assert.strictEqual(runtime.getSignOutCount(), 1,
            'Rapid re-entrant logout calls must not execute duplicate signOut network requests');
    });

    await test('18. Network failure or signOut exception still safely settles and purges local token', async () => {
        const runtime = await createRuntimeSandbox();
        runtime.fakeSupabase.auth.signOut = async () => {
            throw new Error('Network error: failed to fetch');
        };

        const result = await runtime.window.logoutUser();
        assert.strictEqual(runtime.storageData['sb-gstnghuhhrxtwjdafufd-auth-token'], undefined,
            'Storage fallback must ensure token is purged even if remote signOut throws');
        assert.strictEqual(runtime.window.currentSupabaseSession, null,
            'Session must be null even if remote signOut throws');
        assert.strictEqual(runtime.getNavigatedTo(), 'index.html',
            'Navigation must still complete even if remote signOut throws');
        assert.strictEqual(result.success, false,
            'A signOut error must be reported as unconfirmed instead of falsely returning success');
        assert.strictEqual(result.localSignedOut, true,
            'Even when Supabase signOut fails, this browser must still be cleared locally');
    });

    await test('19. Correct verified credentials produce single signInWithPassword call', async () => {
        const runtime = await createRuntimeSandbox();
        await runtime.window.logoutUser();

        let loginCalls = 0;
        const origSignIn = runtime.fakeSupabase.auth.signInWithPassword;
        runtime.fakeSupabase.auth.signInWithPassword = async (creds) => {
            loginCalls++;
            return origSignIn(creds);
        };

        const res = await runtime.window.loginUser('user@example.com', 'valid-password-123');
        assert.strictEqual(loginCalls, 1, 'Exactly one signInWithPassword call should occur');
        assert.strictEqual(res.success, true, 'Login should succeed');
    });

    await test('20. Wrong password returns controlled error without corrupting session state', async () => {
        const runtime = await createRuntimeSandbox();
        await runtime.window.logoutUser();

        const res = await runtime.window.loginUser('user@example.com', 'wrong-password');
        assert.strictEqual(res.success, false, 'Login must report failure');
        assert.strictEqual(res.error, 'Email or password is incorrect. If you originally joined with Google, continue with Google or use Forgot Password to set an email password.', 'Controlled error message returned');
        assert.strictEqual(runtime.window.currentSupabaseSession, null, 'Session must remain null');
    });

    await test('21. Repeated sign-in and token refresh preserve same-user consent; sign-out and account switch reset it', async () => {
        const runtime = await createRuntimeSandbox();
        const originalSession = runtime.window.currentSupabaseSession;
        assert.strictEqual(originalSession.user.id, 'user-12345');

        await runtime.emitAuthEvent('SIGNED_IN', { ...originalSession, access_token: 'rotated-token' });
        await runtime.emitAuthEvent('SIGNED_IN', { ...originalSession, access_token: 'another-token' });
        await runtime.emitAuthEvent('TOKEN_REFRESHED', { ...originalSession, access_token: 'refreshed-token' });
        assert.strictEqual(runtime.getConsentResetCount(), 0, 'same-user sign-in repeats and token refresh must not clear consent');
        assert.strictEqual(runtime.getConsentStatusCheckCount(), 1, 'repeated same-user sign-in and token refresh must not re-fetch consent');
        assert.strictEqual(runtime.getCreditRefreshCount(), 1, 'repeated same-user sign-in and token refresh must not re-fetch credits');
        assert.strictEqual(runtime.window.state.isTermsAccepted, true, 'same-user authentication events preserve server-confirmed consent');

        const switchedUser = { access_token: 'user-b-token', user: { id: 'user-67890', email: 'other@example.com' } };
        await runtime.emitAuthEvent('SIGNED_IN', switchedUser);
        assert.strictEqual(runtime.getConsentResetCount(), 1, 'a different user invalidates the previous local consent state');
        assert.strictEqual(runtime.getAppStateClearCount(), 1, 'a different user clears the previous account private workspace state');
        assert.strictEqual(runtime.window.privateWorkspaceData, null, 'previous account private workspace content is removed');
        assert.strictEqual(runtime.getCreditRefreshCount(), 2, 'the new account gets one authoritative credit hydration');
        assert.strictEqual(runtime.getConsentStatusCheckCount(), 2, 'the new account gets one authoritative consent check');
        assert.strictEqual(runtime.window.currentSupabaseUser.id, 'user-67890');
        assert.strictEqual(runtime.window.state.isTermsAccepted, false, 'the previous account consent is not inherited by the new account');
        assert.strictEqual(runtime.window.state.consentUserId, 'user-67890');

        await runtime.emitAuthEvent('SIGNED_OUT', null);
        assert.strictEqual(runtime.getConsentResetCount(), 2, 'genuine sign-out clears the current user consent state');
        assert.strictEqual(runtime.getAppStateClearCount(), 2, 'genuine sign-out clears the current account private workspace state');
        assert.strictEqual(runtime.window.currentSupabaseSession, null);

        await runtime.emitAuthEvent('SIGNED_IN', { ...originalSession, access_token: 'relogin-token' });
        assert.strictEqual(runtime.getConsentStatusCheckCount(), 3, 'relogin makes one authoritative consent request instead of asking for acceptance locally');
        assert.strictEqual(runtime.getCreditRefreshCount(), 3, 'relogin restores the account balance once');
        assert.strictEqual(runtime.getConsentResetCount(), 2, 'relogin from signed-out state does not perform an extra stale reset');
        assert.strictEqual(runtime.window.state.isTermsAccepted, true, 'same-user relogin restores active consent from the server status check');
    });

    await test('22. Late initial getSession response cannot overwrite a newer sign-in', async () => {
        const runtime = await createRuntimeSandbox({ deferInitialGetSession: true });
        const newerSession = { access_token: 'new-user-token', user: { id: 'user-newer', email: 'newer@example.com' } };
        const staleSession = { access_token: 'stale-user-token', user: { id: 'user-stale', email: 'stale@example.com' } };

        assert.strictEqual(runtime.window.currentSupabaseSession, null, 'deferred startup has not hydrated a session yet');
        await runtime.emitAuthEvent('SIGNED_IN', newerSession);
        runtime.resolveInitialGetSession(staleSession);
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(runtime.window.currentSupabaseUser.id, 'user-newer', 'late older getSession result must not replace the newer event');
        assert.strictEqual(runtime.window.currentSupabaseSession.access_token, 'new-user-token');
        assert.strictEqual(runtime.getCreditRefreshCount(), 1, 'only the newer authenticated account is hydrated');
        assert.strictEqual(runtime.getConsentStatusCheckCount(), 1, 'only the newer authenticated account consent is checked');
    });

    await test('23. Late startup restoration and refresh events cannot resurrect a logged-out account', async () => {
        const runtime = await createRuntimeSandbox({ deferInitialGetSession: true });
        const previousSession = { access_token: 'old-user-token', user: { id: 'user-old', email: 'old@example.com' } };
        const result = await runtime.window.logoutUser();
        assert.strictEqual(result.localSignedOut, true);

        runtime.resolveInitialGetSession(previousSession);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await runtime.emitAuthEvent('TOKEN_REFRESHED', previousSession);

        assert.strictEqual(runtime.window.currentSupabaseSession, null,
            'a late startup getSession result must not restore the session after local logout');
        assert.strictEqual(runtime.window.currentSupabaseUser, null,
            'a late token refresh event must not restore the logged-out account');
        assert.strictEqual(runtime.getCreditRefreshCount(), 0,
            'late auth callbacks after logout must not reload private account credits');
    });

    console.log('\n------------------------------------------------------------------------');
    console.log(`Results: ${passed} passed, ${failed} failed.`);
    console.log('------------------------------------------------------------------------\n');

    if (failed > 0) {
        console.log('Failing tests list:');
        failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
        process.exit(1);
    }
}

runTests();
