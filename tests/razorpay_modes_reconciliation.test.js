'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPaymentService, resolvePaymentConfig } = require('../middleware/razorpayPayments');

const baseLiveEnv = {
    NODE_ENV: 'production',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_ENVIRONMENT_ID: '30e98667-a8a1-415d-8cf1-55e670f45bd0',
    RAZORPAY_MODE: 'live_inr',
    RAZORPAY_PAYMENTS_ENABLED: 'true',
    RAZORPAY_SCHEMA_READY: 'true',
    RAZORPAY_RECONCILIATION_SCHEMA_READY: 'true',
    RAZORPAY_LIVE_INR_ELIGIBLE: 'true',
    RAZORPAY_LIVE_INR_APPROVED: 'true',
    RAZORPAY_LIVE_PRECHECKS_PASSED: 'true',
    RAZORPAY_LIVE_TAX_APPROVED: 'true',
    RAZORPAY_LIVE_WEBHOOK_CONFIGURED: 'true',
    RAZORPAY_LIVE_ACCOUNT_ID: 'acc_fixture',
    RAZORPAY_LIVE_KEY_ID: 'rzp_live_fixture',
    RAZORPAY_LIVE_KEY_SECRET: 'live_secret_fixture',
    RAZORPAY_LIVE_WEBHOOK_SECRET: 'live_webhook_fixture'
};
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex');

