'use strict';

/**
 * Wingman — Language Profile Validation Matrix Suite
 *
 * Verifies validateFinalOption and validateFinalBatch across all 4 profiles:
 * 1. LANGUAGE_PROFILES.ENGLISH ('english')
 * 2. LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED ('english_heavy_mixed')
 * 3. LANGUAGE_PROFILES.BALANCED_MIXED ('balanced_mixed')
 * 4. LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY ('roman_hindi_heavy')
 */

const assert = require('assert');
const {
    validateFinalOption,
    validateFinalBatch,
    LANGUAGE_PROFILES
} = require('../middleware/languageSelection');

console.log('============================================================');
console.log('🧪 RUNNING LANGUAGE PROFILE VALIDATION MATRIX SUITE');
console.log('============================================================\n');

// -------------------------------------------------------------
// PROFILE 1: HIGH-STATUS ENGLISH
// -------------------------------------------------------------
console.log('▶ [PROFILE 1: ENGLISH]');
const validEnglish = "Always down for a competitive basketball game, as long as coffee follows.";
const r1 = validateFinalOption(validEnglish, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(r1.valid, true, 'Valid English option must pass');

const hinglishLeakInEnglish = "court pe chalte hain for a match, coffee is on me.";
const r2 = validateFinalOption(hinglishLeakInEnglish, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(r2.valid, false, 'Hinglish in English profile must fail');
assert.strictEqual(r2.reason, 'unexpected_hinglish');

const devanagariInEnglish = "I love playing basketball on weekends नमस्ते";
const r3 = validateFinalOption(devanagariInEnglish, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(r3.valid, false, 'Devanagari must be rejected in English profile');
assert.strictEqual(r3.reason, 'contains_devanagari');
console.log('✔ Profile 1 (ENGLISH) verified: Valid English accepted, Hinglish and Devanagari rejected.\n');

// -------------------------------------------------------------
// PROFILE 2: ENGLISH-HEAVY MIXED
// -------------------------------------------------------------
console.log('▶ [PROFILE 2: ENGLISH_HEAVY_MIXED]');
const validEnglishHeavy = "Always down for basketball, weekends usually court pe milunga with friends.";
const r4 = validateFinalOption(validEnglishHeavy, 'icebreaker', LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED);
assert.strictEqual(r4.valid, true, 'Valid English-heavy blend with natural Hindi anchor must pass');

const flattenedPureEnglish = "Always down for basketball, usually playing with friends on weekends.";
const r5 = validateFinalOption(flattenedPureEnglish, 'icebreaker', LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED);
assert.strictEqual(r5.valid, false, 'Pure English flattening must be rejected in English-heavy profile');
assert.strictEqual(r5.reason, 'flattened_to_pure_english');

const overlyHindiHeavy = "mujhe basketball bahut pasand hai aur weekend pe court jana acha lagta hai";
const r6 = validateFinalOption(overlyHindiHeavy, 'icebreaker', LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED);
assert.strictEqual(r6.valid, false, 'Excessive Hindi dominance must be rejected in English-heavy profile');
assert.strictEqual(r6.reason, 'excessive_hindi_for_english_heavy_profile');
console.log('✔ Profile 2 (ENGLISH_HEAVY_MIXED) verified: Authentic blend accepted, pure English flattening and Hindi excess rejected.\n');

// -------------------------------------------------------------
// PROFILE 3: BALANCED MIXED
// -------------------------------------------------------------
console.log('▶ [PROFILE 3: BALANCED_MIXED]');
const validBalanced = "basketball kaafi pasand hai, weekends usually court pe milunga for a quick match.";
const r7 = validateFinalOption(validBalanced, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(r7.valid, true, 'Valid balanced blend must pass');

const pureEnglishInBalanced = "I really like playing basketball and exploring local cafes on weekends.";
const r8 = validateFinalOption(pureEnglishInBalanced, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(r8.valid, false, 'Pure English must be rejected in balanced mixed profile');
assert.strictEqual(r8.reason, 'insufficient_hinglish');

const pureHindiWithoutEnglish = "mujhe yeh sab kuch bahut pasand hai aur waha jana accha lagta hai";
const r9 = validateFinalOption(pureHindiWithoutEnglish, 'icebreaker', LANGUAGE_PROFILES.BALANCED_MIXED);
assert.strictEqual(r9.valid, false, 'Pure Hindi with zero English words must be rejected in balanced mixed profile');
assert.strictEqual(r9.reason, 'missing_english_blend');
console.log('✔ Profile 3 (BALANCED_MIXED) verified: Balanced blend accepted, pure English and pure Hindi rejected.\n');

// -------------------------------------------------------------
// PROFILE 4: ROMAN-HINDI HEAVY
// -------------------------------------------------------------
console.log('▶ [PROFILE 4: ROMAN_HINDI_HEAVY]');
const validRomanHindiHeavy = "weekend pe court scene pakka? match kab ho raha hai?";
const r10 = validateFinalOption(validRomanHindiHeavy, 'icebreaker', LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY);
assert.strictEqual(r10.valid, true, 'Valid Roman-Hindi heavy phrasing must pass');

const weakHinglishInHeavy = "maybe we can meet at a cafe sometime.";
const r11 = validateFinalOption(weakHinglishInHeavy, 'icebreaker', LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY);
assert.strictEqual(r11.valid, false, 'Weak/pure English must be rejected in Roman-Hindi heavy profile');
assert.strictEqual(r11.reason, 'insufficient_hinglish');
console.log('✔ Profile 4 (ROMAN_HINDI_HEAVY) verified: Fluent Roman Hindi accepted, weak Hinglish rejected.\n');

// -------------------------------------------------------------
// BATCH VALIDATION SUITE
// -------------------------------------------------------------
console.log('▶ [BATCH VALIDATION]');
const validBatchEnglish = [
    "What would you say is the most underrated coffee spot in town?",
    "Tell me your take on spontaneous weekend road trips with good playlists.",
    "Which playlist do you put on when driving late at night?",
    "Are you more of an early morning explorer or late night conversationalist?",
    "How do you usually unwind after an intense week of work?",
    "Could you survive a long road trip without any music?",
    "Never thought I would come across someone who shares this exact music taste.",
    "Your profile caught my attention with that travel story in the bio.",
    "Let us debate who has the better taste in Sunday brunch spots.",
    "Pick a side between mountain cabin getaways and sunny coastal beaches."
];
const b1 = validateFinalBatch(validBatchEnglish, 'icebreaker', LANGUAGE_PROFILES.ENGLISH);
assert.strictEqual(b1.valid, true, 'All 10 valid English options must pass batch validation');
assert.strictEqual(b1.invalidIndices.length, 0);

const mixedBatch = [
    "Always down for basketball, court pe milunga on weekends.",
    "Usually free for coffee after work, cafe pe milte hain.",
    "Completely pure English option with no Hindi at all.", // index 2 fails
    "Weekend plans usually sorted hain, court pe match chalega."
];
const b2 = validateFinalBatch(mixedBatch, 'icebreaker', LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED);
assert.strictEqual(b2.valid, false, 'Batch with pure English in English-heavy profile must fail');
assert.deepStrictEqual(b2.invalidIndices, [2], 'Only index 2 should be marked invalid');
console.log('✔ Batch validation verified: Selective invalid indices identified with precision.\n');

console.log('============================================================');
console.log('🎉 ALL LANGUAGE PROFILE MATRIX TESTS PASSED!');
console.log('============================================================');
