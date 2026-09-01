'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const supabase = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'vendor', 'production-runtime.js'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');

function blockBody(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `${marker} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(bodyStart, i + 1);
  }
  throw new Error(`Could not parse ${marker}`);
}

const storageWrapper = blockBody(app, 'const safeStorage = {');
assert(!storageWrapper.includes('sessionStorage.setItem'), 'safeStorage must not duplicate persistent writes into sessionStorage');
assert(!storageWrapper.includes('localStorage.clear'), 'safeStorage.clear must not erase unrelated origin data');
assert(!storageWrapper.includes('sessionStorage.clear'), 'safeStorage.clear must not erase unrelated origin data');

const saveSession = blockBody(app, 'function saveSessionState');
for (const privateField of ['bioInput', 'auditInput', 'activeTranscriptCache', 'activeSimulatorThread', 'icebreakCardsData', 'optimizeCardsData']) {
  assert(!saveSession.includes(`${privateField}:`), `session persistence must not include ${privateField}`);
}
assert(!saveSession.includes('safeStorage.set(SESSION_KEY'), 'private session state must remain in memory');

for (const authFunction of ['updateButtonStates', 'checkDashboardAuth']) {
  const body = blockBody(app, `window.${authFunction} = function`);
  assert(!body.includes('wingman_authenticated'), `${authFunction} must not trust persisted authentication flags`);
  assert(!body.includes('wingman_user_authenticated'), `${authFunction} must not trust persisted authentication flags`);
}

assert(!app.includes('sessionStorage.clear()'), 'app logout must not clear unrelated session storage');
assert(!app.includes('localStorage.clear()'), 'app logout must not clear unrelated local storage');
assert(!supabase.includes('sessionStorage.clear()'), 'Supabase logout must not clear unrelated session storage');
assert(!supabase.includes('localStorage.clear()'), 'Supabase logout must not clear unrelated local storage');
assert(!runtime.includes('sessionStorage.clear()'), 'Runtime account deletion must not clear unrelated session storage');
assert(!runtime.includes('localStorage.clear()'), 'Runtime account deletion must not clear unrelated local storage');
assert(/does not retain[\s\S]*localStorage[\s\S]*sessionStorage/i.test(privacy), 'privacy policy must disclose that private session inputs are not browser-persisted');

console.log('Client privacy boundary guard passed.');
