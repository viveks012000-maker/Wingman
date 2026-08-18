/**
 * Password recovery completion + strengthened-password compatibility guard.
 * Executes the real supabaseClient.js handlers against an isolated Supabase/DOM runtime.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../supabaseClient.js'), 'utf8');
assert(source.includes("event === 'PASSWORD_RECOVERY'"), 'Supabase PASSWORD_RECOVERY must be handled explicitly');
assert(source.includes('client.auth.updateUser({ password: password })'), 'Recovery must finish with auth.updateUser({password})');
assert(source.includes("code === 'weak_password'"), 'Weak-password handling must branch on structured Auth code');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...v) { v.forEach(x => this.values.add(x)); }
  remove(...v) { v.forEach(x => this.values.delete(x)); }
  contains(v) { return this.values.has(v); }
}

function createEnvironment(options = {}) {
  const elements = new Map();
  const listeners = new Map();
  const localStore = new Map();
  const sessionStore = new Map();
  const calls = { signUp: [], signIn: [], reset: [], update: [], toasts: [], history: [] };
  let authCallback = null;
  let updateError = options.updateError || null;
  let session = options.session === undefined ? null : options.session;

  class Element {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.classList = new ClassList();
      this.style = { cssText: '', overflow: '', display: '' };
      this.attributes = {};
      this.textContent = '';
      this.value = '';
      this.disabled = false;
      this.className = '';
      this._id = '';
      this._listeners = new Map();
    }
    set id(value) { this._id = String(value || ''); if (this._id) elements.set(this._id, this); }
    get id() { return this._id; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(x => x !== child); child.parentNode = null; if (child.id) elements.delete(child.id); return child; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); else if (this.id) elements.delete(this.id); }
    addEventListener(type, fn) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(fn); }
    focus() {}
  }

  const body = new Element('body');
  const document = {
    body,
    title: 'MyWingman',
    readyState: 'loading',
    createElement: tag => new Element(tag),
    createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
    getElementById: id => elements.get(id) || null,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }
  };

  function makeStorage(store) {
    return {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      clear: () => store.clear()
    };
  }
  const localStorage = makeStorage(localStore);
  const sessionStorage = makeStorage(sessionStore);

  const client = {
    auth: {
      onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session }, error: null }),
      signUp: async payload => { calls.signUp.push(payload); return options.signUpResponse || { data: { user: null, session: null }, error: null }; },
      signInWithPassword: async payload => { calls.signIn.push(payload); return options.signInResponse || { data: { user: null, session: null }, error: null }; },
      signInWithOAuth: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async (email, cfg) => { calls.reset.push({ email, cfg }); return { data: {}, error: null }; },
      updateUser: async payload => { calls.update.push(payload); return updateError ? { data: null, error: updateError } : { data: { user: session && session.user ? session.user : { id: 'recovered-user' } }, error: null }; },
      signOut: async () => ({ error: null })
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })
  };

  const location = {
    origin: 'https://mywingman.pages.dev',
    protocol: 'https:',
    hostname: 'mywingman.pages.dev',
    pathname: '/app.html',
    search: options.search || '',
    hash: options.hash || ''
  };
  const history = {
    replaceState(state, title, url) {
      calls.history.push(url);
      const q = String(url).indexOf('?');
      location.pathname = q === -1 ? String(url) : String(url).slice(0, q);
      location.search = q === -1 ? '' : String(url).slice(q);
      location.hash = '';
    }
  };

  const window = {
    location,
    history,
    supabase: { createClient: () => client },
    showToast: (msg, type) => calls.toasts.push({ msg, type }),
    __memoryStore: {}
  };
  window.window = window;
  window.document = document;
  window.localStorage = localStorage;
  window.sessionStorage = sessionStorage;

  const sandbox = {
    window,
    document,
    localStorage,
    sessionStorage,
    URLSearchParams,
    console,
    setTimeout: fn => { fn(); return 1; },
    clearTimeout: () => {},
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Error,
    Math,
    JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  return {
    window,
    document,
    calls,
    localStore,
    sessionStore,
    client,
    setUpdateError(value) { updateError = value; },
    setSession(value) { session = value; },
    getAuthCallback() { return authCallback; }
  };
}

(async () => {
  console.log('Running password recovery compatibility tests...');

  const weak = { code: 'weak_password', name: 'AuthWeakPasswordError', message: 'Password is weak', reasons: ['leaked_password'] };
  const signupEnv = createEnvironment({ signUpResponse: { data: { user: null, session: null }, error: weak } });
  const signup = await signupEnv.window.signUpUser('test@example.com', 'Password123!');
  assert.strictEqual(signup.success, false);
  assert.strictEqual(signup.code, 'weak_password');
  assert(signup.error.includes('known data breaches'));
  assert.strictEqual(signupEnv.localStore.get('wingman_authenticated'), undefined);
  console.log('✓ weak/leaked signup is rejected using structured Auth error data');

  const loginEnv = createEnvironment({ signInResponse: { data: { user: null, session: null }, error: weak } });
  const login = await loginEnv.window.loginUser('test@example.com', 'Password123!');
  assert.strictEqual(login.success, false);
  assert.strictEqual(login.code, 'weak_password');
  assert(login.error.includes('known data breaches'));
  assert.strictEqual(loginEnv.localStore.get('wingman_authenticated'), undefined);
  console.log('✓ weak-password sign-in response cannot falsely authenticate the UI');

  const existingUser = { id: 'existing-user', email: 'existing@example.com' };
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

  const resetEnv = createEnvironment();
  const reset = await resetEnv.window.resetPasswordForEmail('test@example.com');
  assert.strictEqual(reset.success, true);
  assert.strictEqual(resetEnv.calls.reset.length, 1);
  assert.strictEqual(resetEnv.calls.reset[0].cfg.redirectTo, 'https://mywingman.pages.dev/app.html?type=recovery');
  console.log('✓ reset email keeps the exact Cloudflare recovery redirect');

  const recoverySession = { user: { id: 'recovered-user', email: 'test@example.com' }, access_token: 'recovery-access-token' };
  const recoveryEnv = createEnvironment({ session: recoverySession });
  await recoveryEnv.window.resetPasswordForEmail('test@example.com');
  const cb = recoveryEnv.getAuthCallback();
  assert.strictEqual(typeof cb, 'function');
  cb('PASSWORD_RECOVERY', recoverySession);
  assert(recoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), 'Recovery event must render the locked completion dialog');
  assert.strictEqual(recoveryEnv.sessionStore.get('wingman_password_recovery_active'), 'true');
  assert.strictEqual(recoveryEnv.localStore.has('wingman_password_recovery_active'), false, 'Recovery state must never persist in localStorage');

  const mismatch = await recoveryEnv.window.completePasswordRecovery('StrongPassword123!', 'DifferentPassword123!');
  assert.strictEqual(mismatch.success, false);
  assert.strictEqual(mismatch.error, 'Passwords do not match.');
  assert.strictEqual(recoveryEnv.calls.update.length, 0, 'Mismatch must never call updateUser');
  console.log('✓ confirmation mismatch is rejected before any password mutation');

  recoveryEnv.setUpdateError(weak);
  const weakUpdate = await recoveryEnv.window.completePasswordRecovery('StrongPassword123!', 'StrongPassword123!');
  assert.strictEqual(weakUpdate.success, false);
  assert.strictEqual(weakUpdate.code, 'weak_password');
  assert(weakUpdate.error.includes('known data breaches'));
  assert(recoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), 'Weak password error must keep recovery dialog active');
  assert.strictEqual(recoveryEnv.sessionStore.get('wingman_password_recovery_active'), 'true');
  console.log('✓ leaked-password rejection keeps recovery completion safely active');

  recoveryEnv.setUpdateError(null);
  const success = await recoveryEnv.window.completePasswordRecovery('UniqueStrongPassword123!', 'UniqueStrongPassword123!');
  assert.strictEqual(success.success, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(recoveryEnv.calls.update[1])), { password: 'UniqueStrongPassword123!' });
  assert.strictEqual(recoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), null);
  assert.strictEqual(recoveryEnv.sessionStore.has('wingman_password_recovery_active'), false);
  assert.strictEqual(recoveryEnv.calls.history[recoveryEnv.calls.history.length - 1], '/app.html');
  console.log('✓ verified recovery session updates password and cleans recovery state');

  const ordinaryEnv = createEnvironment({ session: recoverySession });
  await ordinaryEnv.window.resetPasswordForEmail('test@example.com');
  ordinaryEnv.getAuthCallback()('SIGNED_IN', recoverySession);
  assert.strictEqual(ordinaryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), null, 'Ordinary sign-in must never open recovery UI');
  console.log('✓ ordinary authenticated sessions are unchanged');

  const signedOutRecoveryEnv = createEnvironment({ session: recoverySession });
  await signedOutRecoveryEnv.window.resetPasswordForEmail('test@example.com');
  signedOutRecoveryEnv.getAuthCallback()('PASSWORD_RECOVERY', recoverySession);
  assert(signedOutRecoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'));
  signedOutRecoveryEnv.getAuthCallback()('SIGNED_OUT', null);
  assert.strictEqual(signedOutRecoveryEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), null, 'Signed-out recovery session must release the blocking dialog');
  assert.strictEqual(signedOutRecoveryEnv.sessionStore.has('wingman_password_recovery_active'), false, 'Signed out must clear recovery session state');
  console.log('✓ signed-out/expired recovery sessions clear the ephemeral recovery lock');

  const fallbackEnv = createEnvironment({ session: recoverySession, search: '?type=recovery' });
  await fallbackEnv.window.resetPasswordForEmail('test@example.com');
  assert(fallbackEnv.document.getElementById('wingmanPasswordRecoveryOverlay'), 'Hydrated recovery URL + real session must restore completion UI');
  console.log('✓ recovery URL/session hydration survives callback timing differences');

  console.log('PASSWORD RECOVERY COMPATIBILITY: ALL TESTS PASSED');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
