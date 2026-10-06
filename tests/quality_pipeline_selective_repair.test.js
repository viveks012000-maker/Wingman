'use strict';

const assert = require('assert');
const {
    resolveLanguageProfile,
    getAuthoritativeProfileDirective,
    validateFinalOption,
    validateFinalBatch,
    LANGUAGE_PROFILES
} = require('../middleware/languageSelection');

console.log('============================================================');
console.log('🧪 QUALITY PIPELINE & SELECTIVE REPAIR TEST SUITE');
console.log('============================================================\n');

// 1. LANGUAGE PROFILES
console.log('▶ [TEST 1] Verifying Distinct Language Profiles...');
const mixedBio = "mera naam sumit hai and i like basketball";
const mixedIcebreaker = "mera naam sanchi hai and i like basketball bhaut zayada";
const englishControl = "I like basketball and travelling on weekends";
const hindiControl = "mujhe basketball bahut pasand hai aur weekend pe court jana acha lagta hai";

const pBio = resolveLanguageProfile(mixedBio);
const pIce = resolveLanguageProfile(mixedIcebreaker);
const pEng = resolveLanguageProfile(englishControl);
const pHindi = resolveLanguageProfile(hindiControl);

console.log(`  - Mixed Bio: ${pBio}`);
console.log(`  - Mixed Icebreaker: ${pIce}`);
console.log(`  - English Control: ${pEng}`);
console.log(`  - Roman Hindi Control: ${pHindi}`);

assert.strictEqual(pEng, LANGUAGE_PROFILES.ENGLISH, 'English control must resolve to ENGLISH');
assert.strictEqual(pHindi, LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY, 'Hindi control must resolve to ROMAN_HINDI_HEAVY');
assert.ok([LANGUAGE_PROFILES.BALANCED_MIXED, LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED].includes(pBio), 'Mixed Bio must resolve to mixed profile');
assert.ok([LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY, LANGUAGE_PROFILES.BALANCED_MIXED].includes(pIce), 'Mixed Icebreaker must resolve to mixed/heavy profile');
console.log('✔ Test 1 Passed: Language profiles resolved distinctly.\n');

// 2. AUTHORITATIVE DIRECTIVES
console.log('▶ [TEST 2] Verifying Tailored Authoritative Profile Directives...');
const dEng = getAuthoritativeProfileDirective(LANGUAGE_PROFILES.ENGLISH, 'icebreaker');
const dMixedEng = getAuthoritativeProfileDirective(LANGUAGE_PROFILES.ENGLISH_HEAVY_MIXED, 'icebreaker');
const dBalanced = getAuthoritativeProfileDirective(LANGUAGE_PROFILES.BALANCED_MIXED, 'icebreaker');
const dHindi = getAuthoritativeProfileDirective(LANGUAGE_PROFILES.ROMAN_HINDI_HEAVY, 'icebreaker');

assert.ok(dEng.includes('HIGH-STATUS ENGLISH') && dEng.includes('LATIN / ENGLISH ALPHABET ONLY'), 'English directive must enforce English');
assert.ok(dMixedEng.includes('ENGLISH-DOMINANT HINGLISH BLEND'), 'Mixed Eng directive must specify English dominant blend');
assert.ok(dBalanced.includes('BALANCED ROMAN-SCRIPT HINGLISH'), 'Balanced directive must specify balanced Hinglish');
assert.ok(dHindi.includes('ROMAN HINDI CONVERSATIONAL FLUENCY'), 'Hindi heavy directive must specify Roman Hindi fluency');
console.log('✔ Test 2 Passed: Authoritative directives tailored accurately.\n');

// 3. GRAMMAR QUALITY GATE
console.log('▶ [TEST 3] Verifying Grammar Quality Gate...');
// Valid options
const validEng = "I really enjoy pickup basketball games and exploring coffee spots.";
const validHinglish = "basketball kaafi pasand hai ya bas weekend hobby hai? 🏀";
const validNumber2026 = "looking forward to 2026 and new adventures";
const validRatio = "compatibility is 2/10 but let's see";
const validCourtNumber = "1v1 me on court 2 this Saturday";
const validTime = "drinks at 7 PM or coffee first?";

