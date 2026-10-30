'use strict';

const crypto = require('crypto');
const { PRICING_CATALOG } = require('../config/pricingCatalog');
const { isProductionRuntime, isProductionRailwayEnvironment } = require('./railwayEnvironment');

class PaymentError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const PAYMENT_MODES = new Set(['test', 'live_inr', 'live_usd']);
const REFUND_EVENTS = new Set(['refund.created', 'refund.processed', 'refund.failed']);
const DISPUTE_EVENTS = new Set([
    'payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required',
    'payment.dispute.won', 'payment.dispute.lost', 'payment.dispute.closed'
]);
const DISPUTE_STATES = new Set(['created', 'under_review', 'action_required', 'won', 'lost', 'closed']);

function validId(value, prefix) {
    return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);
}
function signatureMatches(body, signature, secret) {
    if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
function isProduction(env) {
    return isProductionRuntime(env);
}
function validCredentialPair(keyId, keySecret, prefix) {
    return typeof keyId === 'string' && new RegExp(`^rzp_${prefix}_[A-Za-z0-9]+$`).test(keyId) &&
        typeof keySecret === 'string' && keySecret.length >= 8;
}
function testCredentials(env = process.env) {
    const keyId = env.RAZORPAY_TEST_KEY_ID || env.RAZORPAY_KEY_ID || '';
    const keySecret = env.RAZORPAY_TEST_KEY_SECRET || env.RAZORPAY_KEY_SECRET || '';
    const webhookSecret = env.RAZORPAY_TEST_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET || '';
    if (isProduction(env) || !validCredentialPair(keyId, keySecret, 'test') || typeof webhookSecret !== 'string' || webhookSecret.length < 8) return null;
    return { keyId, keySecret, webhookSecret };
}
function liveCredentials(env = process.env) {
    const keyId = env.RAZORPAY_LIVE_KEY_ID || '';
    const keySecret = env.RAZORPAY_LIVE_KEY_SECRET || '';
    const webhookSecret = env.RAZORPAY_LIVE_WEBHOOK_SECRET || '';
    if (!validCredentialPair(keyId, keySecret, 'live') || typeof webhookSecret !== 'string' || webhookSecret.length < 8) return null;
    return { keyId, keySecret, webhookSecret };
}
function disabledConfig() {
    return { enabled: false, mode: 'disabled', currency: 'INR', keyId: null, availablePlanIds: [] };
}
function resolvePaymentConfig(env = process.env) {
    if (!env || env.RAZORPAY_PAYMENTS_ENABLED !== 'true' || env.RAZORPAY_SCHEMA_READY !== 'true') return disabledConfig();
    const requestedMode = env.RAZORPAY_MODE || (testCredentials(env) ? 'test' : 'disabled');
    // This merchant is not approved for international USD collection. USD prices are
    // display-only, so no environment-variable combination can enable new USD orders.
    if (requestedMode === 'live_usd') return disabledConfig();
    if (requestedMode === 'test') {
        const credentials = testCredentials(env);
        if (!credentials) return disabledConfig();
        return {
            enabled: true, mode: 'test', currency: 'INR', keyId: credentials.keyId,
            availablePlanIds: Object.keys(PRICING_CATALOG)
        };
    }
    if (env.NODE_ENV !== 'production' || !isProductionRailwayEnvironment(env) || env.RAZORPAY_RECONCILIATION_SCHEMA_READY !== 'true' ||
        env.RAZORPAY_LIVE_PRECHECKS_PASSED !== 'true' || env.RAZORPAY_LIVE_TAX_APPROVED !== 'true' ||
        env.RAZORPAY_LIVE_ACCOUNT_ID && !/^acc_[A-Za-z0-9]{1,64}$/.test(env.RAZORPAY_LIVE_ACCOUNT_ID)) {
        return disabledConfig();
    }
    const credentials = liveCredentials(env);
    if (!credentials || env.RAZORPAY_LIVE_WEBHOOK_CONFIGURED !== 'true') return disabledConfig();

    if (requestedMode === 'live_inr') {
        if (env.RAZORPAY_LIVE_INR_ELIGIBLE !== 'true' || env.RAZORPAY_LIVE_INR_APPROVED !== 'true' || !/^acc_[A-Za-z0-9]{1,64}$/.test(env.RAZORPAY_LIVE_ACCOUNT_ID || '')) return disabledConfig();
        const availablePlanIds = Object.keys(PRICING_CATALOG).filter(id => id !== 'limited' || env.RAZORPAY_LIVE_VIP_APPROVED === 'true');
        return { enabled: true, mode: 'live_inr', currency: 'INR', keyId: credentials.keyId, availablePlanIds };
    }
    return disabledConfig();
}
function testConfig(env = process.env) {
    const config = resolvePaymentConfig(env);
    return config.enabled === true && config.mode === 'test';
}
function credentialsForMode(mode, env = process.env) {
    if (mode === 'test') return testCredentials(env);
    if (mode === 'live_inr' || mode === 'live_usd') {
        // Existing live orders still need signature verification, webhook processing,
        // and customer recovery after new checkout has been disabled. Activation
        // approvals gate resolvePaymentConfig(); these checks only authorize access to
        // the separately scoped credentials for an already persisted live order.
        if (env.NODE_ENV !== 'production' || !isProductionRailwayEnvironment(env) ||
            env.RAZORPAY_RECONCILIATION_SCHEMA_READY !== 'true' ||
            !/^acc_[A-Za-z0-9]{1,64}$/.test(env.RAZORPAY_LIVE_ACCOUNT_ID || '')) return null;
        const credentials = liveCredentials(env);
        if (!credentials) return null;
        return credentials;
    }
    return null;
}

function requirePaymentAuth(client) {
    // Payment ownership always comes from Supabase, including in development.
    // Never reuse identities supplied by the application's development mock headers.
    return async function (req, res, next) {
        const header = req.headers.authorization;
        const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (token.split('.').length !== 3 || token.split('.').some(part => !part)) {
            return res.status(401).json({ success: false, error: 'Please sign in to purchase credits.' });
        }
        if (!client || !client.auth) return res.status(503).json({ success: false, error: 'Payment authentication is unavailable.' });
        try {
            const { data, error } = await client.auth.getUser(token);
            if (error || !data || !data.user || !data.user.id) throw new Error('Invalid session');
            req.user = { id: String(data.user.id), email: data.user.email || '' };
            return next();
        } catch (_) {
            return res.status(401).json({ success: false, error: 'Please sign in to purchase credits.' });
        }
    };
}

function providerItems(response) {
    if (response && Array.isArray(response.items)) return response.items;
    if (response && Array.isArray(response.data)) return response.data;
    return null;
}
function safeEventTime(value) {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function disputeState(status, eventType) {
    const normalized = typeof status === 'string' ? status.toLowerCase() : '';
    if (DISPUTE_STATES.has(normalized)) return normalized;
    const eventState = eventType.replace('payment.dispute.', '');
    return DISPUTE_STATES.has(eventState) ? eventState : null;
}

function createPaymentService({ store, env = process.env, fetchImpl = fetch }) {
    function requireReady() {
        const config = resolvePaymentConfig(env);
        if (!store || !config.enabled) throw new PaymentError(503, 'Paid checkout is unavailable.');
        return config;
    }
    async function api(mode, endpoint, method = 'GET', body) {
        const credentials = credentialsForMode(mode, env);
        if (!credentials) throw new PaymentError(503, 'Payment provider credentials are unavailable.');
        let resource;
        if (endpoint === 'orders' && method === 'POST') resource = 'orders';
        else if (/^orders\/order_[A-Za-z0-9]{1,64}\/payments\?count=100$/.test(endpoint)) resource = endpoint;
        else if (/^payments\/pay_[A-Za-z0-9]{1,64}$/.test(endpoint)) resource = endpoint;
        else if (/^payments\/pay_[A-Za-z0-9]{1,64}\/refunds\?count=100$/.test(endpoint)) resource = endpoint;
        else if (/^refunds\/rfnd_[A-Za-z0-9]{1,64}$/.test(endpoint)) resource = endpoint;
        else if (/^disputes\/disp_[A-Za-z0-9]{1,64}$/.test(endpoint)) resource = endpoint;
        else throw new PaymentError(400, 'Invalid payment resource.');
        const response = await fetchImpl(`https://api.razorpay.com/v1/${resource}`, {
            method,
            redirect: 'error',
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64'),
                'Content-Type': 'application/json'
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new PaymentError(502, 'Payment provider is unavailable. Please try again later.');
        try { return await response.json(); }
        catch (_) { throw new PaymentError(502, 'Payment provider returned an invalid response.'); }
    }
    function requireOrderCredentials(order) {
        if (!order || !PAYMENT_MODES.has(order.mode) || !credentialsForMode(order.mode, env)) {
            throw new PaymentError(503, 'Payment provider credentials are unavailable.');
        }
        if ((order.mode === 'test' && order.currency !== 'INR') ||
            (order.mode === 'live_inr' && order.currency !== 'INR') ||
            (order.mode === 'live_usd' && order.currency !== 'USD')) throw new PaymentError(409, 'Purchase configuration does not match.');
        return order.mode;
    }
    function validatePaymentForOrder(payment, order) {
        if (!payment || payment.id !== order.payment_id && order.payment_id || payment.order_id !== order.order_id ||
            payment.amount !== order.amount_minor || payment.currency !== order.currency) {
            throw new PaymentError(400, 'Payment does not match this purchase.');
        }
    }
    async function createOrder(userId, input = {}) {
        const config = requireReady();
        if (!userId) throw new PaymentError(401, 'Please sign in.');
        const plan = typeof input.planId === 'string' && Object.hasOwn(PRICING_CATALOG, input.planId) ? PRICING_CATALOG[input.planId] : null;
        if (!plan) throw new PaymentError(400, 'Select a valid credit bundle.');
        if (!config.availablePlanIds.includes(plan.id)) throw new PaymentError(403, 'This credit bundle is not currently available for checkout.');
        if (Object.hasOwn(input, 'currency') && input.currency !== config.currency) throw new PaymentError(400, `Select a valid ${config.currency} credit bundle.`);
        const amount = plan.prices.INR.amountMinor;
        const receipt = crypto.randomUUID();
        const order = await api(config.mode, 'orders', 'POST', { amount, currency: config.currency, receipt });
        if (!order || !validId(order.id, 'order') || order.amount !== amount || order.currency !== config.currency || order.receipt !== receipt) {
            throw new PaymentError(502, 'Payment provider returned an invalid order.');
        }
        await store.insertOrder({
            order_id: order.id, user_id: userId, plan_id: plan.id, credits: plan.credits,
            amount_minor: amount, currency: config.currency, mode: config.mode, receipt
        });
        return { orderId: order.id, amount, currency: config.currency, credits: plan.credits, name: plan.name, keyId: config.keyId, mode: config.mode };
    }
    async function fulfill(order, paymentId, confirmedPayment = null) {
        const mode = requireOrderCredentials(order);
        const payment = confirmedPayment || await api(mode, `payments/${paymentId}`);
        validatePaymentForOrder(payment, { ...order, payment_id: paymentId });
        const refundedAmount = payment.amount_refunded === undefined || payment.amount_refunded === null ? 0 : payment.amount_refunded;
        if (!Number.isSafeInteger(refundedAmount) || refundedAmount < 0 || refundedAmount > payment.amount) {
            throw new PaymentError(502, 'Payment provider returned an invalid refund total.');
        }
        if (payment.status !== 'captured' || payment.captured !== true || refundedAmount !== 0) {
            throw new PaymentError(409, 'Payment is not ready for credit delivery. Contact support if you were charged.');
        }
        // The database transaction locks the order, binds the unique provider payment ID,
        // records purchase provenance, and grants credits exactly once.
        return store.fulfill(order.order_id, paymentId, order.amount_minor, order.currency);
    }
    async function verify(userId, input = {}) {
        if (!store || env.RAZORPAY_SCHEMA_READY !== 'true') throw new PaymentError(503, 'Paid checkout is unavailable.');
        if (!userId) throw new PaymentError(401, 'Please sign in.');
        const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = input;
        if (!validId(orderId, 'order') || !validId(paymentId, 'pay')) throw new PaymentError(400, 'Invalid payment reference.');
        const order = await store.findOrder(orderId);
        if (!order || order.user_id !== userId) throw new PaymentError(404, 'Purchase not found.');
        const mode = requireOrderCredentials(order);
        const credentials = credentialsForMode(mode, env);
        if (!signatureMatches(`${order.order_id}|${paymentId}`, signature, credentials.keySecret)) throw new PaymentError(400, 'Invalid payment signature.');
        return fulfill(order, paymentId);
    }
    async function recordReconciliation(order, details) {
        if (typeof store.recordReconciliation !== 'function') throw new PaymentError(503, 'Payment reconciliation storage is unavailable.');
        return store.recordReconciliation({
            eventId: details.eventId,
            eventType: details.eventType,
            mode: order.mode,
            orderId: order.order_id,
            paymentId: details.paymentId,
            resourceId: details.resourceId,
            payloadSha256: details.payloadSha256,
            providerStatus: details.providerStatus,
            paymentAmountMinor: details.paymentAmountMinor,
            resourceAmountMinor: details.resourceAmountMinor,
            refundedTotalMinor: details.refundedTotalMinor,
            currency: details.currency,
            eventCreatedAt: details.eventCreatedAt,
            disputeState: details.disputeState || null,
            forceReview: details.forceReview === true
        });
    }
    async function refundSummary(mode, payment) {
        const providerTotal = payment.amount_refunded === undefined || payment.amount_refunded === null ? 0 : payment.amount_refunded;
        if (!Number.isSafeInteger(providerTotal) || providerTotal < 0 || providerTotal > payment.amount) throw new PaymentError(502, 'Payment provider returned an invalid refund total.');
        const response = await api(mode, `payments/${payment.id}/refunds?count=100`);
        const refunds = providerItems(response);
        if (!refunds) throw new PaymentError(502, 'Payment provider returned an invalid refund list.');
        let processed = 0;
        let forceReview = response.has_more === true || refunds.length >= 100;
        let hasPending = false;
        let hasFailed = false;
        const seenRefunds = new Set();
        const evidence = [];
        for (const refund of refunds) {
            if (!refund || refund.payment_id !== payment.id || !Number.isSafeInteger(refund.amount) || refund.amount < 0 || refund.currency !== payment.currency) {
                forceReview = true;
                evidence.push({ id: refund && refund.id, status: refund && refund.status, amount: refund && refund.amount, currency: refund && refund.currency });
                continue;
            }
            if (!validId(refund.id, 'rfnd') || seenRefunds.has(refund.id)) {
                forceReview = true;
                evidence.push({ id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency });
                continue;
            }
            seenRefunds.add(refund.id);
            evidence.push({ id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency });
            if (refund.status === 'processed') processed += refund.amount;
            else if (refund.status === 'created' || refund.status === 'pending') {
                hasPending = true;
                forceReview = true;
            } else if (refund.status === 'failed') {
                hasFailed = true;
                forceReview = true;
            } else forceReview = true;
        }
        if (processed !== providerTotal || processed > payment.amount) forceReview = true;
        // The provider's aggregate is authoritative for money already returned. Keep
        // the higher of it and the processed refund rows while queuing any mismatch.
        // Initiated or failed refunds never increase this completed-refund total, but
        // they do block automatic fulfillment until an operator reviews the order.
        evidence.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
        return { total: Math.max(processed, providerTotal), providerTotal, forceReview, hasPending, hasFailed, hasMore: response.has_more === true, evidence };
    }
    async function matchWebhookCredentials(rawBody, signature) {
        for (const mode of ['test', 'live_inr', 'live_usd']) {
            const credentials = credentialsForMode(mode, env);
            if (credentials && signatureMatches(rawBody, signature, credentials.webhookSecret)) return { mode, credentials };
        }
        throw new PaymentError(400, 'Invalid webhook signature.');
    }
    async function webhook(rawBody, signature, eventId) {
        if (!store || env.RAZORPAY_SCHEMA_READY !== 'true') throw new PaymentError(503, 'Payment processing is unavailable.');
        if (!Buffer.isBuffer(rawBody)) throw new PaymentError(400, 'Invalid webhook payload.');
        const body = rawBody;
        if (!Number.isSafeInteger(body.byteLength) || body.byteLength > 256 * 1024) throw new PaymentError(400, 'Invalid webhook payload.');
        const match = await matchWebhookCredentials(body, signature);
        let event;
        try { event = JSON.parse(body.toString('utf8')); } catch (_) { throw new PaymentError(400, 'Invalid webhook payload.'); }
        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new PaymentError(400, 'Invalid webhook event ID.');
        const expectedAccountId = match.mode === 'test' ? env.RAZORPAY_TEST_ACCOUNT_ID : env.RAZORPAY_LIVE_ACCOUNT_ID;
        if (expectedAccountId && event.account_id !== expectedAccountId) throw new PaymentError(400, 'Webhook account does not match.');
        const payloadSha256 = crypto.createHash('sha256').update(body).digest('hex');
        const eventCreatedAt = safeEventTime(event.created_at);
        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            const payment = event.payload && event.payload.payment && event.payload.payment.entity;
            if (!payment || !validId(payment.id, 'pay') || !validId(payment.order_id, 'order')) throw new PaymentError(400, 'Invalid webhook payment.');
            const order = await store.findOrder(payment.order_id);
            if (!order) return { success: true, ignored: true };
            if (order.mode !== match.mode) throw new PaymentError(400, 'Invalid payment mode.');
            const providerPayment = await api(match.mode, `payments/${payment.id}`);
            validatePaymentForOrder(providerPayment, { ...order, payment_id: order.payment_id || payment.id });
            const refundedAmount = providerPayment.amount_refunded === undefined || providerPayment.amount_refunded === null ? 0 : providerPayment.amount_refunded;
            if (providerPayment.captured === true && ['captured', 'refunded'].includes(providerPayment.status) &&
                Number.isSafeInteger(refundedAmount) && refundedAmount > 0) {
                const summary = await refundSummary(match.mode, providerPayment);
                const result = await recordReconciliation(order, {
                    eventId, eventType: event.event, paymentId: providerPayment.id, resourceId: providerPayment.id,
                    payloadSha256, providerStatus: providerPayment.status, paymentAmountMinor: providerPayment.amount,
                    resourceAmountMinor: null, refundedTotalMinor: summary.total, currency: providerPayment.currency,
                    eventCreatedAt, forceReview: true
                });
                return { success: true, ...result };
            }
            const result = await fulfill(order, payment.id, providerPayment);
            await store.recordEvent(eventId, payment.id, event.event, {
                mode: order.mode,
                orderId: order.order_id,
                payloadSha256,
                providerStatus: 'captured',
                amountMinor: order.amount_minor,
                currency: order.currency,
                eventCreatedAt
            });
            return result;
        }
        if (REFUND_EVENTS.has(event.event)) {
            const refundEvent = event.payload && event.payload.refund && event.payload.refund.entity;
            if (!refundEvent || !validId(refundEvent.id, 'rfnd')) throw new PaymentError(400, 'Invalid webhook refund.');
            const refund = await api(match.mode, `refunds/${refundEvent.id}`);
            if (!refund || refund.id !== refundEvent.id || !validId(refund.payment_id, 'pay') ||
                !Number.isSafeInteger(refund.amount) || refund.amount <= 0 || !['created', 'pending', 'processed', 'failed'].includes(refund.status)) {
                throw new PaymentError(502, 'Payment provider returned an invalid refund.');
            }
            const payment = await api(match.mode, `payments/${refund.payment_id}`);
            if (!payment || payment.id !== refund.payment_id || !validId(payment.order_id, 'order') ||
                payment.currency !== refund.currency || payment.order_id !== refundEvent.order_id && refundEvent.order_id) {
                throw new PaymentError(502, 'Payment provider returned an inconsistent refund.');
            }
            const order = await store.findOrder(payment.order_id);
            if (!order) return { success: true, ignored: true };
            if (order.mode !== match.mode || payment.amount !== order.amount_minor || payment.currency !== order.currency || !['captured', 'refunded'].includes(payment.status) || payment.captured !== true) {
                throw new PaymentError(409, 'Refund does not match a captured purchase.');
            }
            if (refund.currency !== order.currency || refund.amount > payment.amount) throw new PaymentError(409, 'Refund does not match this purchase.');
            const summary = await refundSummary(match.mode, payment);
            const result = await recordReconciliation(order, {
                eventId, eventType: event.event, paymentId: payment.id, resourceId: refund.id,
                payloadSha256, providerStatus: refund.status, paymentAmountMinor: payment.amount,
                resourceAmountMinor: refund.amount, refundedTotalMinor: summary.total, currency: payment.currency,
                eventCreatedAt, forceReview: summary.forceReview
            });
            return { success: true, ...result };
        }
        if (DISPUTE_EVENTS.has(event.event)) {
            const disputeEvent = event.payload && event.payload.dispute && event.payload.dispute.entity;
            if (!disputeEvent || !validId(disputeEvent.id, 'disp')) throw new PaymentError(400, 'Invalid webhook dispute.');
            const dispute = await api(match.mode, `disputes/${disputeEvent.id}`);
            if (!dispute || dispute.id !== disputeEvent.id || !validId(dispute.payment_id, 'pay') || !Number.isSafeInteger(dispute.amount) || dispute.amount <= 0) {
                throw new PaymentError(502, 'Payment provider returned an invalid dispute.');
            }
            const state = disputeState(dispute.status, event.event);
            if (!state || dispute.currency !== 'INR' && dispute.currency !== 'USD') throw new PaymentError(502, 'Payment provider returned an invalid dispute state.');
            const payment = await api(match.mode, `payments/${dispute.payment_id}`);
            if (!payment || payment.id !== dispute.payment_id || !validId(payment.order_id, 'order')) {
                throw new PaymentError(502, 'Payment provider returned an inconsistent dispute.');
            }
            const order = await store.findOrder(payment.order_id);
            if (!order) return { success: true, ignored: true };
            if (order.mode !== match.mode || payment.amount !== order.amount_minor || payment.currency !== order.currency || dispute.currency !== order.currency ||
                !['captured', 'refunded'].includes(payment.status) || payment.captured !== true || dispute.amount > payment.amount) {
                throw new PaymentError(409, 'Dispute does not match a captured purchase.');
            }
            const summary = await refundSummary(match.mode, payment);
            const result = await recordReconciliation(order, {
                eventId, eventType: event.event, paymentId: payment.id, resourceId: dispute.id,
                payloadSha256, providerStatus: dispute.status, disputeState: state,
                paymentAmountMinor: payment.amount, resourceAmountMinor: dispute.amount,
                refundedTotalMinor: summary.total, currency: payment.currency, eventCreatedAt,
                forceReview: true
            });
            return { success: true, ...result };
        }
        return { success: true, ignored: true };
    }
    async function reconcile(userId, input = {}) {
        if (!store || env.RAZORPAY_SCHEMA_READY !== 'true' || env.RAZORPAY_RECONCILIATION_SCHEMA_READY !== 'true') {
            throw new PaymentError(503, 'Payment reconciliation is unavailable.');
        }
        if (!userId) throw new PaymentError(401, 'Please sign in.');
        const orderId = input.orderId;
        if (!validId(orderId, 'order')) throw new PaymentError(400, 'Invalid purchase reference.');
        const order = await store.findOrder(orderId);
        if (!order || order.user_id !== userId) throw new PaymentError(404, 'Purchase not found.');
        const mode = requireOrderCredentials(order);
        const response = await api(mode, `orders/${orderId}/payments?count=100`);
        const payments = providerItems(response);
        if (!payments) throw new PaymentError(502, 'Payment provider returned an invalid order history.');
        const captured = payments.filter(payment => payment && ['captured', 'refunded'].includes(payment.status) && validId(payment.id, 'pay'));
        if (response.has_more === true || captured.length > 1) {
            const evidence = JSON.stringify({
                hasMore: response.has_more === true,
                payments: payments.map(payment => payment && ({
                    id: payment.id, orderId: payment.order_id, amount: payment.amount,
                    currency: payment.currency, status: payment.status,
                    amountRefunded: payment.amount_refunded, captured: payment.captured
                }))
            });
            const result = await recordReconciliation(order, {
                eventId: `reconcile_${crypto.createHash('sha256').update(orderId + '|' + evidence).digest('hex')}`,
                eventType: 'reconciliation.snapshot', paymentId: null, resourceId: orderId,
                payloadSha256: crypto.createHash('sha256').update(evidence).digest('hex'),
                providerStatus: 'ambiguous', paymentAmountMinor: order.amount_minor, resourceAmountMinor: null,
                refundedTotalMinor: order.refunded_amount_minor || 0, currency: order.currency, forceReview: true
            });
            return { success: true, reconciled: false, reviewRequired: true, ...result };
        }
        if (!captured.length) return { success: true, reconciled: false, reviewRequired: false };
        const payment = await api(mode, `payments/${captured[0].id}`);
        if (!payment || payment.id !== captured[0].id || payment.order_id !== order.order_id || payment.amount !== order.amount_minor || payment.currency !== order.currency ||
            !['captured', 'refunded'].includes(payment.status) || payment.captured !== true) throw new PaymentError(409, 'Payment is not ready for credit delivery. Contact support if you were charged.');
        const summary = await refundSummary(mode, payment);
        if (summary.total > 0 || summary.forceReview) {
            const providerStatus = summary.total === payment.amount ? 'refunded' :
                summary.hasPending ? 'refund_pending' : summary.hasFailed ? 'refund_failed' : summary.total > 0 ? 'partial_refund' : 'refund_review';
            const evidence = JSON.stringify({
                id: payment.id, status: payment.status, amountRefunded: payment.amount_refunded,
                hasMore: summary.hasMore, refunds: summary.evidence
            });
            const result = await recordReconciliation(order, {
                eventId: `reconcile_${crypto.createHash('sha256').update(orderId + '|' + evidence).digest('hex')}`,
                eventType: 'reconciliation.snapshot', paymentId: payment.id, resourceId: payment.id,
                payloadSha256: crypto.createHash('sha256').update(evidence).digest('hex'),
                providerStatus,
                paymentAmountMinor: payment.amount, resourceAmountMinor: null, refundedTotalMinor: summary.total,
                currency: payment.currency, forceReview: true
            });
            return { success: true, reconciled: false, reviewRequired: true, ...result };
        }
        const result = await fulfill(order, payment.id);
        return { success: true, reconciled: true, reviewRequired: false, ...result };
    }
    return {
        createOrder, verify, webhook, reconcile,
        config: () => {
            const { usdPrices, ...publicConfig } = resolvePaymentConfig(env);
            return publicConfig;
        },
        enabled: () => !!store && resolvePaymentConfig(env).enabled
    };
}

function supabasePaymentStore(client) {
    if (!client) return null;
    function checked(result) {
        if (result.error) throw new PaymentError(503, 'Payment record storage is unavailable.');
        return result.data;
    }
    return {
        async insertOrder(order) { checked(await client.from('razorpay_orders').insert(order)); },
        async findOrder(id) { return checked(await client.from('razorpay_orders').select('*').eq('order_id', id).maybeSingle()); },
        async fulfill(id, paymentId, amount, currency) {
            const data = checked(await client.rpc('fulfill_razorpay_order', { p_order_id: id, p_payment_id: paymentId, p_amount_minor: amount, p_currency: currency }));
            if (!data || !data.success) throw new PaymentError(409, 'Purchase could not be credited. Contact support.');
            return data;
        },
        async recordEvent(id, paymentId, event, metadata = {}) {
            const data = checked(await client.rpc('record_razorpay_event', {
                p_event_id: id,
                p_payment_id: paymentId,
                p_event_type: event,
                p_mode: metadata.mode,
                p_order_id: metadata.orderId,
                p_payload_sha256: metadata.payloadSha256,
                p_provider_status: metadata.providerStatus,
                p_amount_minor: metadata.amountMinor,
                p_currency: metadata.currency,
                p_event_created_at: metadata.eventCreatedAt
            }));
            if (!data || !data.success) throw new PaymentError(409, 'Provider event needs manual review.');
        },
        async recordReconciliation(entry) {
            const data = checked(await client.rpc('record_razorpay_reconciliation', {
                p_event_id: entry.eventId,
                p_event_type: entry.eventType,
                p_mode: entry.mode,
                p_order_id: entry.orderId,
                p_payment_id: entry.paymentId,
                p_resource_id: entry.resourceId,
                p_payload_sha256: entry.payloadSha256,
                p_provider_status: entry.providerStatus,
                p_payment_amount_minor: entry.paymentAmountMinor,
                p_resource_amount_minor: entry.resourceAmountMinor,
                p_refunded_total_minor: entry.refundedTotalMinor,
                p_currency: entry.currency,
                p_event_created_at: entry.eventCreatedAt,
                p_dispute_state: entry.disputeState,
                p_force_review: entry.forceReview
            }));
            if (!data || !data.success) throw new PaymentError(409, 'Payment reconciliation needs manual review.');
            return data;
        }
    };
}

module.exports = {
    createPaymentService, supabasePaymentStore, signatureMatches, testConfig,
    resolvePaymentConfig, requirePaymentAuth, PaymentError
};
