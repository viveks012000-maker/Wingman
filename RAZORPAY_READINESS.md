# Razorpay payment readiness

## Verified merchant status

Checked in the existing Razorpay account dashboard on 23 October 2026. The account shows **Access Complete**, and the registered `https://mywingmanapp.com/` website is **Approved**. An earlier dashboard review recorded an existing Test Mode API key, but this session could not confirm whether that secret remains configured or valid in Railway because the Railway connection requires reauthentication.

The Live Mode dashboard has no live API key listed and the webhook page has no configured webhook. The account's International Payments settings say that this business type is not supported for international card payments and that international bank transfers are not eligible under the risk policy. Razorpay presents a **Link Account** option for PayPal, described as collecting international currencies through Razorpay Checkout; it is not linked or verified for this merchant. These screens do not establish eligibility for live INR payments or direct USD collection. No key was generated, no webhook or PayPal account was linked, and no payment setting was changed during this check.

## Application behavior

Production paid checkout is disabled by default. The backend keeps separate Test, Live INR and Live USD modes and fails closed unless the matching server-side gates, credentials, schema, provider status and explicit approval are present. Test credentials cannot activate production checkout. Live USD requires a fixed server-side price map; the indicative exchange-rate display is never used to charge a customer. The VIP package remains separately gated pending commercial approval.

The published INR catalog remains Starter ₹449 / 250 credits, Pro ₹899 / 600 credits, Elite ₹1,799 / 3,000 credits and VIP ₹4,499 / 100,000 credits. USD amounts remain display-only. MyWingman does not add a service or convenience fee. Any applicable tax treatment must be confirmed and disclosed before checkout is enabled.

## Database and reconciliation

Migration `019_razorpay_live_modes_and_reconciliation.sql` is forward-only and additive to the existing order ledger. It records mode, currency, lifecycle, refund/dispute summaries and an operator-review flag; provider events retain their signed-payload hash and append-only evidence. Refund and dispute reconciliation does not subtract from a customer's aggregate balance. Any refund or dispute is queued for manual review so complimentary credits and already-used purchased credits are not misattributed.

The captured-payment path still verifies provider state and transactionally grants credits once. The authenticated recovery endpoint looks up the user's own pending order, checks authoritative provider state, and either safely fulfills an unrefunded capture or records an ambiguous/refunded case for review. There is no automated refund, dispute acceptance or balance clawback action.

## Activation requirements

Keep live checkout disabled until each applicable requirement is verified:

1. Confirm live INR payment eligibility and obtain an active live API key in the existing Razorpay account. Configure the key and webhook secret as Railway secrets without exposing them in source control or chat.
2. Configure the existing `/api/payments/webhook` endpoint once for the supported capture, refund and dispute events, then confirm the live webhook signature and account mapping.
3. Apply the payment migration through the approved Supabase release process and pass the disposable PostgreSQL migration replay and payment-ledger checks.
4. Pass the non-billable release checks and Razorpay Test Mode checkout, webhook replay and browser-close recovery checks.
5. Confirm the checkout tax treatment with the account owner/accountant and disclose it before enabling payment. Live configuration also requires `RAZORPAY_LIVE_TAX_APPROVED=true`.
6. Approve VIP pricing separately before making that bundle available for live purchase.
7. Do not enable direct USD collection unless Razorpay separately confirms direct USD settlement for this merchant. The dashboard shows PayPal as a possible Razorpay Checkout route for international currencies, but the owner must link and verify that account and confirm the required approval first. Keep the current USD selector display-only until then.

The Railway connection was unavailable for secret-status verification and deployment inspection in the current session. Do not infer the presence or validity of a production secret from the earlier Test Mode setup. Reconnect the existing Railway app integration before configuring or verifying deployment variables; never recreate a sealed variable.

## Safe Test Mode setup

Use only an isolated database and non-customer test user. Configure the explicit `RAZORPAY_TEST_*` variables and Test Mode webhook secret outside production. The legacy `RAZORPAY_KEY_*` aliases remain supported only for non-production compatibility. Never point a test transaction at production wallets, and do not set `RAZORPAY_PAYMENTS_ENABLED=true` until the isolated database migration and required tests pass.

The source template `.env.example` documents the payment flags. All activation flags remain false/disabled there; secret values are intentionally blank.
