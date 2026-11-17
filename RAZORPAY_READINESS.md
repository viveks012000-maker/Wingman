# Razorpay payment readiness

## Current verified status — 17 November 2026

- The authenticated Razorpay dashboard shows the account was activated on 3 October 2026 and **Account Access: Complete**.
- The dashboard shows domestic Visa, Mastercard, RuPay, and UPI as **Activated**. The owner confirms the MyWingman website is approved.
- A Live Mode API key is present in the dashboard. The secret is masked. Railway's `Wingman` production service has the three existing live credential variable names (`RAZORPAY_LIVE_KEY_ID`, `RAZORPAY_LIVE_KEY_SECRET`, and `RAZORPAY_LIVE_WEBHOOK_SECRET`). A no-charge Razorpay API authentication check using the existing Railway key pair succeeded: the probe requested a randomly generated nonexistent order ID and received a not-found response rather than an authentication rejection. No payment/customer data was retrieved or printed. No key was copied, rotated, or replaced.
- One enabled Razorpay webhook points to `https://wingman-production-c6ce.up.railway.app/api/payments/webhook`. It has 11 active events, including capture, refund, and dispute events. The secret is masked in the dashboard. The URL and event selection are verified; an end-to-end live webhook delivery was not triggered.
- The focused payment, reconciliation, checkout, readiness (desktop and mobile), credit, and Railway-environment regression checks passed. Supabase reports migration `019_razorpay_live_modes_and_reconciliation` applied; it was not rerun.
- A signed, unknown-event fixture was sent to the deployed production webhook using the existing Railway webhook secret. The endpoint returned HTTP 200 with `success: true` and `ignored: true`. The fixture is ignored before any store or provider operation, so it created no order, payment, event record, or credit change. This verifies that the live endpoint accepts the current Railway secret; it does **not** prove a Razorpay-generated event was delivered or that the masked Dashboard secret is byte-for-byte identical.
- `RAZORPAY_LIVE_PRECHECKS_PASSED=true` is now configured. Railway deployment `dd9ae1c9-b0ac-43d6-8521-47bf69ef99e6` is **SUCCESS** on `main` at `a4c9941493077299a5c35b7dd92b3d506fa13df9`.
- At that deployment snapshot, `/api/payments/config` returned `{success:true, enabled:false, mode:"disabled", currency:"INR", keyId:null, availablePlanIds:[]}` because `RAZORPAY_LIVE_TAX_APPROVED` and `RAZORPAY_PAYMENTS_ENABLED` were unset. No live order or payment was created or charged. Runtime status must be checked from `/api/payments/config` after any later activation.

The account's prior International Payments review said this business type is not supported for international card payments and international bank transfers are not eligible under the risk policy. Keep direct USD payment collection disabled. USD remains display-only.

## Application behavior

Production paid checkout is disabled by default. The backend keeps separate Test, Live INR and Live USD modes and fails closed unless the matching server-side gates, credentials, schema, provider status and explicit approval are present. Test credentials cannot activate production checkout. Live USD requires a fixed server-side price map; the indicative exchange-rate display is never used to charge a customer. The VIP package remains separately gated pending commercial approval.

The published INR catalog remains Starter ₹449 / 250 credits, Pro ₹899 / 600 credits, Elite ₹1,799 / 3,000 credits and VIP ₹4,499 / 100,000 credits. USD amounts remain display-only. MyWingman adds no service or convenience fee. Under the owner-declared facts below, the supplier is not GST-registered and does not collect GST; the listed INR prices are the full amounts payable.

## Database and reconciliation

Migration `019_razorpay_live_modes_and_reconciliation.sql` is forward-only and additive to the existing order ledger. It records mode, currency, lifecycle, refund/dispute summaries and an operator-review flag; provider events retain their signed-payload hash and append-only evidence. Refund and dispute reconciliation does not subtract from a customer's aggregate balance. Any refund or dispute is queued for manual review so complimentary credits and already-used purchased credits are not misattributed.

