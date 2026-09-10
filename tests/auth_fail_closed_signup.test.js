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

async function createRuntime({ signupSession = null } = {}) {
  const signupUser = { id: 'new-user', email: 'new@example.com' };
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signUp: async () => ({ data: { user: signupUser, session: signupSession }, error: null }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  };

  const fakeClient = { auth };
  const windowMock = {
    SUPABASE_URL: 'https://gstnghuhhrxtwjdafufd.supabase.co',
    SUPABASE_ANON_KEY: 'test-key',
    supabase: { createClient: () => fakeClient },
    currentSupabaseUser: null,
    currentSupabaseSession: null,
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

  return { window: windowMock };
}

function requiresExplicitAuthenticatedTrue(source) {
  // Both forms below are strict fail-closed checks: only the literal boolean true is accepted.
  return source.includes('authResult.authenticated === true') || source.includes('authResult.authenticated !== true');
}

async function run() {
  console.log('========================================================================');
  console.log('🔒 FAIL-CLOSED EMAIL AUTH REGRESSION SUITE');
  console.log('========================================================================\n');

  await test('1. Confirmation-required signup is explicitly unauthenticated', async () => {
    const runtime = await createRuntime({ signupSession: null });
    const result = await runtime.window.signUpUser('new@example.com', 'correct-horse');
    assert.strictEqual(result.success, true, 'account creation may succeed pending confirmation');
    assert.strictEqual(result.confirmationRequired, true, 'confirmation must be required');
    assert.strictEqual(result.authenticated, false, 'pending-confirmation signup must be explicitly unauthenticated');
  });

  await test('2. Supabase client exports a fresh-session verifier for auth UI decisions', () => {
    assert.ok(/window\.getCurrentAuthenticatedSession\s*=\s*async\s+function/.test(supabaseClientSrc), 'fresh authenticated-session helper must be exported');
    assert.ok(supabaseClientSrc.includes('client.auth.getSession()'), 'helper must query the actual Supabase session');
  });

  await test('3. App auth handler blocks account switching when a real session already exists and requires explicit auth success', () => {
    assert.ok(appSrc.includes('sessionBeforeAttempt'), 'app.js must inspect the current session before an email auth attempt');
    assert.ok(appSrc.includes('Sign out first to switch accounts.'), 'app.js must instruct authenticated users to sign out before switching accounts');
    assert.ok(requiresExplicitAuthenticatedTrue(appSrc), 'app.js must require explicit authenticated=true before authenticated UI state');
    assert.ok(appSrc.includes('verifiedSession.user.id !== authResult.user.id'), 'app.js must verify the fresh session belongs to the credential result user');
  });

  await test('4. Landing auth handler blocks account switching and requires a verified Supabase session before redirect', () => {
    assert.ok(indexHtml.includes('sessionBeforeAttempt'), 'index.html must inspect the current session before an email auth attempt');
    assert.ok(indexHtml.includes('Sign out first to switch accounts.'), 'index.html must instruct authenticated users to sign out before switching accounts');
    assert.ok(requiresExplicitAuthenticatedTrue(indexHtml), 'index.html must require explicit authenticated=true before redirecting');
    assert.ok(indexHtml.includes('verifiedSession.user.id !== authResult.user.id'), 'index.html must verify the fresh session belongs to the credential result user');
  });

  await test('5. Successful password/signup auth results are explicitly marked authenticated', () => {
    const matches = supabaseClientSrc.match(/authenticated:\s*true/g) || [];
    assert.ok(matches.length >= 2, 'email signup-with-session and password login success must both set authenticated=true');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed) {
    failures.forEach(f => console.error(`❌ ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

run();
