const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'accessibility.js'), 'utf8');
const marker = 'function installCreditReadSafetyOverride()';
const markerIndex = source.indexOf(marker);

assert(markerIndex >= 0, 'Credit read safety override must be installed after app.js');
const safety = source.slice(markerIndex);

assert(
    safety.includes('const userId = user && user.id ? user.id : null;'),
    'Authenticated credit-read identity must use Supabase user.id only'
);
assert(
    !safety.includes('user.id || user.email'),
    'Credit-read safety layer must never fall back to email identity'
);
assert(
    safety.includes('const initialUserId = getActiveCreditUserId();') &&
    safety.includes('if (!requestUserId && sessionUserId)') &&
    safety.includes('requestUserId = sessionUserId;'),
    'Session restoration must be able to establish requestUserId from authoritative getSession()'
);
assert(
    safety.includes('if (requestUserId && sessionUserId && sessionUserId !== requestUserId)') &&
    safety.includes('if (requestUserId && activeBeforeSessionCommit && activeBeforeSessionCommit !== requestUserId)'),
    'Session changes during restoration must be rejected as stale'
);
assert(
    safety.includes("return { success: false, status: 'stale', credits: window.state.credits }"),
    'Stale requests must return an explicit stale result'
);

const missingWrites = [...safety.matchAll(/window\.state\.creditsStatus = 'missing_profile';/g)];
assert(missingWrites.length >= 3, 'All profile-missing result paths must remain explicit');
for (const match of missingWrites) {
    const prefix = safety.slice(Math.max(0, match.index - 700), match.index);
    assert(
        prefix.includes('requestIsCurrent()') || prefix.includes('getActiveCreditUserId()'),
        'Every post-await missing_profile write must be preceded by a current-user guard'
    );
}

const errorWrites = [...safety.matchAll(/window\.state\.creditsStatus = 'error';/g)];
assert(errorWrites.length >= 2, 'Error state paths must remain explicit');
for (const match of errorWrites) {
    const prefix = safety.slice(Math.max(0, match.index - 500), match.index);
    assert(
        prefix.includes('requestIsCurrent()') || prefix.includes('getActiveCreditUserId() !== requestUserId'),
        'Every post-await error write must be protected against a stale user request'
    );
}

assert(
    safety.includes('const creditsResult = await window.fetchProfileCredits(userId);'),
    'Client fallback must receive only the authoritative Supabase user ID'
);
assert(
    !safety.includes('!directQueryAttempted'),
    'Direct-query failure must not disable fetchProfileCredits fallback'
);
assert(
    safety.includes("const response = await fetch((apiBase || '') + '/api/credits', { headers: authHeaders });"),
    'Authenticated /api/credits fallback must remain available'
);
assert(
    safety.includes('inFlightCreditReads.get(mapKey) === requestPromise') &&
    safety.includes('inFlightCreditReads.delete(mapKey);'),
    'Frontend in-flight Map cleanup must be exact-Promise identity-safe'
);
assert(
    safety.includes('window.fetchAndSyncUserCredits = window.checkCreditBalance;'),
    'Legacy credit-sync alias must point at the corrected implementation'
);

console.log('PASS: credit session safety override source contract');