assert.strictEqual(validateFinalOption(validEng, 'icebreaker', 'english').valid, true, 'Valid English option must pass');
assert.strictEqual(validateFinalOption(validHinglish, 'icebreaker', 'balanced_mixed').valid, true, 'Valid Hinglish option must pass');
assert.strictEqual(validateFinalOption(validNumber2026, 'optimize', 'english').valid, true, 'Legitimate year 2026 must be preserved');
assert.strictEqual(validateFinalOption(validRatio, 'icebreaker', 'english').valid, true, 'Legitimate ratio 2/10 must be preserved');
assert.strictEqual(validateFinalOption(validCourtNumber, 'icebreaker', 'english').valid, true, 'Court number must be preserved');
assert.strictEqual(validateFinalOption(validTime, 'icebreaker', 'english').valid, true, 'Time 7 PM must be preserved');

// Invalid options
const brokenSubjVerb = "i rides bikes often";
const brokenPronoun = "me likes coffee a lot";
const brokenThirdPerson = "she like to travel";
const danglingAnd = "court pe milte hain aur";
const danglingWith = "let's go out with";
const repeatedWords = "and and then we leave";
const devanagariText = "नमस्ते how are you";

assert.strictEqual(validateFinalOption(brokenSubjVerb, 'optimize', 'english').valid, false, 'Subject-verb disagreement must fail');
assert.strictEqual(validateFinalOption(brokenPronoun, 'optimize', 'english').valid, false, 'Broken pronoun must fail');
assert.strictEqual(validateFinalOption(brokenThirdPerson, 'optimize', 'english').valid, false, 'Third person agreement must fail');
assert.strictEqual(validateFinalOption(danglingAnd, 'icebreaker', 'balanced_mixed').valid, false, 'Dangling "aur" must fail');
assert.strictEqual(validateFinalOption(danglingWith, 'icebreaker', 'english').valid, false, 'Dangling "with" must fail');
assert.strictEqual(validateFinalOption(repeatedWords, 'icebreaker', 'english').valid, false, 'Repeated adjacent words must fail');
assert.strictEqual(validateFinalOption(devanagariText, 'icebreaker', 'balanced_mixed').valid, false, 'Devanagari must fail');

console.log('✔ Test 3 Passed: Grammar quality gate correctly validates grammar and preserves legitimate numbers.\n');

// 4. BATCH VALIDATION
console.log('▶ [TEST 4] Verifying Batch Validation & Invalid Indices Detection...');
const mixedBatch = [
    "basketball kaafi pasand hai ya bas weekend hobby hai? 🏀", // 0: valid
    "profile kaafi cool hai, weekend scene kya hota hai usually?", // 1: valid
    "court pe milte hain aur", // 2: INVALID (dangling connector)
    "coffee tapri pe honest debate: pickup game ya proper league?", // 3: valid
    "aaj court pe challenge accept karogi ya sirf baatein? 😉", // 4: valid
    "late-night drives aur playlist debates meri specialty hai 🎧", // 5: valid
    "pick a side: slow acoustic sunna hai ya full volume drive?", // 6: valid
    "i rides bikes on weekends", // 7: INVALID (broken grammar)
    "gym discipline intact hai, par Sunday brunch pe zero control 🥞", // 8: valid
    "final call: workout pehle ya directly food scene chalega?" // 9: valid
];

const batchResult = validateFinalBatch(mixedBatch, 'icebreaker', 'balanced_mixed');
console.log('  - Batch validation result:', batchResult);
assert.strictEqual(batchResult.valid, false, 'Batch with invalid items must be marked invalid');
assert.deepStrictEqual(batchResult.invalidIndices, [2, 7], 'Indices 2 and 7 must be identified as invalid');
assert.strictEqual(batchResult.details.length, 2, 'Exactly 2 failure details must be returned');
console.log('✔ Test 4 Passed: Batch validation accurately flags invalid slots.\n');

console.log('============================================================');
console.log('🎉 ALL QUALITY PIPELINE UNIT TESTS PASSED!');
console.log('============================================================\n');
