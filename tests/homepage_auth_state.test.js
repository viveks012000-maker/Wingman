'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const rendererMatch = html.match(/<script id="homepage-auth-state-renderer">([\s\S]*?)<\/script>/);

assert.ok(rendererMatch, 'homepage must include its single shared auth-state renderer');
assert.equal(
    Array.from(html.matchAll(/<(?:button|a|span)\b(?=[^>]*\bdata-homepage-auth-control="sign-in")[^>]*>/g)).length,
    3,
    'desktop, mobile-menu, and hero Sign In controls must share the renderer selector'
);
assert.equal(
    Array.from(html.matchAll(/<(?:button|a|span)\b(?=[^>]*\bdata-homepage-auth-control="workspace")[^>]*>/g)).length,
    3,
    'desktop, mobile-menu, and hero workspace links must share the renderer selector'
);
assert.equal(
    Array.from(html.matchAll(/<(?:button|a|span)\b(?=[^>]*\bdata-homepage-auth-control="loading")[^>]*>/g)).length,
    3,
    'desktop, mobile-menu, and hero must use neutral placeholders while auth is unresolved'
);
assert.ok(!html.includes('navSignInBtn'), 'homepage must not use the obsolete Sign In ID');
assert.ok(!html.includes("document.querySelector(\"a[href*='app.html']\")"),
    'homepage must not repurpose an unrelated generic app link as its Sign In control');
assert.ok(/id="signOutBtn"[\s\S]*?<\/button>/.test(appHtml) &&
    /id="signOutBtn"[\s\S]*?\bLog Out\b/.test(appHtml),
    'the desktop account card must expose one clearly labeled Log Out action');
assert.ok(/id="desktopAuthBtn"[^>]*class="auth-state-hidden/.test(appHtml) &&
    /id="mobileAuthBtn"[^>]*class="auth-state-hidden/.test(appHtml),
    'app authentication controls must remain hidden while the canonical session restores');

function makeElement({ guestLabel, signedInLabel, href } = {}) {
    const classes = new Set();
    const attributes = new Map();
    const label = {
        textContent: guestLabel || '',
        dataset: { guestLabel: guestLabel || '', signedInLabel: signedInLabel || '' }
    };
    return {
        dataset: { guestLabel: guestLabel || '', signedInLabel: signedInLabel || '' },
        tagName: href ? 'A' : 'BUTTON',
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        removeAttribute(name) { attributes.delete(name); },
        getAttribute(name) { return attributes.get(name) || null; },
        matches(selector) {
            return selector === 'a, button' && (this.tagName === 'A' || this.tagName === 'BUTTON');
        },
        querySelector(selector) {
            return selector === '[data-homepage-auth-label]' ? label : null;
        },
        get href() { return href; },
        label,
        classes,
        attributes
    };
}

const signInControls = Array.from({ length: 3 }, () => makeElement());
const workspaceControls = [
    makeElement({ guestLabel: 'Launch App', signedInLabel: 'Open Workspace', href: 'app.html' }),
    makeElement({ guestLabel: 'Launch App', signedInLabel: 'Open Workspace', href: 'app.html' }),
    makeElement({ guestLabel: 'Explore the Tools →', signedInLabel: 'Open Workspace', href: 'app.html' })
];
const loadingControls = Array.from({ length: 3 }, () => makeElement());
const selectorResults = new Map([
    ['[data-homepage-auth-control="sign-in"]', signInControls],
    ['[data-homepage-auth-control="workspace"]', workspaceControls],
    ['[data-homepage-auth-control="loading"]', loadingControls]
]);
const document = {
    documentElement: { dataset: {} },
    querySelectorAll(selector) { return selectorResults.get(selector) || []; },
    addEventListener() {}
};
const window = {
    __wingmanAuthStateResolved: false,
    currentSupabaseSession: null
};

vm.runInNewContext(rendererMatch[1], { window, document });
assert.equal(typeof window.renderHomepageAuthState, 'function', 'renderer must be available to Supabase auth events');

window.renderHomepageAuthState();
assert.equal(document.documentElement.dataset.homepageAuthState, 'checking');
assert.ok(signInControls.every(control => control.classes.has('auth-state-hidden')),
    'Sign In must stay out of view while the stored session is unresolved');
assert.ok(workspaceControls.every(control => control.classes.has('auth-state-hidden')),
    'workspace actions must wait for the canonical auth result');
assert.ok(loadingControls.every(control => !control.classes.has('auth-state-hidden')),
    'neutral session placeholders must be visible while checking');

window.__wingmanAuthStateResolved = true;
window.currentSupabaseSession = { access_token: 'valid-token', user: { id: 'account-a' } };
window.renderHomepageAuthState();
assert.equal(document.documentElement.dataset.homepageAuthState, 'authenticated');
assert.ok(signInControls.every(control => control.classes.has('auth-state-hidden')),
    'authenticated homepage must hide every Sign In control');
assert.ok(workspaceControls.every(control => !control.classes.has('auth-state-hidden')),
    'authenticated homepage must show every workspace link');
assert.ok(workspaceControls.every(control => control.label.textContent === 'Open Workspace'),
    'authenticated homepage must label each primary workspace action Open Workspace');
assert.ok(workspaceControls.every(control => control.href === 'app.html'),
    'auth rendering must preserve each existing app.html destination');
assert.ok(loadingControls.every(control => control.classes.has('auth-state-hidden')),
    'session placeholders must disappear after restoration');

window.currentSupabaseSession = null;
window.renderHomepageAuthState();
assert.equal(document.documentElement.dataset.homepageAuthState, 'signed-out');
assert.ok(signInControls.every(control => !control.classes.has('auth-state-hidden')),
    'signed-out visitors must retain all Sign In controls');
assert.ok(workspaceControls.every(control => !control.classes.has('auth-state-hidden')),
    'signed-out visitors must retain workspace access links');
assert.deepEqual(workspaceControls.map(control => control.label.textContent), [
    'Launch App', 'Launch App', 'Explore the Tools →'
], 'guest-facing workspace labels must remain intact');
assert.ok(loadingControls.every(control => control.classes.has('auth-state-hidden')),
    'session placeholders must disappear after a signed-out result');

console.log('Homepage authentication state contract passed.');
