const fs = require('fs');

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(oldText, newText);
}

// REFUND POLICY: production payments are currently disabled, so describe paid-payment rules conditionally.
let refund = fs.readFileSync('refund.html', 'utf8');
refund = replaceOnce(
  refund,
  '<p class="font-mono text-xs text-slate-400 mt-2">Effective Date: July 28, 2026</p>',
  '<p class="font-mono text-xs text-slate-400 mt-2">Effective Date: August 15, 2026</p>',
  'refund effective date'
);
refund = replaceOnce(
  refund,
  `                <p>\n                    MyWingman operates on a transparent digital credit wallet system. Users acquire credit bundles through authorized payment gateways:\n                </p>\n                <ul class="list-disc pl-5 space-y-1 text-slate-300 font-mono text-xs">\n                    <li><strong class="text-white">Starter Pack ($4.99):</strong> 250 Credits (25 Elite Chat Generations or 125 Practice Partner message turns).</li>\n                    <li><strong class="text-white">Pro Pack ($9.99):</strong> 600 Credits (60 Elite Chat Generations or 300 Practice Partner message turns).</li>\n                    <li><strong class="text-white">Elite Pack ($19.99):</strong> 3000 Credits (300 Elite Chat Generations or 1500 Practice Partner message turns).</li>\n                </ul>`,
  `                <p>\n                    MyWingman uses a digital credit wallet. <strong class="text-white">Paid credit checkout is currently paused/deferred and is not available in production.</strong> New registered accounts receive complimentary starting credits under the Terms of Service. The following bundles are an anticipated pricing schedule only and are not an offer to purchase while checkout remains disabled:\n                </p>\n                <ul class="list-disc pl-5 space-y-1 text-slate-300 font-mono text-xs">\n                    <li><strong class="text-white">Starter Pack (anticipated $4.99):</strong> 250 Credits.</li>\n                    <li><strong class="text-white">Pro Pack (anticipated $9.99):</strong> 600 Credits.</li>\n                    <li><strong class="text-white">Elite Pack (anticipated $19.99):</strong> 3000 Credits.</li>\n                </ul>`,
  'refund active purchase wording'
);
refund = replaceOnce(
  refund,
  `                <p>\n                    Credits that have been consumed for completed AI responses or chat turns are non-refundable due to immediate computational expenditure incurred by inference engine processing. Unused credits purchased in credit packs do not expire.\n                </p>\n                <p>\n                    Refunds for unconsumed purchases may be approved under the following verified conditions:\n                </p>\n                <ul class="list-disc pl-5 space-y-1 text-slate-300 font-mono text-xs">\n                    <li>Duplicate transactions caused by payment gateway communication errors.</li>\n                    <li>Verified technical crediting failures where a payment was successfully debited but credits failed to credit to your account wallet prior to credit usage.</li>\n                </ul>`,
  `                <p>\n                    Credits consumed for completed AI responses or chat turns are not restored except where required by applicable law or where MyWingman confirms a credit-ledger error. While paid checkout is disabled, no new paid purchase should be processed by MyWingman.\n                </p>\n                <p>\n                    If paid checkout is enabled in the future, refund eligibility for an actual successfully processed payment may include verified duplicate charges or a verified payment-crediting failure, subject to the checkout terms shown at that time and applicable law.\n                </p>`,
  'refund current payment conditions'
);
refund = replaceOnce(
  refund,
  `                <h2 class="font-headline text-lg font-bold text-white tracking-wide border-l-2 border-violet-500 pl-3">Section 3: Chargeback Mitigation & Transaction Verification</h2>\n                <p>\n                    To prevent fraudulent chargebacks and billing disputes, the platform maintains secure, immutable logs of payment transaction IDs, Google OAuth subject identifiers, credit allocation records, and feature consumption events. In the event of an unauthorized dispute filing with a banking institution or credit card issuer, these terms and transaction logs will be provided to demonstrate legitimate service fulfillment.\n                </p>`,
  `                <h2 class="font-headline text-lg font-bold text-white tracking-wide border-l-2 border-violet-500 pl-3">Section 3: Future Paid Transactions & Disputes</h2>\n                <p>\n                    If paid checkout is enabled in the future, MyWingman may retain relevant payment transaction identifiers, credit-allocation records, and dispute-related records as reasonably necessary for payment reconciliation, fraud prevention, accounting, dispute resolution, and applicable legal obligations. The Privacy Policy describes our data-handling practices. We do not describe these records as immutable.\n                </p>`,
  'refund immutable log claim'
);
fs.writeFileSync('refund.html', refund);

