const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Accessibility.js must NOT monkey-patch or override credit reading
const a11ySource = fs.readFileSync(path.join(__dirname, '..', 'accessibility.js'), 'utf8');
const marker = 'function installCreditReadSafetyOverride()';
const markerIndex = a11ySource.indexOf(marker);

assert(markerIndex === -1, 'Accessibility.js must NOT monkey-patch window.checkCreditBalance');

// 2. Canonical app.js must contain all consolidated credit session safety guarantees
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const appMarker = 'window.checkCreditBalance = function ()';
const appMarkerIndex = appSource.indexOf(appMarker);

assert(appMarkerIndex >= 0, 'Canonical app.js must define window.checkCreditBalance');
const endMarker = 'window.fetchAndSyncUserCredits = window.checkCreditBalance;';
const appEndIndex = appSource.indexOf(endMarker, appMarkerIndex);
assert(appEndIndex > appMarkerIndex, 'Must find end of checkCreditBalance in app.js');
const canonicalSafety = appSource.slice(appMarkerIndex, appEndIndex + endMarker.length);

assert(
    canonicalSafety.includes('const userId = user && user.id ? user.id : null;'),
    'Authenticated credit-read identity must use Supabase user.id only'
);
assert(
    !canonicalSafety.includes('user.id || user.email'),
    'Credit-read safety layer must never fall back to email identity'
);
assert(
    appSource.includes('function getActiveCreditUserId()') &&
    canonicalSafety.includes('const initialUserId = getActiveCreditUserId();') &&
    canonicalSafety.includes('if (!requestUserId && sessionUserId)') &&
    canonicalSafety.includes('requestUserId = sessionUserId;'),
    'Session restoration must be able to establish requestUserId from authoritative getSession()'
);
assert(
    canonicalSafety.includes('if (requestUserId && sessionUserId && sessionUserId !== requestUserId)') &&
    canonicalSafety.includes('if (requestUserId && activeBeforeSessionCommit && activeBeforeSessionCommit !== requestUserId)'),
    'Session changes during restoration must be rejected as stale'
);
assert(
    canonicalSafety.includes("return { success: false, status: 'stale', credits: state.credits }"),
    'Stale requests must return an explicit stale result'
);

const missingWrites = [...canonicalSafety.matchAll(/state\.creditsStatus = "missing_profile";/g)];
assert(missingWrites.length >= 1, 'Profile-missing result path must remain explicit');
for (const match of missingWrites) {
    const prefix = canonicalSafety.slice(Math.max(0, match.index - 500), match.index);
    assert(
        prefix.includes('requestIsCurrent()'),
        'Every post-await missing_profile write must be preceded by a current-user guard'
    );
}

const errorWrites = [...canonicalSafety.matchAll(/state\.creditsStatus = "error";/g)];
assert(errorWrites.length >= 2, 'Error state paths must remain explicit');
for (const match of errorWrites) {
    const prefix = canonicalSafety.slice(Math.max(0, match.index - 500), match.index);
    assert(
        prefix.includes('requestIsCurrent()'),
        'Every post-await error write must be protected against a stale user request'
    );
}

assert(
    !canonicalSafety.includes('window.fetchProfileCredits') && !canonicalSafety.includes(".from('profiles')"),
    'Canonical wallet verification must use /api/credits only and never fall back to direct Supabase queries'
);
assert(
    canonicalSafety.includes("const resp = await fetch((apiBase || '') + '/api/credits', { headers: authHeaders });"),
    'Authenticated /api/credits canonical query must remain available'
);
assert(
    canonicalSafety.includes('inFlightCreditCheckPromises.get(mapKey) === newPromise') &&
    canonicalSafety.includes('inFlightCreditCheckPromises.delete(mapKey);'),
    'Frontend in-flight Map cleanup must be exact-Promise identity-safe'
);
assert(
    canonicalSafety.includes('window.fetchAndSyncUserCredits = window.checkCreditBalance;'),
    'Legacy credit-sync alias must point at the canonical implementation'
);

console.log('PASS: credit session safety consolidated in app.js with zero monkey-patching in accessibility.js');
