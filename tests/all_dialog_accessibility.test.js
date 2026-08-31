'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const accessibility = fs.readFileSync(path.join(root, 'accessibility.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'vendor', 'production-runtime.js'), 'utf8');
const supabaseClient = fs.readFileSync(path.join(root, 'supabaseClient.js'), 'utf8');

const staticDialogs = [...html.matchAll(/id="([^"]+Modal)"/g)].map(match => match[1]);
assert(staticDialogs.length > 0, 'app must contain static dialogs');
for (const id of staticDialogs) {
  assert(accessibility.includes(`${id}:`), `accessibility manager must register ${id}`);
}

assert(accessibility.includes('registerWingmanModal'), 'dynamic dialogs must have a shared registration API');
assert(accessibility.includes('event.currentTarget'), 'modal focus restoration must prefer the invoking control');
assert(accessibility.includes('activeModal.contains(document.activeElement)'), 'modal close focus restoration must respect an active nested dialog');
assert(accessibility.includes('canRestoreFocus'), 'modal close focus restoration must reject hidden or inert invokers');
assert(supabaseClient.includes("registerWingmanModal('wingmanPasswordRecoveryOverlay'"), 'canonical password recovery dialog must use shared accessibility registration');
assert(!runtime.includes('ensureRecoveryModal'), 'production runtime must not carry a duplicate password recovery implementation');
assert(!runtime.includes('passwordRecoveryModal'), 'production runtime must not carry the obsolete password recovery dialog id');
assert(runtime.includes("registerWingmanModal('simulatorReviewModal'"), 'simulator review dialog must use shared accessibility registration');

const unreadableStart = app.indexOf('window.showUnreadableErrorModal');
const unreadableEnd = app.indexOf('window.closeUnreadableErrorModal', unreadableStart);
const unreadableOpen = app.slice(unreadableStart, unreadableEnd);
assert(/classList\.remove\(['"]hidden['"], ['"]opacity-0['"], ['"]pointer-events-none['"]\)/.test(unreadableOpen), 'unreadable dialog opening must clear closed-state classes');
assert(/classList\.add\(['"]opacity-100['"], ['"]pointer-events-auto['"]\)/.test(unreadableOpen), 'unreadable dialog opening must enable interaction');

console.log('All dialog accessibility guard passed.');
