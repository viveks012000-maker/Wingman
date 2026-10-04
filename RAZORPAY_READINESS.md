# Razorpay readiness deployment notes

This branch prepares the website and an isolated Test Mode integration. Production checkout and Live Mode remain disabled. No remote database migration or deployment has been performed by this work.

## Merchant information

- Operator / Merchant: Naresh Kumar
- Business type: Individual
- Brand: Wingman / MyWingman
- Support email: support.mywingman@gmail.com
- Support phone: +91 9079666632
- Address: Ward No. 6, Sadulpur, Churu, Rajasthan, India – 331023

These are owner-verified details. Do not invent additional address components. Any additional house/street detail requested by Razorpay is OWNER INPUT REQUIRED.

## Website-only deployment

The frontend artifact is `netlify-dist`, produced by `npm run build:production`. It includes About, Contact, Terms, Privacy, Refund/Cancellation and Service Delivery. Deploy the reviewed artifact through the existing approved Cloudflare Pages process after owner authorization. Preserve the canonical domain and existing auth configuration.

Public prices are INR customer totals: Starter ₹449 / 250 credits; Pro ₹899 / 600; Elite ₹1,799 / 3,000; VIP ₹4,499 / 100,000. No extra service/convenience fees or tax markups are added. TAX TREATMENT REQUIRES OWNER/ACCOUNTANT CONFIRMATION. Historical USD catalog numbers are retained but are inactive for checkout. The backend catalog controls amounts and entitlements.

## Test Mode gate

1. Use a separate test Supabase database and test user. Never point a test payment integration at customer wallets in the production database.
2. Replay all migrations, including `016_razorpay_payment_ledger.sql`, in disposable PostgreSQL. Run `npm run verify:migrations` and `node tests/razorpay_payments.test.js`. Docker is required by migration replay; its absence means NOT VERIFIED — DOCKER UNAVAILABLE.
3. Only after migration verification, configure server-side `RAZORPAY_KEY_ID` (Test Mode), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_SCHEMA_READY=true`, `RAZORPAY_PAYMENTS_ENABLED=true`. This branch rejects Live keys and any production NODE_ENV or Railway environment.
4. Configure automatic capture in the Razorpay Test Mode dashboard. Configure `/api/payments/webhook` on a reachable test backend for `payment.captured` and `order.paid`, using the matching webhook secret. Retain the old secret during provider retries if rotating secrets; rotation support needs operational planning before activation.
5. Exercise official Standard Checkout success/failure/cancellation; callback and webhook duplicates; browser-close recovery; tampered references; user ownership; captured versus authorized payments. Check provider records and SQL balances, not browser messages alone.
6. Live Mode needs a separate reviewed activation change after those tests pass, website approval and authorized deployment. Changing environment flags alone cannot activate Live Mode on this branch.

## Payment guarantees and limits

Orders derive amount/credits from trusted plan IDs. Checkout signatures use the server-stored order ID. The server fetches the payment and requires matching order, amount, currency and captured status before SQL fulfillment. The order lock, unique payment ID and transactional call to the existing credit RPC prevent repeat grants. Signed raw-body webhooks can reconcile a completed payment if the browser closes. The unit suite models the store contract; durable database behavior is not proven until migration replay passes.

The application has no automated refund endpoint. Operator refunds are handled through Razorpay's payment record to the original method after checking the cancellation policy, usage and receipt. Refund/chargeback webhooks are not implemented in this branch; do not use external refunds without manual ledger reconciliation. Before live activation, establish a verified process to identify purchased-credit usage, remove an approved refunded bundle exactly once without affecting unrelated credits, preserve the refund audit record, and reconcile partial refunds/chargebacks. Dashboard refund execution is an owner financial action.

## Submission

Razorpay currently requires website verification. The website submission form requests a dedicated reviewer username/email and password because Wingman purchases require login. Enter disposable reviewer credentials directly through a secure channel; never use a personal account or store them in source control. Submit only after corrected public pages are deployed and checked in the in-app browser. Confirm the actual digital-service category with Razorpay without disguising the dating-conversation coaching use case. Approval remains Razorpay's decision.

International application work was deferred at the owner's request and nothing was submitted.
