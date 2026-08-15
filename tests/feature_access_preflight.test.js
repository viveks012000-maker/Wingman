const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');

assert(src.includes('const isBtn2Disabled = !isBioValid || isLoading;'));
assert(src.includes('const isBtn3Disabled = !isAuditValid || isLoading;'));
assert(src.includes('const enabled = hasScreenshot && withinLimit && notLoading;'));
assert(!src.includes('if (si) si.disabled = isLocked;'));
assert(src.includes('if (si) si.disabled = isBusy;'));
assert(src.includes('chatSendBtn.style.setProperty("opacity", isChatDisabled ? "0.4" : "1", "important")'));

const authMessage = src.indexOf('Authentication required to use AI features. Please sign in.');
const authModal = src.indexOf('window.openAuthRequiredModal()', authMessage);
assert(authMessage >= 0 && authModal > authMessage, 'Logged-out users must receive sign-in UI');
const insufficient = src.indexOf('Insufficient credits. Current balance: ');
const purchase = src.indexOf('window.openPurchaseModal()', insufficient);
assert(insufficient >= 0 && purchase > insufficient, 'Insufficient-credit users must receive exact balance + purchase UI');

for (const fn of [
    'window.runAnalysis = async function',
    'window.generateIcebreaker = async function',
    'window.runAudit = async function',
    'window.submitChatboxMessage = async function'
]) {
    const start = src.indexOf(fn);
    assert(start >= 0, fn + ' missing');
    const next = src.indexOf('\n    window.', start + fn.length);
    const section = src.slice(start, next > start ? next : start + 16000);
    const credit = section.indexOf('await hasSufficientCredits(');
    const consent = section.indexOf('18+ verification and consent are required before AI processing.');
    assert(credit >= 0, fn + ' must invoke auth/credit preflight');
    assert(consent > credit, fn + ' must report auth/credit before consent');
}
console.log('Feature access preflight UX guard passed.');
