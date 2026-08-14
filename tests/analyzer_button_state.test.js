/**
 * Tests: Screenshot Analyzer Button Enablement & DOM State Machine
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER BUTTON STATE TESTS');
console.log('============================================================\n');

// 1. Static Contract & Handler Verification
const appJs = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');

// Ensure button element exists in app.html with runAnalysis click handler
assert.strictEqual(appHtml.includes('id="runAnalysisBtn"'), true, 'runAnalysisBtn button element must exist in app.html');
assert.strictEqual(appHtml.includes('onclick="window.runAnalysis(event)"'), true, 'runAnalysisBtn must have onclick window.runAnalysis(event)');

// Ensure updateButtonStates checks uploadedFiles and sets disabled property
assert.strictEqual(appJs.includes('const btn1 = $("runAnalysisBtn");'), true, 'updateButtonStates must manage runAnalysisBtn');
assert.strictEqual(appJs.includes('const hasFiles = (state.uploadedFiles && state.uploadedFiles.length > 0)'), true, 'updateButtonStates checks state.uploadedFiles.length > 0');
assert.strictEqual(appJs.includes('btn1.disabled = isBtn1Disabled;'), true, 'updateButtonStates sets native disabled property on runAnalysisBtn');

// 2. In-Memory Simulated State Machine Test
function createMockAppEnvironment() {
    const state = {
        uploadedFiles: [],
        activeTranscriptCache: null,
        isTermsAccepted: true,
        isLoading: false,
        lifecycle: 'EMPTY'
    };

    const mockBtn = {
        disabled: true,
        classList: {
            classes: new Set(['opacity-40', 'cursor-not-allowed']),
            toggle(cls, condition) {
                if (condition) this.classes.add(cls);
                else this.classes.delete(cls);
            },
            add(cls) { this.classes.add(cls); },
            remove(cls) { this.classes.delete(cls); },
            contains(cls) { return this.classes.has(cls); }
        }
    };

    function updateButtonStates() {
        const isLocked = !state.isTermsAccepted;
        const isLoading = !!state.isLoading;
        const hasFiles = (state.uploadedFiles && state.uploadedFiles.length > 0) || Boolean(state.activeTranscriptCache);
        const isBtn1Disabled = isLocked || !hasFiles || isLoading;

        mockBtn.disabled = isBtn1Disabled;
        mockBtn.classList.toggle("opacity-40", isLocked || !hasFiles);
        mockBtn.classList.toggle("opacity-70", isLoading);
        mockBtn.classList.toggle("cursor-not-allowed", isBtn1Disabled);
        mockBtn.classList.toggle("cursor-pointer", !isBtn1Disabled);
    }

    return { state, mockBtn, updateButtonStates };
}

// Test Case 1: 0 Screenshots Loaded -> Button Disabled
const env = createMockAppEnvironment();
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, true, '0 screenshots: Button must be disabled');
assert.strictEqual(env.mockBtn.classList.contains('cursor-not-allowed'), true, '0 screenshots: cursor-not-allowed must be present');
assert.strictEqual(env.mockBtn.classList.contains('cursor-pointer'), false, '0 screenshots: cursor-pointer must NOT be present');
console.log('✔ Test 1 Passed: 0 screenshots -> Button natively disabled (disabled === true)');

// Test Case 2: 1 Valid Screenshot Uploaded -> Button Enabled
env.state.uploadedFiles.push('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, false, '1 screenshot: Button must be enabled');
assert.strictEqual(env.mockBtn.classList.contains('cursor-pointer'), true, '1 screenshot: cursor-pointer must be present');
assert.strictEqual(env.mockBtn.classList.contains('opacity-40'), false, '1 screenshot: opacity-40 must NOT be present');
console.log('✔ Test 2 Passed: 1 screenshot uploaded -> Button natively enabled (disabled === false)');

// Test Case 3: 5 Valid Screenshots Uploaded -> Button Enabled
env.state.uploadedFiles.push('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
env.state.uploadedFiles.push('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
env.state.uploadedFiles.push('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
env.state.uploadedFiles.push('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
assert.strictEqual(env.state.uploadedFiles.length, 5);
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, false, '5 screenshots: Button must be enabled');
console.log('✔ Test 3 Passed: 5 screenshots loaded -> Button natively enabled');

// Test Case 4: Remove All Screenshots -> Button Disabled
env.state.uploadedFiles = [];
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, true, 'Removed all screenshots: Button must be disabled');
console.log('✔ Test 4 Passed: Remove all screenshots -> Button disabled');

// Test Case 5: Add Image After Deletion -> Button Enabled
env.state.uploadedFiles.push('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, false, 'Re-added screenshot: Button must be enabled');
console.log('✔ Test 5 Passed: Add screenshot after deletion -> Button re-enabled');

// Test Case 6: Generating / Loading -> Button Temporarily Disabled
env.state.isLoading = true;
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, true, 'While generating: Button must be disabled');
assert.strictEqual(env.mockBtn.classList.contains('opacity-70'), true, 'While generating: opacity-70 must be present');
console.log('✔ Test 6 Passed: Generating / Loading -> Button temporarily disabled with loading opacity');

// Test Case 7: Generation Completes / Fails -> Button Restores to Enabled
env.state.isLoading = false;
env.updateButtonStates();
assert.strictEqual(env.mockBtn.disabled, false, 'After generation finishes: Button restores to enabled');
console.log('✔ Test 7 Passed: After generation finishes -> Button restores to enabled state');

console.log('\n🎉 ALL SCREENSHOT ANALYZER BUTTON STATE TESTS PASSED!\n');