async function main() {
    const disabled = resolvePaymentConfig({ NODE_ENV: 'production' });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.mode, 'disabled');

    const testEnv = {
        RAZORPAY_MODE: 'test', RAZORPAY_PAYMENTS_ENABLED: 'true', RAZORPAY_SCHEMA_READY: 'true',
        RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'test_secret', RAZORPAY_WEBHOOK_SECRET: 'test_webhook'
    };
    assert.equal(resolvePaymentConfig(testEnv).mode, 'test');
    assert.equal(resolvePaymentConfig({ ...testEnv, NODE_ENV: 'production' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_LIVE_WEBHOOK_CONFIGURED: 'false' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_LIVE_TAX_APPROVED: 'false' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_LIVE_INR_ELIGIBLE: 'false' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_LIVE_KEY_ID: 'rzp_test_fixture' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_LIVE_KEY_SECRET: '' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_RECONCILIATION_SCHEMA_READY: 'false' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAILWAY_ENVIRONMENT_NAME: 'razorpay-staging', RAILWAY_ENVIRONMENT_ID: '438d986c-d799-42a0-9149-ef0eef809486' }).enabled, false);
    assert.equal(resolvePaymentConfig({ ...baseLiveEnv, RAILWAY_ENVIRONMENT: 'production', RAILWAY_ENVIRONMENT_NAME: undefined, RAILWAY_ENVIRONMENT_ID: undefined }).enabled, false,
        'the obsolete environment variable cannot authorize live payments without Railway-provided identity');
    const live = resolvePaymentConfig(baseLiveEnv);
    assert.equal(live.enabled, true);
    assert.equal(live.mode, 'live_inr');
    assert.equal(live.currency, 'INR');
    assert.equal(live.keyId, baseLiveEnv.RAZORPAY_LIVE_KEY_ID);
    assert(!JSON.stringify(live).includes(baseLiveEnv.RAZORPAY_LIVE_KEY_SECRET));
    assert(!live.availablePlanIds.includes('limited'));
    assert(resolvePaymentConfig({ ...baseLiveEnv, RAZORPAY_LIVE_VIP_APPROVED: 'true' }).availablePlanIds.includes('limited'));

    const usdEnv = {
        ...baseLiveEnv,
        RAZORPAY_MODE: 'live_usd',
        RAZORPAY_LIVE_USD_ELIGIBLE: 'true',
        RAZORPAY_LIVE_USD_APPROVED: 'true',
        RAZORPAY_LIVE_KEY_ID: 'rzp_live_usdfixture',
        RAZORPAY_LIVE_USD_PRICES_JSON: '{"starter":499,"pro":999,"elite":1999,"limited":4999}'
    };
    const liveUsd = resolvePaymentConfig(usdEnv);
    assert.equal(liveUsd.enabled, true);
    assert.equal(liveUsd.mode, 'live_usd');
    assert.equal(liveUsd.currency, 'USD');
    assert.equal(liveUsd.usdPrices.starter, 499);
    for (const prices of ['{"starter":499}', '{"starter":499,"pro":0,"elite":1999,"limited":4999}', '{"starter":499.5,"pro":999,"elite":1999,"limited":4999}', 'not-json']) {
        assert.equal(resolvePaymentConfig({ ...usdEnv, RAZORPAY_LIVE_USD_PRICES_JSON: prices }).enabled, false);
    }
    assert.equal(resolvePaymentConfig({ ...usdEnv, RAZORPAY_LIVE_USD_APPROVED: 'false' }).enabled, false);

    let created = null;
    const noOpStore = {
        async insertOrder(order) { created = order; },
        async findOrder() { return null; },
        async fulfill() { throw new Error('unexpected fulfillment'); },
        async recordEvent() { throw new Error('unexpected event'); },
        async recordReconciliation() { throw new Error('unexpected reconciliation'); }
    };
    let providerOrderPayload;
    const provider = async (url, options) => {
        if (url.endsWith('/orders')) {
            providerOrderPayload = JSON.parse(options.body);
            return { ok: true, json: async () => ({ ...providerOrderPayload, id: 'order_live' }) };
        }
        throw new Error('unexpected provider request ' + url);
    };
    const liveService = createPaymentService({ env: baseLiveEnv, store: noOpStore, fetchImpl: provider });
    const createdLive = await liveService.createOrder('owner', { planId: 'starter', amount: 1, credits: 999999 });
    assert.equal(providerOrderPayload.amount, 44900);
    assert.equal(providerOrderPayload.currency, 'INR');
    assert.equal(createdLive.mode, 'live_inr');
    assert.equal(createdLive.amount, 44900);
    assert.equal(created.order_id, 'order_live');
    assert.equal(created.mode, 'live_inr');
    await assert.rejects(liveService.createOrder('owner', { planId: 'limited' }), { status: 403 });

    let usdOrderPayload;
    const usdService = createPaymentService({ env: usdEnv, store: noOpStore, fetchImpl: async (url, options) => {
        usdOrderPayload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ ...usdOrderPayload, id: 'order_usd' }) };
    } });
    const createdUsd = await usdService.createOrder('owner', { planId: 'starter', currency: 'USD' });
    assert.equal(usdOrderPayload.amount, 499);
    assert.equal(usdOrderPayload.currency, 'USD');
    assert.equal(createdUsd.currency, 'USD');
    assert.equal(createdUsd.mode, 'live_usd');
    assert.equal(usdService.config().usdPrices, undefined, 'the public config endpoint must not expose internal price-map configuration');

    let reconciled = null;
    let walletCredits = 300;
    let fulfillCount = 0;
    const order = {
        order_id: 'order_live', user_id: 'owner', plan_id: 'starter', credits: 250,
        amount_minor: 44900, currency: 'INR', mode: 'live_inr', payment_id: null, status: 'pending'
    };
    const store = {
        async insertOrder() {},
        async findOrder(id) { return id === order.order_id ? order : null; },
        async fulfill(id, paymentId) { fulfillCount++; order.payment_id = paymentId; order.status = 'fulfilled'; walletCredits += 250; return { success: true, credits: walletCredits }; },
        async recordEvent() { return { success: true }; },
        async recordReconciliation(entry) { reconciled = entry; return { success: true, reviewRequired: entry.forceReview === true }; }
    };
    const livePayment = { id: 'pay_live', order_id: order.order_id, amount: 44900, currency: 'INR', status: 'captured', captured: true, amount_refunded: 10000 };
    let refundStatus = 'processed';
    let disputeProviderStatus = 'under_review';
    const calls = [];
    const refundProvider = async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.endsWith('/refunds/rfnd_live') || url.endsWith('/refunds/rfnd_created') || url.endsWith('/refunds/rfnd_failed')) {
            const id = url.slice(url.lastIndexOf('/') + 1);
            return { ok: true, json: async () => ({ id, payment_id: 'pay_live', amount: id === 'rfnd_live' ? 10000 : 1000, currency: 'INR', status: id === 'rfnd_live' ? 'processed' : refundStatus }) };
        }
        if (url.endsWith('/payments/pay_live')) return { ok: true, json: async () => livePayment };
        if (url.endsWith('/payments/pay_live/refunds?count=100')) return { ok: true, json: async () => ({ items: [
            { id: 'rfnd_live', payment_id: 'pay_live', amount: 10000, currency: 'INR', status: 'processed' },
            ...(refundStatus === 'processed' ? [] : [{ id: refundStatus === 'failed' ? 'rfnd_failed' : 'rfnd_created', payment_id: 'pay_live', amount: 1000, currency: 'INR', status: refundStatus }])
        ], has_more: false }) };
        if (url.endsWith('/disputes/disp_live')) return { ok: true, json: async () => ({ id: 'disp_live', payment_id: 'pay_live', amount: 44900, currency: 'INR', status: disputeProviderStatus }) };
        throw new Error('unexpected provider request ' + url);
    };
    const reconService = createPaymentService({ env: baseLiveEnv, store, fetchImpl: refundProvider });
    const refundBody = Buffer.from(JSON.stringify({ event: 'refund.processed', account_id: 'acc_fixture', created_at: 1792771200, payload: { refund: { entity: { id: 'rfnd_live' } } } }));
    const refundResult = await reconService.webhook(refundBody, sign(refundBody, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), 'evt_refund_live');
    assert.equal(refundResult.success, true);
    assert.equal(reconciled.eventType, 'refund.processed');
    assert.equal(reconciled.refundedTotalMinor, 10000);
    assert.equal(reconciled.paymentId, 'pay_live');
    assert.equal(walletCredits, 300, 'refund reconciliation must never mutate aggregate wallet credits');
    assert.equal(fulfillCount, 0);
    assert(calls.every(call => call.method === 'GET'), 'refund processing must never issue money');

    for (const [status, eventName, refundId] of [
        ['created', 'refund.created', 'rfnd_created'],
        ['failed', 'refund.failed', 'rfnd_failed']
    ]) {
        refundStatus = status;
        const body = Buffer.from(JSON.stringify({ event: eventName, account_id: 'acc_fixture', created_at: 1792771200, payload: { refund: { entity: { id: refundId } } } }));
        const result = await reconService.webhook(body, sign(body, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), `evt_${status}`);
        assert.equal(result.success, true);
        assert.equal(result.reviewRequired, true, `${status} refunds must remain in the operator review queue`);
        assert.equal(reconciled.eventType, eventName);
        assert.equal(reconciled.providerStatus, status);
        assert.equal(reconciled.refundedTotalMinor, 10000, 'pending/failed refunds must not increase successfully refunded totals');
    }
    refundStatus = 'processed';

    for (const state of ['created', 'under_review', 'action_required', 'won', 'lost', 'closed']) {
        disputeProviderStatus = state;
        const disputeBody = Buffer.from(JSON.stringify({ event: `payment.dispute.${state}`, account_id: 'acc_fixture', created_at: 1792771200, payload: { dispute: { entity: { id: 'disp_live' } } } }));
        await reconService.webhook(disputeBody, sign(disputeBody, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), `evt_dispute_${state}`);
        assert.equal(reconciled.eventType, `payment.dispute.${state}`);
        assert.equal(reconciled.disputeState, state);
    }
    assert.equal(walletCredits, 300);
    const wrongAccount = Buffer.from(JSON.stringify({ event: 'refund.processed', account_id: 'acc_other', payload: { refund: { entity: { id: 'refund_live' } } } }));
    await assert.rejects(reconService.webhook(wrongAccount, sign(wrongAccount, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), 'evt_wrong_account'), { status: 400 });
    const missingAccount = Buffer.from(JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_live' } } } }));
    await assert.rejects(reconService.webhook(missingAccount, sign(missingAccount, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), 'evt_missing_account'), { status: 400 });

    const refundedCapturePayment = { ...livePayment, status: 'refunded', amount_refunded: 44900 };
    const refundedCaptureProvider = async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.endsWith('/payments/pay_live')) return { ok: true, json: async () => refundedCapturePayment };
        if (url.endsWith('/payments/pay_live/refunds?count=100')) return { ok: true, json: async () => ({ items: [{ id: 'rfnd_full', payment_id: 'pay_live', amount: 44900, currency: 'INR', status: 'processed' }], has_more: false }) };
        throw new Error('unexpected provider request ' + url);
    };
    const refundedCaptureService = createPaymentService({ env: baseLiveEnv, store, fetchImpl: refundedCaptureProvider });
    const captureBody = Buffer.from(JSON.stringify({ event: 'payment.captured', account_id: 'acc_fixture', created_at: 1792771200, payload: { payment: { entity: { id: 'pay_live', order_id: 'order_live' } } } }));
    const captureResult = await refundedCaptureService.webhook(captureBody, sign(captureBody, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), 'evt_capture_after_refund');
    assert.equal(captureResult.reviewRequired, true, 'an out-of-order capture event for a refunded payment must be reviewed');
    assert.equal(reconciled.eventType, 'payment.captured');
    assert.equal(reconciled.refundedTotalMinor, 44900);
    assert.equal(walletCredits, 300, 'out-of-order refunded capture must never grant credits');
    assert.equal(fulfillCount, 0);

    const pausedLiveEnv = { ...baseLiveEnv, RAZORPAY_PAYMENTS_ENABLED: 'false', RAZORPAY_LIVE_INR_ELIGIBLE: 'false', RAZORPAY_LIVE_INR_APPROVED: 'false', RAZORPAY_LIVE_WEBHOOK_CONFIGURED: 'false' };
    const pausedWebhookService = createPaymentService({ env: pausedLiveEnv, store, fetchImpl: refundProvider });
    const pausedEvent = Buffer.from(JSON.stringify({ event: 'payment.dispute.closed', account_id: 'acc_fixture', payload: { dispute: { entity: { id: 'disp_live' } } } }));
    await pausedWebhookService.webhook(pausedEvent, sign(pausedEvent, baseLiveEnv.RAZORPAY_LIVE_WEBHOOK_SECRET), 'evt_paused_live');
    assert.equal(reconciled.disputeState, 'closed', 'disabling new checkout must not strand reconciliation for existing live orders');

    let recoveryRefunded = false;
    const recoverOrder = { ...order, payment_id: null, status: 'pending' };
    const recoveryStore = {
        async findOrder(id) { return id === recoverOrder.order_id ? recoverOrder : null; },
        async fulfill(id, paymentId) { fulfillCount++; recoverOrder.payment_id = paymentId; recoverOrder.status = 'fulfilled'; walletCredits += 250; return { success: true, credits: walletCredits }; },
        async recordReconciliation(entry) { reconciled = entry; return { success: true, reviewRequired: true }; },
        async recordEvent() {}, async insertOrder() {}
    };
    const recoveryProvider = async (url) => {
        if (url.endsWith('/orders/order_live/payments?count=100')) return { ok: true, json: async () => ({ items: [{ id: 'pay_live', order_id: 'order_live', status: 'captured' }] }) };
        if (url.endsWith('/payments/pay_live')) return { ok: true, json: async () => ({ ...livePayment, status: recoveryRefunded ? 'refunded' : 'captured', amount_refunded: recoveryRefunded ? 44900 : 0 }) };
        if (url.endsWith('/payments/pay_live/refunds?count=100')) return { ok: true, json: async () => ({ items: recoveryRefunded ? [{ id: 'rfnd_live', payment_id: 'pay_live', amount: 44900, currency: 'INR', status: 'processed' }] : [], has_more: false }) };
        throw new Error('unexpected provider request ' + url);
    };
    const recoveryService = createPaymentService({ env: baseLiveEnv, store: recoveryStore, fetchImpl: recoveryProvider });
    const recovered = await recoveryService.reconcile('owner', { orderId: 'order_live' });
    assert.equal(recovered.success, true);
    assert.equal(recovered.reconciled, true);
    assert.equal(recoverOrder.status, 'fulfilled');
    recoveryRefunded = true;
    const refundedRecovery = await recoveryService.reconcile('owner', { orderId: 'order_live' });
    assert.equal(refundedRecovery.reviewRequired, true);
    assert.equal(fulfillCount, 1, 'refunded recovery must not issue a credit grant');
    assert.equal(walletCredits, 550, 'only the captured, unrefunded recovery may grant credits');

    const pendingOrder = { ...order, order_id: 'order_pending', payment_id: null, status: 'pending' };
    let refundRowStatus = 'created';
    let pendingGrants = 0;
    const pendingEntries = [];
    const pendingRecoveryStore = {
        async findOrder(id) { return id === pendingOrder.order_id ? pendingOrder : null; },
        async fulfill() { pendingGrants++; throw new Error('pending refund must not be auto-fulfilled'); },
        async recordReconciliation(entry) {
            pendingEntries.push(entry);
            return { success: true, reviewRequired: entry.forceReview === true };
        },
        async recordEvent() {}, async insertOrder() {}
    };
    const pendingRecoveryProvider = async (url) => {
        if (url.endsWith(`/orders/${pendingOrder.order_id}/payments?count=100`)) return { ok: true, json: async () => ({ items: [{ id: 'pay_pending', order_id: pendingOrder.order_id, status: 'captured' }] }) };
        if (url.endsWith('/payments/pay_pending')) return { ok: true, json: async () => ({ id: 'pay_pending', order_id: pendingOrder.order_id, amount: 44900, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0 }) };
        if (url.endsWith('/payments/pay_pending/refunds?count=100')) return { ok: true, json: async () => ({ items: [{ id: 'rfnd_pending', payment_id: 'pay_pending', amount: 1000, currency: 'INR', status: refundRowStatus }], has_more: false }) };
        throw new Error('unexpected provider request ' + url);
    };
    const pendingRecoveryService = createPaymentService({ env: baseLiveEnv, store: pendingRecoveryStore, fetchImpl: pendingRecoveryProvider });
    const pendingResult = await pendingRecoveryService.reconcile('owner', { orderId: pendingOrder.order_id });
    assert.equal(pendingResult.reviewRequired, true, 'an outstanding refund must be reviewed before credit fulfillment');
    assert.equal(pendingEntries[0].providerStatus, 'refund_pending');
    assert.equal(pendingGrants, 0);
    refundRowStatus = 'failed';
    const failedResult = await pendingRecoveryService.reconcile('owner', { orderId: pendingOrder.order_id });
    assert.equal(failedResult.reviewRequired, true);
    assert.equal(pendingEntries[1].providerStatus, 'refund_failed');
    assert.notEqual(pendingEntries[0].eventId, pendingEntries[1].eventId, 'changed refund state must append a distinct reconciliation record');
    assert.equal(pendingGrants, 0, 'failed refund recovery remains review-first');
    console.log('PASS: independent payment activation gates, exact mode-scoped prices, refund/dispute webhook verification, and safe recovery.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
