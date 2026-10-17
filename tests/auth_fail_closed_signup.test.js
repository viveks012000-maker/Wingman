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

async function createRuntime() {
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
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

  await test('1. Email/password account creation is unavailable in the Google-only beta', async () => {
    const runtime = await createRuntime();
    assert.strictEqual(typeof runtime.window.signUpUser, 'undefined', 'email/password signup must not be callable from the client');
    assert.doesNotMatch(supabaseClientSrc, /client\.auth\.signUp\s*\(/, 'the auth client must not call Supabase email signup');
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

  await test('5. Existing password login remains authenticated only after a real session', () => {
    const loginStart = supabaseClientSrc.indexOf('window.loginUser = async function');
    const googleStart = supabaseClientSrc.indexOf('window.signInWithGoogle = async function');
    const loginSource = supabaseClientSrc.slice(loginStart, googleStart);
    assert.ok(loginStart >= 0 && googleStart > loginStart, 'email/password login boundary must be identifiable');
    assert.match(loginSource, /client\.auth\.signInWithPassword\s*\(/, 'existing users must still use Supabase password login');
    assert.match(loginSource, /authenticated:\s*true/, 'successful password login must be marked authenticated');
    assert.match(loginSource, /session\.access_token/, 'password login must require a real access-token session');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed) {
    failures.forEach(f => console.error(`❌ ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

run();
