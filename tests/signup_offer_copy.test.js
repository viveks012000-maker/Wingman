'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const home = read('index.html');
const app = read('app.html');
const appJs = read('app.js');
const auth = read('supabaseClient.js');
const terms = read('terms.html');
const config = read('config.js');

for (const [name, content] of [['homepage', home], ['signup page', app], ['signup handler', appJs], ['Auth client', auth]]) {
  assert.doesNotMatch(content, /20\s+(?:free|complimentary)\s+(?:signup\s+)?credits/i, `${name} must not claim the old welcome grant is current`);
}

const offerHeadline = 'Get 50 Free AI Credits';
const offerMessage = 'Sign up with Google and receive 50 free AI credits. No purchase required. Available once to eligible new users.';
assert.ok(home.includes(offerHeadline), 'homepage must clearly promote the eligible Google signup offer');
assert.ok(home.includes(offerMessage), 'homepage must state the offer terms accurately');
assert.ok(app.includes(offerHeadline), 'the sign-in dialog must identify the 50-credit offer');
assert.ok(app.includes(offerMessage), 'the sign-in dialog must state the same offer terms as the homepage');
assert.match(home, /"description": "Get 50 free AI credits when you sign up with Google\. No purchase required; available once to eligible new users\."/,
  'structured offer metadata must match the eligibility and no-purchase terms');
assert.match(home, /description"\s+content="Get 50 free AI credits when you sign up with Google\. No purchase required; available once to eligible new users\./,
  'search description must advertise only the verified offer terms');
assert.match(app, /id="desktopCreditCount">Credits —<\/span>/, 'desktop account balance must remain live-data driven');
assert.match(app, /id="mobileCreditCount">Credits —<\/span>/, 'mobile account balance must remain live-data driven');
assert.match(appJs, /const label = state\.credits \+ " Credit" \+ \(state\.credits === 1 \? "" : "s"\);[\s\S]*?if \(desk\) desk\.textContent = label;[\s\S]*?if \(mob\) mob\.textContent = label;/,
  'desktop and mobile credit displays must use the same authoritative balance');
assert.match(appJs, /Eligible welcome credits are added after your account is verified\./,
  'unverified email/password attempts must not be described as successful signups');
assert.doesNotMatch(auth, /client\.auth\.signUp\s*\(/,
  'the Auth client must not expose email/password registration in the Google-only beta');
assert.match(auth, /client\.auth\.signInWithPassword\s*\(/,
  'existing email/password login must remain supported');
assert.match(terms, /created at or after the welcome-credit cutover receive fifty \(50\).*after verification/i);
assert.match(terms, /created before the cutover retain the prior twenty \(20\) credit welcome policy/i);
assert.doesNotMatch(config, /canonical\s+20\s+signup/i);

console.log('✔ Google-only 50-credit offer copy matches eligibility terms and keeps desktop/mobile balances authoritative.');
