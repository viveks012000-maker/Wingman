from pathlib import Path

src_path = Path('supabaseClient.js')
src = src_path.read_text()

old_init = "    var passwordRecoveryActive = safeGet('wingman_password_recovery_active') === 'true';\n    var recoveryBodyOverflow = null;\n"
new_init = """    var passwordRecoveryActive = false;
    try {
        passwordRecoveryActive = !!(window.sessionStorage && sessionStorage.getItem('wingman_password_recovery_active') === 'true');
    } catch (e) {
        passwordRecoveryActive = !!(window.__memoryStore && window.__memoryStore.wingman_password_recovery_active === 'true');
    }
    var recoveryBodyOverflow = null;
"""
if src.count(old_init) != 1:
    raise SystemExit('Unexpected recovery-state initialization anchor count')
src = src.replace(old_init, new_init, 1)

old_setter = """    function setPasswordRecoveryActive(active) {
        passwordRecoveryActive = active === true;
        if (passwordRecoveryActive) safeSet('wingman_password_recovery_active', 'true');
        else safeRemove('wingman_password_recovery_active');
    }
"""
new_setter = """    function setPasswordRecoveryActive(active) {
        passwordRecoveryActive = active === true;
        try {
            if (window.sessionStorage) {
                if (passwordRecoveryActive) sessionStorage.setItem('wingman_password_recovery_active', 'true');
                else sessionStorage.removeItem('wingman_password_recovery_active');
            }
        } catch (e) {}
        if (window.__memoryStore) {
            if (passwordRecoveryActive) window.__memoryStore.wingman_password_recovery_active = 'true';
            else delete window.__memoryStore.wingman_password_recovery_active;
        }
    }
"""
if src.count(old_setter) != 1:
    raise SystemExit('Unexpected recovery-state setter anchor count')
src = src.replace(old_setter, new_setter, 1)

old_signed_out = """                    } else if (event === 'SIGNED_OUT') {
                        safeRemove('wingman_authenticated');
                        safeRemove('wingman_user_authenticated');
                        safeRemove('wingman_user_email');
                        updateAuthUIState(null);
                    }
"""
new_signed_out = """                    } else if (event === 'SIGNED_OUT') {
                        safeRemove('wingman_authenticated');
                        safeRemove('wingman_user_authenticated');
                        safeRemove('wingman_user_email');
                        if (passwordRecoveryActive) {
                            setPasswordRecoveryActive(false);
                            removePasswordRecoveryDialog();
                        }
                        updateAuthUIState(null);
                    }
"""
if src.count(old_signed_out) != 1:
    raise SystemExit('Unexpected SIGNED_OUT anchor count')
src = src.replace(old_signed_out, new_signed_out, 1)
src_path.write_text(src)

test_path = Path('tests/password_recovery_compat.test.js')
test = test_path.read_text()

old_storage = """  const storage = new Map();
  const calls = { signUp: [], signIn: [], reset: [], update: [], toasts: [], history: [] };
"""
new_storage = """  const localStore = new Map();
  const sessionStore = new Map();
  const calls = { signUp: [], signIn: [], reset: [], update: [], toasts: [], history: [] };
"""
if test.count(old_storage) != 1:
    raise SystemExit('Unexpected test storage declaration anchor count')
test = test.replace(old_storage, new_storage, 1)

old_local = """  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear()
  };
"""
new_local = """  function makeStorage(store) {
    return {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      clear: () => store.clear()
    };
  }
  const localStorage = makeStorage(localStore);
  const sessionStorage = makeStorage(sessionStore);
"""
if test.count(old_local) != 1:
    raise SystemExit('Unexpected test localStorage anchor count')
test = test.replace(old_local, new_local, 1)

test = test.replace("  window.sessionStorage = localStorage;\n", "  window.sessionStorage = sessionStorage;\n", 1)
test = test.replace("    sessionStorage: localStorage,\n", "    sessionStorage,\n", 1)

old_return = """    calls,
    storage,
    client,
"""
new_return = """    calls,
    localStore,
    sessionStore,
    client,
"""
if test.count(old_return) != 1:
    raise SystemExit('Unexpected test return storage anchor count')
test = test.replace(old_return, new_return, 1)

test = test.replace("signupEnv.storage.get('wingman_authenticated')", "signupEnv.localStore.get('wingman_authenticated')")
test = test.replace("loginEnv.storage.get('wingman_authenticated')", "loginEnv.localStore.get('wingman_authenticated')")
test = test.replace("recoveryEnv.storage.get('wingman_password_recovery_active')", "recoveryEnv.sessionStore.get('wingman_password_recovery_active')")
test = test.replace("recoveryEnv.storage.has('wingman_password_recovery_active')", "recoveryEnv.sessionStore.has('wingman_password_recovery_active')")

recovery_assert = """  assert(recoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), 'Recovery event must render the locked completion dialog');
  assert.strictEqual(recoveryEnv.sessionStore.get('wingman_password_recovery_active'), 'true');
"""
recovery_assert_new = recovery_assert + "  assert.strictEqual(recoveryEnv.localStore.has('wingman_password_recovery_active'), false, 'Recovery state must never persist in localStorage');\n"
if test.count(recovery_assert) != 1:
    raise SystemExit('Unexpected recovery-state assertion anchor count')
test = test.replace(recovery_assert, recovery_assert_new, 1)

ordinary_anchor = """  const ordinaryEnv = createEnvironment({ session: recoverySession });
  await ordinaryEnv.window.resetPasswordForEmail('test@example.com');
  ordinaryEnv.getAuthCallback()('SIGNED_IN', recoverySession);
  assert.strictEqual(ordinaryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), null, 'Ordinary sign-in must never open recovery UI');
  console.log('✓ ordinary authenticated sessions are unchanged');

"""
signed_out_test = ordinary_anchor + """  const signedOutRecoveryEnv = createEnvironment({ session: recoverySession });
  await signedOutRecoveryEnv.window.resetPasswordForEmail('test@example.com');
  signedOutRecoveryEnv.getAuthCallback()('PASSWORD_RECOVERY', recoverySession);
  assert(signedOutRecoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'));
  signedOutRecoveryEnv.getAuthCallback()('SIGNED_OUT', null);
  assert.strictEqual(signedOutRecoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), null, 'Signed-out recovery session must release the blocking dialog');
  assert.strictEqual(signedOutRecoveryEnv.sessionStore.has('wingman_password_recovery_active'), false, 'Signed out must clear recovery session state');
  console.log('✓ signed-out/expired recovery sessions clear the ephemeral recovery lock');

"""
if test.count(ordinary_anchor) != 1:
    raise SystemExit('Unexpected ordinary-session test anchor count')
test = test.replace(ordinary_anchor, signed_out_test, 1)

test_path.write_text(test)
