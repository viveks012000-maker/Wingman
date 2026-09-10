'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    async function createRuntimeSandbox() {
        const storageData = {
            'sb-gstnghuhhrxtwjdafufd-auth-token': JSON.stringify({
                access_token: 'valid-test-access-token',
                refresh_token: 'valid-test-refresh-token',
                user: { id: 'user-12345', email: 'testuser@example.com' }
            }),
            'wingman_authenticated': 'true',
            'wingman_user_email': 'testuser@example.com',
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
                onAuthStateChange: () => {
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

        // Run supabaseClient.js in VM sandbox
        const context = vm.createContext({
            window: windowMock,
            document: {
                readyState: 'complete',
                addEventListener() {},
                removeEventListener() {},
                getElementById() { return null; },
                querySelector() { return null; },
                querySelectorAll() { return []; },
                documentElement: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} },
                body: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} }
            },
            localStorage: localStorageMock,
            sessionStorage: sessionStorageMock,
            setTimeout,
            clearTimeout,
            Promise,
            Set,
            URL,
            Array,
            console: windowMock.console
        });

        vm.runInContext(supabaseClientSrc, context);

        // Allow microtasks and initSupabase to resolve
        await new Promise((resolve) => setTimeout(resolve, 20));

        return {
            window: windowMock,
            storageData,
            getSignOutCount: () => signOutCallCount,
            getSignOutScopes: () => signOutScopes,
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

        await runtime.window.logoutUser();
        assert.strictEqual(runtime.storageData['sb-gstnghuhhrxtwjdafufd-auth-token'], undefined,
            'Storage fallback must ensure token is purged even if remote signOut throws');
        assert.strictEqual(runtime.window.currentSupabaseSession, null,
            'Session must be null even if remote signOut throws');
        assert.strictEqual(runtime.getNavigatedTo(), 'index.html',
            'Navigation must still complete even if remote signOut throws');
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
        assert.strictEqual(res.error, 'Invalid login credentials', 'Controlled error message returned');
        assert.strictEqual(runtime.window.currentSupabaseSession, null, 'Session must remain null');
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
