'use strict';

const crypto = require('crypto');
const { PRICING_CATALOG } = require('../config/pricingCatalog');

class PaymentError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function validId(value, prefix) {
    return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);
}
function signatureMatches(body, signature, secret) {
    if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
function testConfig(env = process.env) {
    // Live keys are deliberately rejected until staged database + gateway verification.
    return env.NODE_ENV !== 'production' && !env.RAILWAY_ENVIRONMENT &&
        env.RAZORPAY_PAYMENTS_ENABLED === 'true' &&
        /^rzp_test_[A-Za-z0-9]+$/.test(env.RAZORPAY_KEY_ID || '') &&
        !!env.RAZORPAY_KEY_SECRET && !!env.RAZORPAY_WEBHOOK_SECRET &&
        env.RAZORPAY_SCHEMA_READY === 'true';
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
function createPaymentService({ store, env = process.env, fetchImpl = fetch }) {
    function requireReady() {
        if (!store || !testConfig(env)) throw new PaymentError(503, 'Paid checkout is unavailable.');
    }
    async function api(endpoint, method = 'GET', body) {
        // Only these exact provider resources can receive the server credentials.
        if (endpoint !== 'orders' && !/^payments\/pay_[A-Za-z0-9]{1,64}$/.test(endpoint)) {
            throw new PaymentError(400, 'Invalid payment resource.');
        }
        const providerUrl = endpoint === 'orders' ? 'https://api.razorpay.com/v1/orders'
            : `https://api.razorpay.com/v1/payments/${encodeURIComponent(endpoint.slice(9))}`;
        const response = await fetchImpl(providerUrl, {
            method,
            redirect: 'error',
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'),
                'Content-Type': 'application/json'
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new PaymentError(502, 'Payment provider is unavailable. Please try again later.');
        return response.json();
    }
    async function createOrder(userId, input) {
        requireReady();
        if (!userId) throw new PaymentError(401, 'Please sign in.');
        const plan = typeof input.planId === 'string' && Object.hasOwn(PRICING_CATALOG, input.planId) ? PRICING_CATALOG[input.planId] : null;
        if (!plan || (input.currency && input.currency !== 'INR')) throw new PaymentError(400, 'Select a valid INR credit bundle.');
        // Never accept browser amounts, credit quantities or user IDs.
        const amount = plan.prices.INR.amountMinor;
        const receipt = crypto.randomUUID();
        const order = await api('orders', 'POST', { amount, currency: 'INR', receipt });
        if (!validId(order.id, 'order') || order.amount !== amount || order.currency !== 'INR' || order.receipt !== receipt) {
            throw new PaymentError(502, 'Payment provider returned an invalid order.');
        }
        await store.insertOrder({ order_id: order.id, user_id: userId, plan_id: plan.id, credits: plan.credits, amount_minor: amount, currency: 'INR', mode: 'test' });
        return { orderId: order.id, amount, currency: 'INR', credits: plan.credits, name: plan.name, keyId: env.RAZORPAY_KEY_ID, mode: 'test' };
    }
    async function fulfill(order, paymentId) {
        const payment = await api(`payments/${paymentId}`);
        if (payment.id !== paymentId || payment.order_id !== order.order_id ||
            payment.amount !== order.amount_minor || payment.currency !== order.currency) {
            throw new PaymentError(400, 'Payment does not match this purchase.');
        }
        if (payment.status !== 'captured' || payment.captured !== true || (payment.amount_refunded || 0) !== 0) {
            throw new PaymentError(409, 'Payment is not ready for credit delivery. Contact support if you were charged.');
        }
        // SQL transaction locks order + profile; duplicate callbacks/webhooks grant once.
        return store.fulfill(order.order_id, paymentId, order.amount_minor, order.currency);
    }
    async function verify(userId, input) {
        requireReady();
        if (!userId) throw new PaymentError(401, 'Please sign in.');
        const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = input;
        if (!validId(orderId, 'order') || !validId(paymentId, 'pay')) throw new PaymentError(400, 'Invalid payment reference.');
        const order = await store.findOrder(orderId);
        if (!order || order.user_id !== userId || order.mode !== 'test') throw new PaymentError(404, 'Purchase not found.');
        if (!signatureMatches(`${order.order_id}|${paymentId}`, signature, env.RAZORPAY_KEY_SECRET)) throw new PaymentError(400, 'Invalid payment signature.');
        return fulfill(order, paymentId);
    }
    async function webhook(rawBody, signature, eventId) {
        requireReady();
        if (!Buffer.isBuffer(rawBody) || !signatureMatches(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)) throw new PaymentError(400, 'Invalid webhook signature.');
        let event;
        try { event = JSON.parse(rawBody.toString('utf8')); } catch (_) { throw new PaymentError(400, 'Invalid webhook payload.'); }
        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new PaymentError(400, 'Invalid webhook event ID.');
        if (event.event !== 'payment.captured' && event.event !== 'order.paid') return { success: true, ignored: true };
        const payment = event.payload && event.payload.payment && event.payload.payment.entity;
        if (!payment || !validId(payment.id, 'pay') || !validId(payment.order_id, 'order')) throw new PaymentError(400, 'Invalid webhook payment.');
        const order = await store.findOrder(payment.order_id);
        // Other products on the merchant account do not belong to this application's ledger.
        if (!order) return { success: true, ignored: true };
        if (order.mode !== 'test') throw new PaymentError(400, 'Invalid payment mode.');
        const result = await fulfill(order, payment.id);
        await store.recordEvent(eventId, payment.id, event.event);
        return result;
    }
    return { createOrder, verify, webhook, enabled: () => !!store && testConfig(env) };
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
        async recordEvent(id, paymentId, event) {
            checked(await client.from('razorpay_events').upsert({ event_id: id, payment_id: paymentId, event_type: event }, { onConflict: 'event_id', ignoreDuplicates: true }));
        }
    };
}
module.exports = { createPaymentService, supabasePaymentStore, signatureMatches, testConfig, requirePaymentAuth, PaymentError };
