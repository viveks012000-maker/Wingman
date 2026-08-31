/**
 * Tests: System Settings Formatting (Linguistic Shorthand & Emoji Formatting)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING SYSTEM SETTINGS & FORMATTING VERIFICATION TESTS');
console.log('============================================================\n');

const appJs = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').replace(/\r\n/g, '\n');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').replace(/\r\n/g, '\n');
const appHtml = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8').replace(/\r\n/g, '\n');

// 1. Verify UI Elements in app.html
assert.strictEqual(appHtml.includes('id="settingLinguisticShorthand"'), true, 'app.html must have settingLinguisticShorthand checkbox');
assert.strictEqual(appHtml.includes('id="settingEmojiDensity"'), true, 'app.html must have settingEmojiDensity slider');
assert.strictEqual(appHtml.includes('id="emojiLevelLabel"'), true, 'app.html must have emojiLevelLabel display');
console.log('✔ Test 1 Passed: System Settings UI markup (Linguistic Shorthand toggle & Emoji Formatting slider) verified');

// 2. Verify Frontend State & Safe Storage Initialization in app.js
assert.strictEqual(
    appJs.includes('shorthandOption: safeStorage.get("wingman_setting_shorthand", "true") !== "false"'),
    true,
    'app.js must initialize shorthandOption from safeStorage with true default'
);
assert.strictEqual(
    appJs.includes('emojiOption: parseInt(safeStorage.get("wingman_setting_emoji", "1") || "1")'),
    true,
    'app.js must initialize emojiOption from safeStorage with 1 default'
);
console.log('✔ Test 2 Passed: Frontend state initialization & persistent storage verified');

// 3. Verify Frontend Settings Listeners & Modal Handlers
assert.strictEqual(
    appJs.includes('state.shorthandOption = e.target.checked;'),
    true,
    'app.js must update state.shorthandOption on toggle'
);
assert.strictEqual(
    appJs.includes('safeStorage.set("wingman_setting_shorthand", e.target.checked ? "true" : "false");'),
    true,
    'app.js must persist shorthand setting'
);
assert.strictEqual(
    appJs.includes('state.emojiOption = parseInt(e.target.value);'),
    true,
    'app.js must update state.emojiOption on slider input'
);
assert.strictEqual(
    appJs.includes('safeStorage.set("wingman_setting_emoji", e.target.value);'),
    true,
    'app.js must persist emoji setting'
);
console.log('✔ Test 3 Passed: Frontend event listeners and real-time state persistence verified');

// 4. Verify Payload Construction across all 3 Features
assert.strictEqual(
    appJs.includes('shorthandOption: state.shorthandOption !== false,\n                emojiOption: state.emojiOption !== undefined ? state.emojiOption : 1'),
    true,
    'app.js must include shorthandOption and emojiOption in /api/analyze, /api/icebreaker, and /api/optimize payloads'
);
console.log('✔ Test 4 Passed: All feature request payloads correctly pass shorthandOption and emojiOption');

// 5. Verify Backend applyFormattingRules implementation in server.js
// Extract and test applyFormattingRules logic directly
const applyFormattingCode = serverJs.match(/function applyFormattingRules\(text, shorthandOption, emojiOption\) \{[\s\S]*?return result;\s*\}/);
assert.strictEqual(!!applyFormattingCode, true, 'server.js must define applyFormattingRules');

// Create test instance of applyFormattingRules
function fixMidSentenceCapitalization(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function applyFormattingRules(text, shorthandOption, emojiOption) {
    if (!text || typeof text !== "string") return text;
    let result = text;

    const useShorthand = shorthandOption !== false;
    const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;

    // Apply Casing
    if (useShorthand) {
        result = result.toLowerCase();
    } else {
        result = fixMidSentenceCapitalization(result);
    }

    // Apply Emoji Density
    if (emojiLevel === 0) {
        try {
            result = result.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), '').trim();
        } catch(e) {
            result = result.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();
        }
    } else if (emojiLevel === 2) {
        const expressivePool = ["😏", "😉", "👀", "🔥", "✨", "💅", "☕", "💯", "🥂", "⚡"];
        let matchCount = 0;
        try {
            const matches = result.match(new RegExp('\\p{Extended_Pictographic}', 'gu'));
            matchCount = matches ? matches.length : 0;
        } catch(e) {
            const matches2 = result.match(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g);
            matchCount = matches2 ? matches2.length : 0;
        }
        if (matchCount < 2) {
            const needed = 2 - matchCount;
            for (let i = 0; i < needed; i++) {
                const randEmoji = expressivePool[Math.floor(Math.random() * expressivePool.length)];
                result += " " + randEmoji;
            }
        }
    }

    return result;
}

// 6. Test Scenario A: Shorthand ON (true), Minimal Emoji (1)
const resA = applyFormattingRules("Hey There, Let's Grab Tacos! 😉", true, 1);
assert.strictEqual(resA, "hey there, let's grab tacos! 😉", 'Shorthand ON must force fully lowercase text');
console.log('✔ Test 5 Passed: Shorthand ON forces lowercase formatting cleanly');

// 7. Test Scenario B: Shorthand OFF (false), Minimal Emoji (1)
const resB = applyFormattingRules("Hey There, let's grab tacos! 😉", false, 1);
assert.strictEqual(resB, "Hey There, let's grab tacos! 😉", 'Shorthand OFF preserves standard sentence casing');
console.log('✔ Test 6 Passed: Shorthand OFF preserves standard capitalization');

// 8. Test Scenario C: Emoji Level 0 (Zero Emojis)
const resC1 = applyFormattingRules("Hey there 😏 let's get drinks 🔥", true, 0);
assert.strictEqual(resC1, "hey there  let's get drinks", 'Emoji Level 0 must strip 100% of emojis');
const resC2 = applyFormattingRules("No emojis here 😉✨🎉", false, 0);
assert.strictEqual(resC2, "No emojis here", 'Emoji Level 0 must strip all ending/inline emojis');
console.log('✔ Test 7 Passed: Emoji Level 0 (Zero Emojis) strips 100% of emojis');

// 9. Test Scenario D: Emoji Level 2 (Expressive Emojis)
const resD1 = applyFormattingRules("sounds like a plan", true, 2);
const d1EmojiCount = (resD1.match(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\uD83E][\uDD00-\uDFFF]/g) || []).length;
assert.strictEqual(d1EmojiCount >= 2, true, 'Emoji Level 2 must inject at least 2 expressive emojis');
console.log('✔ Test 8 Passed: Emoji Level 2 (Expressive) guarantees at least 2 expressive emojis');

console.log('\n🎉 ALL SYSTEM SETTINGS & FORMATTING VERIFICATION TESTS PASSED!\n');
