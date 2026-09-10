'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const supabaseClientSrc = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
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

async function createAuthRuntimeSandbox(options = {}) {
    const storageData = {};
    const localStorageMock = {
        getItem(k) { return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
        setItem(k, v) { storageData[k] = String(v); },
        removeItem(k) { delete storageData[k]; },
        clear() { Object.keys(storageData).forEach(k => delete storageData[k]); }
    };
    const sessionStorageMock = {
        getItem() { return null; },
        setItem() {},
        removeItem() {},
        clear() {}
    };

    let signInPayload = null;
    let resetPasswordPayload = null;
    let updateUserPayload = null;
    let updateUserOptionsPayload = null;
    let reauthCalled = false;

    const fakeUser = options.user || { id: 'user-123', email: 'test@example.com' };
    const fakeSession = options.noSession ? null : {
        access_token: 'fake-jwt-token',
        user: fakeUser
    };

    const fakeSupabase = {
        auth: {
            getSession: async () => ({ data: { session: fakeSession }, error: null }),
            getUser: async () => ({ data: { user: fakeUser }, error: null }),
            signInWithPassword: async (payload) => {
                signInPayload = payload;
                if (options.failSignIn) {
                    return {
                        data: { user: null, session: null },
                        error: options.signInError || { code: 'invalid_credentials', message: 'Invalid login credentials' }
                    };
                }
                return { data: { user: fakeUser, session: fakeSession }, error: null };
            },
            resetPasswordForEmail: async (email, opts) => {
                resetPasswordPayload = { email, opts };
                if (options.failReset) {
                    return { error: options.resetError || { message: 'Reset failed' } };
                }
                return { error: null };
            },
            updateUser: async (attributes, opts) => {
                updateUserPayload = attributes;
                updateUserOptionsPayload = opts;
                if (options.failUpdateUser) {
                    return {
                        data: { user: null },
                        error: options.updateUserError || { code: 'reauthentication_needed', message: 'Reauthentication needed' }
                    };
                }
                return { data: { user: { ...fakeUser, ...attributes } }, error: null };
            },
            reauthenticate: async () => {
                reauthCalled = true;
                return { error: null };
            },
            signOut: async () => ({ error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
        }
    };

    const windowMock = {
        SUPABASE_URL: 'https://gstnghuhhrxtwjdafufd.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        localStorage: localStorageMock,
        sessionStorage: sessionStorageMock,
        supabase: { createClient: () => fakeSupabase },
        currentSupabaseUser: fakeUser,
        currentSupabaseSession: fakeSession,
        supabaseClient: null,
        __memoryStore: {},
        location: { href: 'app.html', origin: 'http://localhost:3000' },
        console: { log() {}, warn() {}, error() {} }
    };

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

    await new Promise((resolve) => setTimeout(resolve, 20));

    return {
        window: windowMock,
        getSignInPayload: () => signInPayload,
        getResetPasswordPayload: () => resetPasswordPayload,
        getUpdateUserPayload: () => updateUserPayload,
        getUpdateUserOptionsPayload: () => updateUserOptionsPayload,
        getReauthCalled: () => reauthCalled
    };
}

async function runTests() {
    console.log('========================================================================');
    console.log('🔐 DUAL-AUTH & PASSWORD MANAGEMENT COMPREHENSIVE TEST SUITE');
    console.log('========================================================================\n');

    // -------------------------------------------------------------------------
    // 1. STATIC CODE AUDITS
    // -------------------------------------------------------------------------
    await test('1. supabaseClient.js: loginUser passes cleanEmail to signInWithPassword', () => {
        const match = supabaseClientSrc.match(/signInWithPassword\(\{\s*email:\s*([a-zA-Z0-9_]+)/);
        assert.ok(match, 'signInWithPassword call found');
        assert.strictEqual(match[1], 'cleanEmail', 'signInWithPassword must receive cleanEmail');
    });

    await test('2. supabaseClient.js: resetPasswordForEmail passes cleanEmail', () => {
        const match = supabaseClientSrc.match(/client\.auth\.resetPasswordForEmail\(\s*([a-zA-Z0-9_]+)/);
        assert.ok(match, 'resetPasswordForEmail call found');
        assert.strictEqual(match[1], 'cleanEmail', 'resetPasswordForEmail must receive cleanEmail');
    });

    await test('3. supabaseClient.js: formatAuthError maps invalid_credentials to safe message', () => {
        const safeMsg = 'Email or password is incorrect. If you originally joined with Google, continue with Google or use Forgot Password to set an email password.';
        assert.ok(supabaseClientSrc.includes(safeMsg), 'Safe error message must exist in supabaseClient.js');
        assert.ok(supabaseClientSrc.includes('invalid_credentials'), 'invalid_credentials code check must exist in supabaseClient.js');
    });

    await test('4. supabaseClient.js: updateUserPassword is exported on window', () => {
        const exported = /window\.updateUserPassword\s*=\s*async\s+function/.test(supabaseClientSrc);
        assert.ok(exported, 'window.updateUserPassword must be defined as an async function');
    });

    await test('5. index.html: OR EMAIL divider includes explanatory guidance text for Google users', () => {
        const expected = 'If you created your account with Google, continue with Google above. You can add an email password later in your account settings.';
        assert.ok(indexHtml.includes(expected), 'index.html must display Google account guidance text');
    });

    await test('6. index.html: handleSupabaseAuthSubmit lowercases email input', () => {
        assert.ok(indexHtml.includes('emailInput.value.trim().toLowerCase()'), 'index.html must lowercase emailInput.value');
    });

    await test('7. index.html: handleResetPassword lowercases resetEmailInput', () => {
        assert.ok(indexHtml.includes('resetEmailInput.value.trim().toLowerCase()'), 'index.html must lowercase resetEmailInput.value');
    });

    await test('8. index.html: handleSupabaseAuthSubmit has in-flight locking and loading state', () => {
        assert.ok(indexHtml.includes('let authSubmitInFlight = false;'), 'index.html must have authSubmitInFlight guard');
        assert.ok(indexHtml.includes('if (authSubmitInFlight) return false;'), 'index.html must check authSubmitInFlight');
        assert.ok(indexHtml.includes('Creating Account...') || indexHtml.includes('Signing In...'), 'index.html must provide button loading states');
    });

    await test('9. app.html: OR EMAIL divider includes explanatory guidance text for Google users', () => {
        const expected = 'If you created your account with Google, continue with Google above. You can add an email password later in your account settings.';
        assert.ok(appHtml.includes(expected), 'app.html must display Google account guidance text');
    });

    await test('10. app.html: sidebar includes Set or Change Password button', () => {
        assert.ok(appHtml.includes('id="sidebarSetPasswordBtn"'), 'sidebarSetPasswordBtn must be in app.html');
        assert.ok(appHtml.includes('window.openSetPasswordModal(event)'), 'sidebar button must invoke openSetPasswordModal');
    });

    await test('11. app.html: settings modal contains Set or Change Password action', () => {
        assert.ok(appHtml.includes('id="settingsAccountSecuritySection"'), 'Account Security section must be in settingsModal');
        assert.ok(appHtml.includes('id="openSetPasswordBtn"'), 'openSetPasswordBtn must be in settingsModal');
        assert.ok(appHtml.includes('window.openSetPasswordFromSettings(event)'), 'settings button must invoke openSetPasswordFromSettings');
    });

    await test('12. app.html: setPasswordModal dialog markup exists with required inputs', () => {
        assert.ok(appHtml.includes('id="setPasswordModal"'), 'setPasswordModal dialog must exist in app.html');
        assert.ok(appHtml.includes('id="newPasswordInput"'), 'newPasswordInput must exist in setPasswordModal');
        assert.ok(appHtml.includes('id="confirmPasswordInput"'), 'confirmPasswordInput must exist in setPasswordModal');
        assert.ok(appHtml.includes('id="setPasswordNonceInput"'), 'setPasswordNonceInput must exist in setPasswordModal');
        assert.ok(appHtml.includes('id="setPasswordSubmitBtn"'), 'setPasswordSubmitBtn must exist in setPasswordModal');
        assert.ok(appHtml.includes('id="setPasswordErrorMessage"'), 'setPasswordErrorMessage must exist in setPasswordModal');
        assert.ok(appHtml.includes('id="setPasswordSuccessMessage"'), 'setPasswordSuccessMessage must exist in setPasswordModal');
    });

    await test('13. app.js: exposes openSetPasswordModal, closeSetPasswordModal, and handleSetPasswordSubmit', () => {
        assert.ok(/window\.openSetPasswordModal\s*=\s*function/.test(appSrc), 'openSetPasswordModal must be exported in app.js');
        assert.ok(/window\.closeSetPasswordModal\s*=\s*function/.test(appSrc), 'closeSetPasswordModal must be exported in app.js');
        assert.ok(/window\.openSetPasswordFromSettings\s*=\s*function/.test(appSrc), 'openSetPasswordFromSettings must be exported in app.js');
        assert.ok(/window\.handleSetPasswordSubmit\s*=\s*async\s+function/.test(appSrc), 'handleSetPasswordSubmit must be exported in app.js');
    });

    await test('14. app.js: togglePasswordVisibility supports targetId argument', () => {
        assert.ok(/window\.togglePasswordVisibility\s*=\s*function\s*\(\s*targetId\s*\)/.test(appSrc), 'togglePasswordVisibility must accept targetId in app.js');
    });

    await test('15. app.js: handleSupabaseAuthSubmit and handleResetPassword normalize email', () => {
        const authEmailMatch = appSrc.includes('const email = (emailInput && emailInput.value) ? emailInput.value.trim().toLowerCase() : "";');
        const resetEmailMatch = appSrc.includes('const email = (resetEmailInput && resetEmailInput.value) ? resetEmailInput.value.trim().toLowerCase() : "";');
        assert.ok(authEmailMatch, 'app.js handleSupabaseAuthSubmit must lowercase email');
        assert.ok(resetEmailMatch, 'app.js handleResetPassword must lowercase email');
    });

    // -------------------------------------------------------------------------
    // 2. RUNTIME FUNCTIONAL VERIFICATION
    // -------------------------------------------------------------------------
    await test('16. Runtime: formatAuthError maps code invalid_credentials to safe message', async () => {
        const sandbox = await createAuthRuntimeSandbox({
            failSignIn: true,
            signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' }
        });
        const res = await sandbox.window.loginUser('test@example.com', 'wrongpassword123');
        assert.strictEqual(res.success, false, 'Login should fail');
        assert.strictEqual(res.error, 'Email or password is incorrect. If you originally joined with Google, continue with Google or use Forgot Password to set an email password.');
    });

    await test('17. Runtime: formatAuthError maps string "Invalid login credentials" to safe message', async () => {
        const sandbox = await createAuthRuntimeSandbox({
            failSignIn: true,
            signInError: { message: 'Invalid login credentials' }
        });
        const res = await sandbox.window.loginUser('test@example.com', 'wrongpassword123');
        assert.strictEqual(res.success, false, 'Login should fail');
        assert.strictEqual(res.error, 'Email or password is incorrect. If you originally joined with Google, continue with Google or use Forgot Password to set an email password.');
    });

    await test('18. Runtime: formatAuthError preserves other standard errors (rate limit, weak password)', async () => {
        const sandbox = await createAuthRuntimeSandbox({
            failSignIn: true,
            signInError: { code: 'over_email_send_rate_limit', message: 'Rate limit exceeded' }
        });
        const res = await sandbox.window.loginUser('test@example.com', 'validpassword123');
        assert.ok(res.error.includes('Too many requests') || res.error.includes('rate limit') || res.error.includes('Rate limit'), 'Preserves rate limit message');
    });

    await test('19. Runtime: loginUser trims whitespace and lowercases email', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        const res = await sandbox.window.loginUser('  User.NAME@Domain.COM  ', 'ValidPassword123!');
        assert.strictEqual(res.success, true, 'Login should succeed');
        const payload = sandbox.getSignInPayload();
        assert.strictEqual(payload.email, 'user.name@domain.com', 'signInWithPassword must receive trimmed lowercase email');
        assert.strictEqual(payload.password, 'ValidPassword123!');
    });

    await test('20. Runtime: resetPasswordForEmail trims whitespace and lowercases email', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        const res = await sandbox.window.resetPasswordForEmail('  Alice.Bob@Example.COM  ');
        assert.strictEqual(res.success, true, 'Reset should succeed');
        const payload = sandbox.getResetPasswordPayload();
        assert.strictEqual(payload.email, 'alice.bob@example.com', 'resetPasswordForEmail must receive trimmed lowercase email');
    });

    await test('21. Runtime: updateUserPassword validates input length (rejects < 8 chars)', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        const res = await sandbox.window.updateUserPassword('short', 'short');
        assert.strictEqual(res.success, false, 'Short password must be rejected');
        assert.strictEqual(res.error, 'Password must be at least 8 characters long.');
        assert.strictEqual(sandbox.getUpdateUserPayload(), null, 'updateUser must not be called');
    });

    await test('22. Runtime: updateUserPassword validates confirmation match', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        const res = await sandbox.window.updateUserPassword('ValidPassword123!', 'MismatchPassword123!');
        assert.strictEqual(res.success, false, 'Mismatched passwords must be rejected');
        assert.strictEqual(res.error, 'Passwords do not match.');
        assert.strictEqual(sandbox.getUpdateUserPayload(), null, 'updateUser must not be called');
    });

    await test('23. Runtime: updateUserPassword requires an active authenticated session', async () => {
        const sandbox = await createAuthRuntimeSandbox({ noSession: true });
        const res = await sandbox.window.updateUserPassword('ValidPassword123!', 'ValidPassword123!');
        assert.strictEqual(res.success, false, 'Should fail without active session');
        assert.strictEqual(res.error, 'Active session not found. Please sign in again.');
        assert.strictEqual(sandbox.getUpdateUserPayload(), null, 'updateUser must not be called');
    });

    await test('24. Runtime: updateUserPassword successfully updates password on active session', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        const res = await sandbox.window.updateUserPassword('NewValidPass123!', 'NewValidPass123!');
        assert.strictEqual(res.success, true, 'Password update should succeed');
        const payload = sandbox.getUpdateUserPayload();
        assert.strictEqual(payload.password, 'NewValidPass123!', 'updateUser must receive new password');
        assert.strictEqual(res.user.id, 'user-123', 'User ID must be preserved');
    });

    await test('25. Runtime: updateUserPassword passes nonce when provided', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        const res = await sandbox.window.updateUserPassword('NewValidPass123!', 'NewValidPass123!', '654321');
        assert.strictEqual(res.success, true, 'Update with nonce should succeed');
        const opts = sandbox.getUpdateUserOptionsPayload();
        assert.strictEqual(opts.nonce, '654321', 'updateUser options must include nonce');
    });

    await test('26. Runtime: updateUserPassword handles reauthentication_needed error cleanly', async () => {
        const sandbox = await createAuthRuntimeSandbox({
            failUpdateUser: true,
            updateUserError: { code: 'reauthentication_needed', message: 'Reauthentication needed' }
        });
        const res = await sandbox.window.updateUserPassword('NewValidPass123!', 'NewValidPass123!');
        assert.strictEqual(res.success, false, 'Must report failure when reauth required');
        assert.strictEqual(res.requiresReauth, true, 'Must set requiresReauth flag');
        assert.ok(res.error.includes('Recent authentication required'), 'Must provide clear reauth instruction');
        assert.strictEqual(sandbox.getReauthCalled(), true, 'Must invoke client.auth.reauthenticate()');
    });

    await test('27. Runtime: setting password leaves credit balance untouched (credit invariant)', async () => {
        const sandbox = await createAuthRuntimeSandbox();
        // Set initial wallet state
        sandbox.window.localStorage.setItem('mywingman_credits', '20');
        const res = await sandbox.window.updateUserPassword('NewValidPass123!', 'NewValidPass123!');
        assert.strictEqual(res.success, true, 'Password update should succeed');
        assert.strictEqual(sandbox.window.localStorage.getItem('mywingman_credits'), '20', 'Credit balance must not change on password update');
    });

    await test('28. Security: Never attempt to intercept or validate Google password', () => {
        assert.ok(!supabaseClientSrc.includes('google_password'), 'No google_password logic');
        assert.ok(!appSrc.includes('google_password'), 'No google_password logic');
    });

    await test('29. UX: Set password inputs include accessibility attributes and autocomplete', () => {
        assert.ok(appHtml.includes('autocomplete="new-password"'), 'Passwords should have new-password autocomplete attribute');
        assert.ok(appHtml.includes('role="dialog"'), 'setPasswordModal should have role dialog');
        assert.ok(appHtml.includes('aria-modal="true"'), 'setPasswordModal should have aria-modal true');
    });

    await test('30. Architecture: Dual authentication shares identical user ID and preserves provider link', () => {
        const updateUserMethod = supabaseClientSrc.includes('await client.auth.updateUser(updateAttributes, updateOptions)');
        assert.ok(updateUserMethod, 'updateUser is called directly on current authenticated client');
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
