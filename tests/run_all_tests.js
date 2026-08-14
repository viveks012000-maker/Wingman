const { execSync } = require('child_process');
const path = require('path');

const testSuites = [
    { name: '1. Final Technical Hardening Pass Verification', file: 'final_hardening_pass.test.js' },
    { name: '2. Codex Comprehensive Audit Verification', file: 'codex_audit_verification.test.js' },
    { name: '3. Core Hardening Verification Suite', file: 'hardening_verification.test.js' },
    { name: '4. Second Pass Adversarial Verification', file: 'second_pass_verification.test.js' },
    { name: '5. Node Security & Route Bounds Tests', file: 'security_node.test.js' },
    { name: '6. Credit Auto-Provisioning Suite', file: 'credits.test.js' },
    { name: '7. Screenshot Analyzer Button State Machine', file: 'analyzer_button_state.test.js' },
    { name: '8. Screenshot Analyzer Image Validation & Bounds', file: 'analyzer_image_validation.test.js' },
    { name: '9. Screenshot Analyzer AI Pipeline & Model Lock', file: 'analyzer_ai_pipeline.test.js' },
    { name: '10. Screenshot Analyzer State Machine & Idempotency', file: 'analyzer_credit_failure_zero_charge.test.js' },
    { name: '11. Exactly-Once 50-Credit & Missing Profile Safety', file: 'analyzer_exactly_once_credits.test.js' },
    { name: '12. Screenshot Analyzer Full End-to-End Integration', file: 'analyzer_full_e2e_integration.test.js' },
    { name: '13. Public SEO Files (robots.txt & sitemap.xml)', file: 'seo_files.test.js' },
    { name: '14. Security Hardening & Audit Verification', file: 'security_hardening_audit.test.js' }
];

console.log('========================================================================');
console.log('🚀 RUNNING ALL MYWINGMAN COMPREHENSIVE HARDENING & AUDIT TEST SUITES');
console.log('========================================================================\n');

let totalPassed = 0;
let totalFailed = 0;

for (const suite of testSuites) {
    const filePath = path.join(__dirname, suite.file);
    console.log(`\n▶ [SUITE] ${suite.name} (${suite.file})`);
    try {
        const output = execSync(`node "${filePath}"`, { stdio: 'pipe', encoding: 'utf8' });
        console.log(output.trim());
        totalPassed++;
    } catch (err) {
        console.error(`❌ FAILED: ${suite.name}`);
        if (err.stdout) console.log(err.stdout);
        if (err.stderr) console.error(err.stderr);
        totalFailed++;
    }
}

console.log('\n========================================================================');
console.log(`🏁 TEST SUITES COMPLETED: ${totalPassed} Passed, ${totalFailed} Failed`);
console.log('========================================================================\n');

if (totalFailed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
