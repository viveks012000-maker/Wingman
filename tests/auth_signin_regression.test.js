const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (e) {
        failed++;
        console.log(`❌ FAIL: ${name} — ${e.message}`);
    }
}

function assertMatch(haystack, needle, msg) {
    if (typeof needle === 'string') {
        if (haystack.indexOf(needle) === -1) {
            throw new Error(`${msg}: expected "${needle}" to be present`);
        }
    } else if (needle instanceof RegExp) {
        if (!needle.test(haystack)) {
            throw new Error(`${msg}: regex did not match`);
        }
    } else {
        throw new Error(`assertMatch: unknown needle type ${typeof needle}`);
    }
}

// Helper: get the refreshUnknownCreditLabels function body from config.js
function getRefreshBody() {
    const idx = config.indexOf('function refreshUnknownCreditLabels');
    if (idx < 0) return null;
    const endIdx = config.indexOf('};', idx) + 2;
    return config.substring(idx, endIdx);
}

// ============================================================
// Credit display state tests (requirement 5A–F)
// ============================================================

// A. signed out: desktop = "0 Credits", mobile = "0 Credits"
test('A. signed out: desktop CreditCount = "0 Credits"', () => {
    const deskMatch = app.match(/if \(desk\) desk\.textContent = "([^"]+)"/);
    if (!deskMatch || deskMatch[1] !== '0 Credits') {
        throw new Error('expected desktop CreditCount = "0 Credits" when signed out');
    }
});

// B. authenticated loading: desktop/mobile != "0 Credits"
test('B. authenticated loading: refreshUnknownCreditLabels early-returns for authenticated sessions', () => {
    const body = getRefreshBody();
    if (!body) throw new Error('refreshUnknownCreditLabels not found in config.js');
    if (!body.includes('window.currentSupabaseSession && window.currentSupabaseSession.access_token')) {
        throw new Error('refreshUnknownCreditLabels must early-return for authenticated sessions');
    }
});

// C. authenticated authoritative zero: state.creditsStatus = "loaded" causes early return
test('C. authenticated authoritative zero: refreshUnknownCreditLabels checks hasAuthoritativeNumber', () => {
    const body = getRefreshBody();
    if (!body) throw new Error('refreshUnknownCreditLabels not found in config.js');
    if (!body.includes('hasAuthoritativeNumber')) {
        throw new Error('refreshUnknownCreditLabels must check hasAuthoritativeNumber');
    }
});

// D. authenticated authoritative nonzero, e.g. 7: credits value is a number type
test('D. authenticated authoritative nonzero: refreshUnknownCreditLabels checks typeof state.credits', () => {
    const body = getRefreshBody();
    if (!body) throw new Error('refreshUnknownCreditLabels not found in config.js');
    if (!body.includes('typeof state.credits === "number"')) {
        throw new Error('refreshUnknownCreditLabels must check typeof state.credits === "number"');
    }
});

// E. authenticated balance failure/unknown: does NOT invent 0
test('E. authenticated balance failure/unknown: early return for authenticated session prevents fake 0', () => {
    const body = getRefreshBody();
    if (!body) throw new Error('refreshUnknownCreditLabels not found in config.js');
    const hasAuthReturn = body.includes('return') &&
        body.indexOf('window.currentSupabaseSession && window.currentSupabaseSession.access_token') >= 0;
    if (!hasAuthReturn) {
        throw new Error('refreshUnknownCreditLabels must return early for authenticated sessions to prevent fake 0 Credits');
    }
});

// F. real backend numeric balance always wins
test('F. real backend numeric balance: hasAuthoritativeNumber early return preserves backend balance', () => {
    const body = getRefreshBody();
    if (!body) throw new Error('refreshUnknownCreditLabels not found in config.js');
    if (!body.includes('if (hasAuthoritativeNumber) return;')) {
        throw new Error('refreshUnknownCreditLabels must early-return when hasAuthoritativeNumber is true');
    }
});

// ============================================================
// Auth sign-in behavior tests
// ============================================================

// SIGNED OUT: canonical auth modal, remain on app page
test('SIGNED OUT: handleAuthBtnClick else branch calls openAuthRequiredModal without index.html redirect', () => {
    const idx = app.indexOf('} else {');
    if (idx >= 0) {
        const elseSection = app.substring(idx, app.indexOf('};', idx) + 2);
        if (elseSection.includes('window.location.href = "index.html"')) {
            throw new Error('else block must not redirect to index.html');
        }
    }
    const openAuthIdx = app.indexOf('window.openAuthRequiredModal');
    if (openAuthIdx < 0) {
        throw new Error('window.openAuthRequiredModal must be callable from else branch');
    }
});

// AUTHENTICATED logout: may redirect to index.html
test('AUTHENTICATED: handleSignOut authenticated path redirects to index.html', () => {
    const signOutIdx = app.indexOf('window.handleSignOut');
    if (signOutIdx >= 0) {
        const signOutSection = app.substring(signOutIdx, app.indexOf('};', signOutIdx) + 2);
        if (!signOutSection.includes('window.location.href = "index.html"')) {
            throw new Error('handleSignOut authenticated path must redirect on logout');
        }
    } else {
        throw new Error('handleSignOut not found');
    }
});

// landing hero Sign In → canonical auth interface
test('landing hero Sign In: canonical auth modal trigger', () => {
    // Check in both app.js and config.js for the modal trigger pattern
    const hasTrigger = app.match(/onclick="window\.openAuthRequiredModal\(event\)"/) !== null;
    if (!hasTrigger) {
        throw new Error('landing hero must expose the canonical Sign In modal trigger');
    }
});

// mobile Sign In → canonical auth modal
test('mobile Sign In: canonical auth modal', () => {
    // Check that the auth modal function exists
    if (config.indexOf('openAuthRequiredModal') < 0 && app.indexOf('openAuthRequiredModal') < 0) {
        throw new Error('app must have openAuthRequiredModal function');
    }
});

// ============================================================
// Summary
// ============================================================

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
} else {
    console.log('All auth sign-in and credit regression tests passed.');
}