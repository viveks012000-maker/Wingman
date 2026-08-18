from pathlib import Path

src_path = Path('supabaseClient.js')
src = src_path.read_text()

helper_anchor = """    function formatAuthError(error, fallbackMessage) {
        var code = authErrorCode(error).toLowerCase();
        var name = error && error.name ? String(error.name).toLowerCase() : '';
        var reasons = authErrorReasons(error);
        var isWeakPassword = code === 'weak_password' || name.indexOf('weakpassword') !== -1 || name.indexOf('weak_password') !== -1;

        if (isWeakPassword) {
            if (reasons.indexOf('leaked_password') !== -1 || reasons.indexOf('pwned') !== -1) {
                return 'This password has appeared in known data breaches. Choose a different password that you do not reuse elsewhere.';
            }
            return 'This password does not meet the current security requirements. Choose a stronger password and try again.';
        }

        if (error && error.message) return String(error.message);
        return fallbackMessage || 'Authentication request failed.';
    }
"""
helper_replacement = helper_anchor + """
    function normalizeWeakPasswordWarning(warning) {
        if (!warning || typeof warning !== 'object') return null;
        return {
            message: warning.message ? String(warning.message) : '',
            reasons: authErrorReasons(warning)
        };
    }

    function formatWeakPasswordWarning(warning) {
        var normalized = normalizeWeakPasswordWarning(warning);
        if (!normalized) return '';
        if (normalized.reasons.indexOf('pwned') !== -1 || normalized.reasons.indexOf('leaked_password') !== -1) {
            return 'Signed in, but this password has appeared in known data breaches. Change it now and do not reuse it elsewhere.';
        }
        return 'Signed in, but your current password no longer meets the latest security requirements. Change it to a stronger password.';
    }
"""
if src.count(helper_anchor) != 1:
    raise SystemExit('Unexpected formatAuthError anchor count')
src = src.replace(helper_anchor, helper_replacement, 1)

login_anchor = """                    safeSet('wingman_user_authenticated', 'true');
                    safeSet('wingman_user_email', resp.data.user.email || email);
                    updateAuthUIState(resp.data.user);
                    notifyUser('Signed in successfully!', 'success');
                    return { success: true, user: resp.data.user, session: resp.data.session };
"""
login_replacement = """                    safeSet('wingman_user_authenticated', 'true');
                    safeSet('wingman_user_email', resp.data.user.email || email);
                    updateAuthUIState(resp.data.user);
                    var weakPassword = normalizeWeakPasswordWarning(resp.data.weakPassword);
                    if (weakPassword) {
                        notifyUser(formatWeakPasswordWarning(weakPassword), 'warning');
                    } else {
                        notifyUser('Signed in successfully!', 'success');
                    }
                    return { success: true, user: resp.data.user, session: resp.data.session, weakPassword: weakPassword };
"""
if src.count(login_anchor) != 1:
    raise SystemExit('Unexpected successful login anchor count')
src = src.replace(login_anchor, login_replacement, 1)
src_path.write_text(src)

test_path = Path('tests/password_recovery_compat.test.js')
test = test_path.read_text()

login_test_anchor = """  const loginEnv = createEnvironment({ signInResponse: { data: { user: null, session: null }, error: weak } });
  const login = await loginEnv.window.loginUser('test@example.com', 'Password123!');
  assert.strictEqual(login.success, false);
  assert.strictEqual(login.code, 'weak_password');
  assert(login.error.includes('known data breaches'));
  assert.strictEqual(loginEnv.localStore.get('wingman_authenticated'), undefined);
  console.log('✓ weak-password sign-in response cannot falsely authenticate the UI');

"""
login_test_replacement = login_test_anchor + """  const existingUser = { id: 'existing-user', email: 'existing@example.com' };
  const existingSession = { user: existingUser, access_token: 'existing-access-token' };
  const pwnedWarning = { message: 'This password is known to be compromised.', reasons: ['pwned'] };
  const successfulWeakLoginEnv = createEnvironment({
    signInResponse: { data: { user: existingUser, session: existingSession, weakPassword: pwnedWarning }, error: null }
  });
  const successfulWeakLogin = await successfulWeakLoginEnv.window.loginUser('existing@example.com', 'Password123!');
  assert.strictEqual(successfulWeakLogin.success, true, 'Supabase successful weak-password login must remain authenticated');
  assert.strictEqual(successfulWeakLogin.user.id, 'existing-user');
  assert.strictEqual(successfulWeakLogin.session.access_token, 'existing-access-token');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(successfulWeakLogin.weakPassword)), {
    message: 'This password is known to be compromised.',
    reasons: ['pwned']
  });
  assert.strictEqual(successfulWeakLoginEnv.localStore.get('wingman_authenticated'), 'true');
  assert.strictEqual(successfulWeakLoginEnv.localStore.get('wingman_user_authenticated'), 'true');
  assert.strictEqual(successfulWeakLoginEnv.calls.toasts.length > 0, true);
  const pwnedToast = successfulWeakLoginEnv.calls.toasts[successfulWeakLoginEnv.calls.toasts.length - 1];
  assert.strictEqual(pwnedToast.type, 'warning');
  assert(pwnedToast.msg.includes('known data breaches'));
  assert(!successfulWeakLoginEnv.calls.toasts.some(t => t.type === 'success' && t.msg === 'Signed in successfully!'), 'Compromised-password login must not hide the warning behind a generic success toast');
  console.log('✓ successful pwned-password login preserves the session and surfaces the breach warning');

  const genericWeakWarning = { message: 'Password is too short.', reasons: ['length'] };
  const genericWeakLoginEnv = createEnvironment({
    signInResponse: { data: { user: existingUser, session: existingSession, weakPassword: genericWeakWarning }, error: null }
  });
  const genericWeakLogin = await genericWeakLoginEnv.window.loginUser('existing@example.com', 'Password123!');
  assert.strictEqual(genericWeakLogin.success, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(genericWeakLogin.weakPassword.reasons)), ['length']);
  const genericToast = genericWeakLoginEnv.calls.toasts[genericWeakLoginEnv.calls.toasts.length - 1];
  assert.strictEqual(genericToast.type, 'warning');
  assert(genericToast.msg.includes('latest security requirements'));
  console.log('✓ successful non-pwned weak-password login preserves auth and surfaces generic remediation');

  const normalLoginEnv = createEnvironment({
    signInResponse: { data: { user: existingUser, session: existingSession }, error: null }
  });
  const normalLogin = await normalLoginEnv.window.loginUser('existing@example.com', 'StrongPassword123!');
  assert.strictEqual(normalLogin.success, true);
  assert.strictEqual(normalLogin.weakPassword, null);
  assert(normalLoginEnv.calls.toasts.some(t => t.type === 'success' && t.msg === 'Signed in successfully!'));
  console.log('✓ ordinary successful password login keeps the existing success behavior');

"""
if test.count(login_test_anchor) != 1:
    raise SystemExit('Unexpected login test anchor count')
test = test.replace(login_test_anchor, login_test_replacement, 1)

test_path.write_text(test)
