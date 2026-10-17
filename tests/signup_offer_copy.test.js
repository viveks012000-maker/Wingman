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
  assert.doesNotMatch(content, /50\s+(?:free|complimentary)\s+(?:signup\s+)?credits/i, `${name} must not advertise the offer before the database cutover is live`);
}

assert.match(home, /Free trial with complimentary welcome credits after account verification\./);
assert.match(appJs, /Eligible welcome credits are added after your account is verified\./);
assert.match(auth, /Eligible welcome credits are added after your account is verified\./);
assert.match(terms, /created at or after the welcome-credit cutover receive fifty \(50\).*after verification/i);
assert.match(terms, /created before the cutover retain the prior twenty \(20\) credit welcome policy/i);
assert.doesNotMatch(config, /canonical\s+20\s+signup/i);

console.log('✔ Prelaunch signup copy removes the obsolete current 20-credit claim and holds numeric promotion until the database cutover is live.');
