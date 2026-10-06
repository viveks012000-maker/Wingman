'use strict';

const assert = require('assert');
const {
    scoreLanguageTokens,
    resolveLanguageProfile,
    validateFinalOption,
    validateFinalBatch,
    LANGUAGE_PROFILES
} = require('../middleware/languageSelection');

console.log('============================================================');
console.log('🧪 RUNNING LANGUAGE TOKEN SCORER & NATURAL GRAMMAR TESTS');
console.log('============================================================\n');

// -----------------------------------------------------------------
// TEST 1: Token Classification Integrity & Unknown Latin Handling
// -----------------------------------------------------------------
console.log('▶ [TEST 1] scoreLanguageTokens Token Classification');

// Fixture 1: Mixed Bio
const scoreMixedBio = scoreLanguageTokens('mera naam sumit hai and i like basketball');
assert.strictEqual(scoreMixedBio.hindiKnownCount, 3, 'mera, naam, hai are Hindi');
assert.strictEqual(scoreMixedBio.englishKnownCount, 3, 'and, i, like are English stop words');
assert.ok(scoreMixedBio.unknownCount >= 2, 'sumit and basketball must be classified as unknownCount');
assert.strictEqual(scoreMixedBio.hasHindiGrammarAnchor, true, 'has Hindi anchor (mera, hai)');
assert.strictEqual(scoreMixedBio.containsDevanagari, false);
console.log('✔ Mixed bio correctly classified with unknown words kept separate from English stop words.');

// Fixture 2: Mixed Icebreaker
const scoreMixedIce = scoreLanguageTokens('mera naam sanchi hai and i like basketball bhaut zayada');
assert.strictEqual(scoreMixedIce.hindiKnownCount, 5, 'mera, naam, hai, bhaut, zayada are Hindi');
assert.strictEqual(scoreMixedIce.englishKnownCount, 3, 'and, i, like are English');
assert.ok(scoreMixedIce.unknownCount >= 2, 'sanchi and basketball must be unknownCount');
assert.strictEqual(scoreMixedIce.hasHindiGrammarAnchor, true);
console.log('✔ Mixed icebreaker correctly scored.');

// Fixture 3: English Control
const scoreEng = scoreLanguageTokens('I like basketball and travelling on weekends');
assert.strictEqual(scoreEng.hindiKnownCount, 0);
assert.strictEqual(scoreEng.hasHindiGrammarAnchor, false);
assert.ok(scoreEng.englishKnownCount >= 4, 'I, like, and, on are English');
console.log('✔ English control correctly scored with 0 Hindi tokens.');

// Fixture 4: Roman-Hindi / Hinglish Control
const scoreHing = scoreLanguageTokens('mujhe basketball bahut pasand hai aur weekend pe court jana acha lagta hai');
assert.ok(scoreHing.hindiKnownCount >= 7, 'mujhe, bahut, pasand, hai, aur, pe, jana, acha, lagta, hai are Hindi');
assert.strictEqual(scoreHing.hasHindiGrammarAnchor, true);
console.log('✔ Hinglish control correctly scored with authentic Hindi anchors.\n');

// -----------------------------------------------------------------
// TEST 2: Profile Resolution Accuracy
// -----------------------------------------------------------------
console.log('▶ [TEST 2] resolveLanguageProfile Contract');

assert.strictEqual(
    resolveLanguageProfile('mera naam sumit hai and i like basketball'),
    LANGUAGE_PROFILES.BALANCED_MIXED,
    'Mixed bio resolves to balanced mixed profile'
);

assert.strictEqual(
    resolveLanguageProfile('mera naam sanchi hai and i like basketball bhaut zayada'),
    LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY,
    'Mixed icebreaker with dominant Hindi phrasing resolves to roman_hindi_heavy profile'
);

assert.strictEqual(
    resolveLanguageProfile('I like basketball and travelling on weekends'),
    LANGUAGE_PROFILES.ENGLISH,
    'English control resolves to english profile'
);

assert.strictEqual(
    resolveLanguageProfile('mujhe basketball bahut pasand hai aur weekend pe court jana acha lagta hai'),
    LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY,
    'Hinglish control resolves to roman_hindi_heavy profile'
);
console.log('✔ All 4 canonical fixtures resolve to their expected language profiles.\n');

// -----------------------------------------------------------------
// TEST 3: Unnatural Code-Switching Detection
// -----------------------------------------------------------------
console.log('▶ [TEST 3] Unnatural Code-Switching Rejection');