// PRIVACY POLICY: make billing language conditional and avoid rigid retention/legal-procedure claims we cannot guarantee.
let privacy = fs.readFileSync('privacy.html', 'utf8');
privacy = replaceOnce(
  privacy,
  `<p><strong class="text-white">b) Transactional & Billing Metadata:</strong> Unique payment transaction IDs, purchase amounts, currencies, payment statuses, and token purchase histories. Payment credentials such as full card numbers and banking passwords are processed directly through integrated payment service providers and are never stored on our servers.</p>`,
  `<p><strong class="text-white">b) Transactional & Billing Metadata:</strong> Paid checkout is currently disabled. If paid checkout is enabled in the future, we may process payment transaction identifiers, purchase amounts, currencies, payment statuses, and credit-purchase records needed to reconcile transactions. Payment credentials such as full card numbers or banking passwords should be handled by the applicable payment service provider rather than stored in our application database.</p>`,
  'privacy billing metadata'
);
privacy = replaceOnce(
  privacy,
  `<p><strong class="text-white">c) Security & System Logs:</strong> Retained for a limited window of up to ninety (90) days to detect server abuse and diagnose operational performance issues.</p>`,
  `<p><strong class="text-white">c) Security & System Logs:</strong> May be retained for a limited period reasonably necessary for security, abuse prevention, troubleshooting, and applicable legal obligations. Actual retention can also depend on infrastructure-provider settings.</p>`,
  'privacy log retention'
);
privacy = replaceOnce(
  privacy,
  `<p><strong class="text-white">d) Transactional Records:</strong> Billing transaction IDs and token pack summaries are preserved for up to seven (7) years to comply with statutory tax and legal accounting laws.</p>`,
  `<p><strong class="text-white">d) Transactional Records:</strong> If paid transactions are enabled, relevant billing records may be retained for the period reasonably necessary for accounting, tax, fraud prevention, dispute resolution, and applicable legal obligations.</p>`,
  'privacy transaction retention'
);
privacy = replaceOnce(
  privacy,
  `<p class="text-slate-400">• Resolution Procedures: <span class="text-white font-semibold">Responses to privacy inquiries and grievance redressals will be provided in a timely manner in accordance with DPDP Act 2023 procedures.</span></p>`,
  `<p class="text-slate-400">• Resolution Procedures: <span class="text-white font-semibold">We will respond to privacy inquiries and grievances in a timely manner in accordance with applicable law and the requirements in force at the relevant time.</span></p>`,
  'privacy grievance procedure'
);
fs.writeFileSync('privacy.html', privacy);

const test = `const assert = require('assert');\nconst fs = require('fs');\nconst path = require('path');\n\nconst refund = fs.readFileSync(path.join(__dirname, '..', 'refund.html'), 'utf8');\nconst privacy = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');\nconst server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');\n\nassert.ok(server.includes("if (IS_PROD || process.env.ENABLE_MOCK_PAYMENTS !== 'true')"), 'production payment verification must remain disabled');\nassert.ok(server.includes("Production payment gateway integration pending. Real payment gateway required."), 'payment endpoint must remain fail-closed');\nassert.ok(refund.includes('Paid credit checkout is currently paused/deferred and is not available in production.'), 'refund policy must disclose current payment availability');\nassert.ok(refund.includes('anticipated pricing schedule only'), 'listed future prices must not be presented as a live purchase offer');\nassert.ok(!refund.includes('Users acquire credit bundles through authorized payment gateways'), 'refund page must not claim active paid checkout');\nassert.ok(!refund.includes('secure, immutable logs'), 'refund page must not make an unsupported immutable-log claim');\nassert.ok(refund.includes('If paid checkout is enabled in the future'), 'refund/payment terms must be conditional while checkout is disabled');\n\nassert.ok(!privacy.includes('up to ninety (90) days'), 'privacy policy must not promise an unverified exact security-log period');\nassert.ok(!privacy.includes('up to seven (7) years'), 'privacy policy must not promise an unverified exact transaction-retention period');\nassert.ok(privacy.includes('Actual retention can also depend on infrastructure-provider settings.'), 'privacy policy must acknowledge infrastructure retention settings');\nassert.ok(privacy.includes('requirements in force at the relevant time'), 'grievance copy must avoid overclaiming a specific statutory procedure');\nassert.ok(privacy.includes('Paid checkout is currently disabled.'), 'billing privacy language must reflect production payment state');\n\nconsole.log('✔ Production legal/privacy accuracy guard passed.');\n`;
fs.writeFileSync('tests/legal_production_accuracy.test.js', test);

let runner = fs.readFileSync('tests/run_all_tests.js', 'utf8');
const anchor = `    { name: '30. Privileged Add-Credits Missing-Profile Guard', file: 'add_credits_profile_missing.test.js' }\n`;
if (!runner.includes(anchor)) throw new Error('Suite 30 anchor not found');
runner = runner.replace(anchor, `    { name: '30. Privileged Add-Credits Missing-Profile Guard', file: 'add_credits_profile_missing.test.js' },\n    { name: '31. Production Legal & Privacy Accuracy Guard', file: 'legal_production_accuracy.test.js' }\n`);
fs.writeFileSync('tests/run_all_tests.js', runner);

console.log('Legal/privacy production-accuracy patch applied.');
