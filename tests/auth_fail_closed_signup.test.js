'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const supabaseClientSrc = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`❌ FAIL: ${name} — ${err.message}`);
  }
}

async function createRuntime({ existingSession = null, signupSession = null } = {}) {
  let signUpCalls = 0;
  let signInCalls = 0;

  const fakeUser = { id: 'existing-user', email: 'existing@example.com' };
  const signupUser = { id: 'new-user', email: 'new@example.com' };

  const auth = {
    getSession: async () => ({ data: { session: existingSession }, error: null }),
    signUp: async () => {
      signUpCalls++;
      return { data: { user: signupUser, session: signupSession }, error: null };
    },
    signInWithPassword: async () => {
      signInCalls++;
      return { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
    },
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  };

  const fakeClient = { auth };
  const windowMock = {
    SUPABASE_URL: 'https://gstnghuhhrxtwjdafufd.supabase.co',
    SUPABASE_ANON_KEY: 'test-key',
    supabase: { createClient: () => fakeClient },
    currentSupabaseUser: existingSession ? fakeUser : null,
    currentSupabaseSession: existingSession,
    supabaseClient: null,
    __memoryStore: {},
    location: { href: 'https://mywingmanapp.com/', origin: 'https://mywingmanapp.com', pathname: '/', hash: '', search: '' },
    history: { replaceState() {} },
    console: { log() {}, warn() {}, error() {} },
    addEventListener() {}
  };

  global.window = windowMock;
  global.document = {
    readyState: 'complete',
    title: 'MyWingman',
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    documentElement: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} },
    body: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} }
  };
  global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} };
  global.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} };

  delete require.cache[require.resolve('../supabaseClient.js')];
  require('../supabaseClient.js');
  await new Promise(resolve => setTimeout(resolve, 20));

  return {
    window: windowMock,
    getSignUpCalls: () => signUpCalls,
    getSignInCalls: () => signInCalls
  };
}

async function run() {
  console.log('========================================================================');
  console.log('🔒 FAIL-CLOSED EMAIL AUTH REGRESSION SUITE');
  console.log('========================================================================\n');

  await test('1. Confirmation-required signup is explicitly unauthenticated', async () => {
    const runtime = await createRuntime({ existingSession: null, signupSession: null });
    const result = await runtime.window.signUpUser('new@example.com', 'correct-horse');
    assert.strictEqual(result.success, true, 'account creation may succeed pending confirmation');
    assert.strictEqual(result.confirmationRequired, true, 'confirmation must be required');
    assert.strictEqual(result.authenticated, false, 'pending-confirmation signup must be explicitly unauthenticated');
  });

  await test('2. Existing authenticated session blocks signup/account switching until sign-out', async () => {
    const existingSession = { access_token: 'existing-token-123456', user: { id: 'existing-user', email: 'existing@example.com' } };
    const runtime = await createRuntime({ existingSession });
    const result = await runtime.window.signUpUser('random@gmail.com', 'random-pass');
    assert.strictEqual(runtime.getSignUpCalls(), 0, 'signUp must not run while another session is active');
    assert.strictEqual(result.success, false, 'account-switch attempt must fail closed');
    assert.strictEqual(result.alreadyAuthenticated, true, 'caller must know sign-out is required to switch accounts');
  });

  await test('3. Existing authenticated session blocks password login/account switching until sign-out', async () => {
    const existingSession = { access_token: 'existing-token-123456', user: { id: 'existing-user', email: 'existing@example.com' } };
    const runtime = await createRuntime({ existingSession });
    const result = await runtime.window.loginUser('random@gmail.com', 'random-pass');
    assert.strictEqual(runtime.getSignInCalls(), 0, 'signInWithPassword must not run while another session is active');
    assert.strictEqual(result.success, false, 'account-switch attempt must fail closed');
    assert.strictEqual(result.alreadyAuthenticated, true, 'caller must know sign-out is required to switch accounts');
  });

  await test('4. App auth handler requires authenticated=true before setting authenticated UI state', () => {
    assert.ok(appSrc.includes('authResult.authenticated === true'), 'app.js must require explicit authenticated=true before authenticated UI state');
  });

  await test('5. Landing auth handler requires authenticated=true before redirecting to app', () => {
    assert.ok(indexHtml.includes('authResult.authenticated === true'), 'index.html must require explicit authenticated=true before redirecting');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed) {
    failures.forEach(f => console.error(`❌ ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

run();