const unnatural1 = validateFinalOption('I love basketball hai', 0, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(unnatural1.valid, false);
assert.strictEqual(unnatural1.reason, 'unnatural_code_switching', '"I love basketball hai" must be rejected as unnatural code switching');

const unnatural2 = validateFinalOption('You like pizza hai.', 0, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(unnatural2.valid, false);
assert.strictEqual(unnatural2.reason, 'unnatural_code_switching', '"You like pizza hai." must be rejected as unnatural code switching');

const unnatural3 = validateFinalOption('I enjoy travelling on weekends tha', 0, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(unnatural3.valid, false);
assert.strictEqual(unnatural3.reason, 'unnatural_code_switching', '"I enjoy travelling on weekends tha" must be rejected as unnatural code switching');

// Natural Hinglish sentences must NOT be rejected as unnatural code-switching
const natural1 = validateFinalOption('mujhe basketball bahut pasand hai, court pe challenge kab?', 0, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(natural1.valid, true, 'Natural Hinglish with proper Hindi grammar must pass');

const natural2 = validateFinalOption('basketball kaafi pasand hai, weekends usually court pe milunga', 0, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(natural2.valid, true, 'Natural Hinglish blend must pass');

const natural3 = validateFinalOption('aapke hisaab se sabse underrated cafe kaunsa hai?', 0, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(natural3.valid, true, 'Natural question with aapke hisaab se must pass');
console.log('✔ Unnatural code-switching correctly rejected; natural Hinglish accepted.\n');

// -----------------------------------------------------------------
// TEST 4: Batch Diversity & Banned Anchor Detection
// -----------------------------------------------------------------
console.log('▶ [TEST 4] Batch Diversity Validation in validateFinalBatch');

// 1. Banned Anchor: "settle this"
const batchWithBanned = [
    "What is your absolute favorite coffee spot in town, let's settle this",
    "Tell me your take on spontaneous weekend road trips.",
    "Which playlist do you put on when driving late at night?",
    "Are you more of an early morning explorer or night owl?",
    "How do you usually spend a quiet Sunday afternoon?",
    "Could you survive a four hour road trip with no phone?",
    "Never thought I would find someone with such great taste.",
    "Honestly your profile vibe on here seems completely refreshing.",
    "Let us debate who has sharper banter over iced coffee.",
    "Pick a side between mountain cabins and sunny beaches."
];
const resBanned = validateFinalBatch(batchWithBanned, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(resBanned.valid, false);
assert.ok(resBanned.details.some(d => d.reason === 'banned_anchor'), 'Batch containing "settle this" must flag banned_anchor');

// 2. Duplicate Opening
const batchWithDupOpening = [
    "what is your absolute favorite coffee spot in town?",
    "what is your move on a rainy Sunday afternoon?",
    "Which playlist do you put on when driving late at night?",
    "Are you more of an early morning explorer or night owl?",
    "How do you usually spend a quiet Sunday afternoon?",
    "Could you survive a four hour road trip with no phone?",
    "Never thought I would find someone with such great taste.",
    "Honestly your profile vibe on here seems completely refreshing.",
    "Let us debate who has sharper banter over iced coffee.",
    "Pick a side between mountain cabins and sunny beaches."
];
const resDupOpening = validateFinalBatch(batchWithDupOpening, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(resDupOpening.valid, false);
assert.ok(resDupOpening.details.some(d => d.reason === 'duplicate_opening'), 'Batch with duplicate opening words must flag duplicate_opening');

// 3. Duplicate Question Anchor
const batchWithDupAnchor = [
    "late-night city drives aur best coffee spots kaafi pasand hain.\nreal question: chai person ho ya cold brew lover?",
    "Usually found scouting hidden book cafes and scenic road trips. What's your move on a rainy Sunday?",
    "Gym regular by morning, street food enthusiast by night. Tell me: who has better taste in playlists?",
    "Equal parts spontaneous road trips and chill acoustic evenings. Honest debate: beach sunsets or mountain cabins?",
    "Believer in good conversations and unexpected coffee stops. Pick a side: early sunrise or late midnight?",
    "Always planning the next weekend getaway and finding great diners. Candid check: are you spontaneous?",
    "Living for live gigs, long playlist drives, and great coffee. Tell me your go-to weekend vibe?",
    "Part-time chef, full-time explorer of local cafes. This or that: spicy street food or quiet rooftop dinner?",
    "curiosity, good coffee, aur late-night banter kaafi sorted hai.\nreal question: 4-hour road trip survive kar paoge?",
    "Looking for a partner in crime for weekend breakfast runs and banter. Final call: waffles or pancakes?"
];
const resDupAnchor = validateFinalBatch(batchWithDupAnchor, 'optimize', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(resDupAnchor.valid, false);
assert.ok(resDupAnchor.details.some(d => d.reason === 'duplicate_question_anchor'), 'Batch with duplicate "real question" must flag duplicate_question_anchor');

// 4. Valid High-Quality Diverse Batch
const validBatch = [
    "What is your absolute favorite coffee spot in town?",
    "Tell me your take on spontaneous weekend road trips.",
    "Which playlist do you put on when driving late at night?",
    "Are you more of an early morning explorer or night owl?",
    "How do you usually spend a quiet Sunday afternoon?",
    "Could you survive a four hour road trip with no phone?",
    "Never thought I would find someone with such great taste.",
    "Honestly your profile vibe on here seems completely refreshing.",
    "Let us debate who has sharper banter over iced coffee.",
    "Pick a side between mountain cabins and sunny beaches."
];
const resValid = validateFinalBatch(validBatch, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(resValid.valid, true, 'Diverse, clean batch must pass validation with 0 errors');
assert.strictEqual(resValid.details.length, 0);
console.log('✔ Batch diversity validation correctly flags banned anchors, duplicate openings, and duplicate question anchors.\n');

console.log('============================================================');
console.log('🎉 ALL LANGUAGE SCORER & NATURAL GRAMMAR TESTS PASSED!');
console.log('============================================================\n');
