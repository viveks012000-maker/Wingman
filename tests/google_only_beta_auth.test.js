'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const landing = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const supabaseClient = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');

for (const [name, html] of [['landing page', landing], ['app page', app]]) {
    assert.match(html, /Continue with Google/, `${name} keeps Google OAuth available`);
    assert.match(html, /Sign In with Email/, `${name} keeps email/password login available`);
    assert.doesNotMatch(html, /Need an account\? Sign Up|Sign Up with Email|Already have an account\? Sign In/,
        `${name} does not offer email/password registration`);
    assert.match(html, /New accounts use Google/i,
        `${name} explains that new beta accounts use Google`);
    assert.doesNotMatch(html, /Get 50 Free AI Credits|50 free AI credits/i,
        `${name} does not publish the 50-credit promotion before live-account verification`);
}

for (const [name, source] of [['landing page', landing], ['app page', appJs]]) {
    assert.doesNotMatch(source, /window\.signUpUser\s*\(/,
        `${name} auth form cannot submit an email/password signup`);
    assert.match(source, /window\.loginUser\s*\(/,
        `${name} preserves existing email/password sign-in`);
}

assert.match(landing, /window\.signInWithGoogle\(event\)/,
    'landing page Google button invokes Google OAuth');
assert.match(app, /window\.signInWithGoogle\(event\)/,
    'app page Google button invokes Google OAuth');
assert.doesNotMatch(supabaseClient, /window\.signUpUser|client\.auth\.signUp\s*\(/,
    'application client does not expose an email/password signup path');
assert.match(supabaseClient, /client\.auth\.signInWithPassword\s*\(/,
    'application client keeps email/password sign-in for existing accounts');

console.log('PASS: Google-only new-account UI, existing email/password login, and unpublished 50-credit promotion.');
