# MyWingman payment and release checkpoint

**Updated:** 2026-10-30 (Asia/Kolkata)
**Repository:** viveks012000-maker/Wingman
**Branch:** codex/railway-environment-name-razorpay-activation

## Current verified production state

- Railway project: cooperative-nourishment (dda20725-30ef-4770-ab4e-d24a5c5cb5a3), production environment (30e98667-a8a1-415d-8cf1-55e670f45bd0), service Wingman (ce064d3b-9dcc-43d4-9a37-b99878fa18b1).
- Current production deployment: 7d78d229-d211-454a-bf3e-ac13a80c0160, SUCCESS, commit 611b374252b4f9c4011961db19d53582d799a39b (PR #179). Railway reports one running replica, no current warnings/failures, and no staged configuration changes. Do not accept the stale zero-change pending-work record surfaced by the status summary.
- Production service variable names were inspected without exposing values. They include AICredits and Supabase configuration, but no Razorpay key, webhook, mode, activation, tax, or readiness variables. No secret values were retrieved, printed, or copied.
- Production source at 611b374 requires payment enablement and schema flags before checkout. With no Razorpay variables present, paid checkout remains disabled. Do not claim live payments are operational.
- The existing Supabase migration 019_razorpay_live_modes_and_reconciliation was already applied. Its reconciliation functions and service-role-only access were previously verified. Do not rerun the migration or make production database writes for this release.
- The authenticated Razorpay session remains available. A current dashboard Home view showed no pending actions and no payment activity; it did not establish Live Mode approval. Earlier dashboard inspection showed domestic methods available, no live API key or webhook configured, and international cards unsupported for this business type. USD collection must remain disabled.

## Security gate

Railway's Oct 21 security disclosure says encrypted environment variables were accessed and a subset were decrypted; Railway recommends rotating sensitive variables. The owner received a direct Railway notice that this workspace may be at risk. This is a credible risk signal, not proof that any particular key was decrypted. Rotation status for the AICredits and Supabase server-side keys is unknown and cannot be verified from Railway's OAuth connection, which returns variable names only.

Official Railway references:

- https://blog.railway.com/p/security-disclosure-wednesday-october-21st
- https://blog.railway.com/p/preliminary-report-october-security-incident

Before a production code deployment or live payment activation:

1. Rotate both AICredits provider keys in the AICredits account, review provider usage/audit logs, and update the matching Railway variables securely.
2. Rotate the Supabase server-side service-role credential through the Supabase project, review Supabase audit/auth/database logs, and update Railway securely. Do not expose keys in chat, source, logs, or this checkpoint. The browser-facing anon key is public by design; do not treat it as a service-role secret.
3. Recheck the Railway and Supabase credential changes and verify the service still works after the coordinated update. Never redeploy with an old key after revocation.

The Railway and Supabase incident logs previously reviewed showed no confirmed successful unauthorized secret use, but absence of such evidence does not establish that stored credentials were not exposed. No production credentials have been rotated or changed as part of this code work.

## Code prepared locally

The branch contains the Railway environment identity correction using the provider's RAILWAY_ENVIRONMENT_NAME and RAILWAY_ENVIRONMENT_ID, plus the following current working-tree changes:

- Fixed display-only USD prices: $4.99, $9.99, $19.99, $49.99; removed reference-rate requests and dated/approximate pricing copy.
- Changed the 100,000-credit card badge to “LIMITED TIME,” per the owner's request. Confirm that a genuine limited-time offer is active before publishing this marketing claim.
- Fixed the desktop sidebar credit-card text/button layout while retaining the existing visual design.
- Made new USD checkout fail closed even if environment flags are set; INR remains the only potentially supported checkout currency.
- Updated focused regression/UI tests and patched dependency versions used by the security audit.

Do not include the pre-existing untracked work/ directory in a commit. The intended source files are tracked changes only. Do not merge into main or deploy the production service until the security gate above is resolved; merging to main triggers Railway production deployment.

## Verification

Most recent checks after the code changes:

- Full npm test: passed, 128 suites passed and 0 failed.
- Focused payment readiness, checkout, reconciliation, and mobile/sidebar checks passed.
- npm run verify:migrations passed; disposable Docker replay was unavailable. Production migration 019 is already applied.
- npm run build:netlify passed before the final release commit; rerun after the commit so the release manifest records its final SHA.
- Production dependency audit reported zero production vulnerabilities and no moderate-or-higher development findings.

The current source changes have not been merged or deployed. The production frontend remains on its existing release; the live website has not been used to run a real or sandbox payment. No real payment, refund, transfer, or credit change was performed.

## Remaining activation checks

- Confirm domestic INR live eligibility and capture settings in Razorpay; do not infer approval solely from website approval or available payment methods.
- Create exactly one correct production webhook only after confirming none exists; configure its secret securely and verify signature handling.
- Obtain a qualified owner/accountant determination for tax treatment. Never set the live tax approval flag without it.
- Keep USD payment collection disabled.
- Use isolated provider test mode and test database fixtures for checkout, ownership, signature, idempotency, failure/cancellation, refunds/disputes, and credit reconciliation. Never run a real-money test.
- Obtain the owner's explicit final confirmation immediately before exposing real INR checkout to customers.

After credential rotation, continue from the current branch, compare it with the latest main, rerun the build, push/open the PR through the existing GitHub workflow, and deploy only after the security, provider, tax, and owner-authorization gates are satisfied. Do not trigger a duplicate Cloudflare deployment; the Pages project currently has automatic deployments disabled.