The captured-payment path still verifies provider state and transactionally grants credits once. The authenticated recovery endpoint looks up the user's own pending order, checks authoritative provider state, and either safely fulfills an unrefunded capture or records an ambiguous/refunded case for review. There is no automated refund, dispute acceptance or balance clawback action.

## Tax basis for the live INR price disclosure

- On 17 November 2026, the owner confirmed two separate facts: the supplier is not registered for GST, and aggregate turnover under the supplier's PAN did not exceed ₹20 lakh in FY 2025–26 or from 1 April 2026 through the date of confirmation. The owner explicitly said the calculation includes all businesses and inter-State/export supplies and excludes GST.
- Public Terms identify the supplier as Naresh Kumar, an individual trading as MyWingman, at an address in Churu, Rajasthan. The turnover and registration facts above are owner declarations; no PAN, GSTIN, tax return, or other private financial record was supplied for independent verification.
- CGST Act section 22 sets the ordinary-state registration threshold at aggregate turnover above ₹20 lakh. Notification 10/2017–Integrated Tax, issued under CGST Act section 23(2), also exempts qualifying suppliers of inter-State taxable services with all-India aggregate turnover not exceeding ₹20 lakh. Rajasthan is not a special-category State for this threshold. The described sale is MyWingman's own service through its own website, with Razorpay acting as payment processor; no third-party supplier marketplace or agency activity is known. On the facts supplied, no separate section 24 compulsory-registration category has been identified. This conclusion depends on those facts remaining accurate.
- CGST Act section 32 prohibits an unregistered person from collecting an amount as GST. Therefore, no GST is charged or displayed as a tax line; the published INR prices remain unchanged and are the full checkout totals. No GST rate or tax-inclusive breakdown is represented. Customer-facing pricing, Terms, Refund, Privacy, and Service Delivery copy now discloses this treatment and keeps USD payment collection disabled.
- `RAZORPAY_LIVE_TAX_APPROVED=true` is supportable for this documented treatment: MyWingman is currently unregistered and does not collect GST at the owner-confirmed below-threshold turnover. Reassess before further checkout if GST registration occurs, PAN-wide turnover crosses the applicable threshold, MyWingman begins marketplace/agency activity, or another compulsory-registration condition becomes applicable. This is an engineering readiness record based on the owner's declarations, not an independent tax audit.

The focused automated payment and UI checks passed on 17 November 2026. The separate no-charge API probe confirms the current Railway live key pair is accepted by Razorpay. The signed production fixture verified the application-side signature check without writing data. No Razorpay-generated webhook delivery, real payment, capture, or production credit fulfillment was performed. No credential was changed, replaced, or revoked.

## Official tax references checked

- [CGST Act, section 22 registration threshold](https://taxinformation.cbic.gov.in/content-page/explore-act/1000291/1000001)
- [Notification 10/2017-Integrated Tax for certain inter-State taxable service suppliers](https://cbic-gst.gov.in/hindi/pdf/integrated-tax/10_2017_IT.pdf)
- [CGST Act, section 32 prohibition on an unregistered person collecting GST](https://cbic-gst.gov.in/pdf/CGST-Act-Updated-01082021.pdf)
- [CBIC Circular 243/37/2024-GST on vouchers](https://gstcouncil.gov.in/sites/default/files/2025-01/circular-no-243-2024.pdf)
- [CBIC Circular 242/36/2024-GST on place of supply for online services to unregistered recipients](https://gstcouncil.gov.in/sites/default/files/2025-01/circular-no-242-2024.pdf)

## Safe Test Mode setup

Use only an isolated database and non-customer test user. Configure the explicit `RAZORPAY_TEST_*` variables and Test Mode webhook secret outside production. The legacy `RAZORPAY_KEY_*` aliases remain supported only for non-production compatibility. Never point a test transaction at production wallets, and do not set `RAZORPAY_PAYMENTS_ENABLED=true` until the isolated database migration and required tests pass.

The source template `.env.example` documents the payment flags. All activation flags remain false/disabled there; secret values are intentionally blank.
