'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createPaymentService, signatureMatches, testConfig, requirePaymentAuth } = require('../middleware/razorpayPayments');
const { app } = require('../server');
const request = require('supertest');
const env = { RAZORPAY_PAYMENTS_ENABLED: 'true', RAZORPAY_SCHEMA_READY: 'true', RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'fixture_secret', RAZORPAY_WEBHOOK_SECRET: 'fixture_webhook' };
const sign = (body, secret = env.RAZORPAY_KEY_SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');
async function main() {
    let authenticated = false, authStatus = null;
    const authResponse = { status(code) { authStatus = code; return this; }, json() { return this; } };
    const strictAuth = requirePaymentAuth({ auth: { getUser: async token => {
        assert.equal(token, 'header.payload.signature');
        return { data: { user: { id: 'real-user' } }, error: null };
    } } });
    await strictAuth({ headers: { 'x-mock-auth': 'true' }, user: { id: 'victim' } }, authResponse, () => { authenticated = true; });
    assert.equal(authStatus, 401); assert.equal(authenticated, false);
    const authReq = { headers: { authorization: 'Bearer header.payload.signature', 'x-test-user-id': 'victim' }, user: { id: 'victim' } };
    await strictAuth(authReq, authResponse, () => { authenticated = true; });
    assert.equal(authenticated, true); assert.equal(authReq.user.id, 'real-user');
    authenticated = false;
    await requirePaymentAuth({ auth: { getUser: async () => ({ data: { user: null }, error: new Error('invalid') }) } })(authReq, authResponse, () => { authenticated = true; });
    assert.equal(authStatus, 401); assert.equal(authenticated, false);
    let balance = 20, grants = 0, entity = {}, calls = 0;
    const orders = new Map(), events = new Map(), payments = new Map();
    // Models the durable store contract, not a claim to have executed PostgreSQL.
    const store = {
        async insertOrder(order) { orders.set(order.order_id, order); },
        async findOrder(id) { return orders.get(id); },
        async fulfill(id, paymentId, amount, currency) {
            const order = orders.get(id);
            assert.equal(order.amount_minor, amount); assert.equal(order.currency, currency);
            if (order.payment_id) {
                assert.equal(order.payment_id, paymentId);
                return { success: true, duplicate: true, credits: balance };
            }
            assert(!payments.has(paymentId));
            order.payment_id = paymentId; payments.set(paymentId, id);
            balance += order.credits; grants++;
            return { success: true, duplicate: false, credits: balance };
        },
        async recordEvent(id, payment, type) { if (!events.has(id)) events.set(id, { payment, type }); }
    };
    const provider = async (url, options) => {
        calls++;
        if (url.endsWith('/orders')) {
            const payload = JSON.parse(options.body);
            assert.equal(payload.amount, 44900); assert.equal(payload.currency, 'INR');
            return { ok: true, json: async () => ({ ...payload, id: 'order_fixture' }) };
        }
        return { ok: true, json: async () => entity };
    };
    const svc = createPaymentService({ env, store, fetchImpl: provider });
    assert(testConfig(env)); assert(!testConfig({ ...env, RAZORPAY_KEY_ID: 'rzp_live_fixture' }));
    assert(!testConfig({ ...env, NODE_ENV: 'production' }));
    assert(!testConfig({ ...env, RAILWAY_ENVIRONMENT: 'production' }));
    assert(!signatureMatches('x', 'bad', env.RAZORPAY_KEY_SECRET));
    assert(!signatureMatches('x', sign('y'), env.RAZORPAY_KEY_SECRET));
    await assert.rejects(createPaymentService({ env: {}, store }).createOrder('alice', { planId: 'starter' }), { status: 503 });
    await assert.rejects(svc.createOrder(null, { planId: 'starter' }), { status: 401 });
    await assert.rejects(svc.createOrder('alice', { planId: '__proto__' }), { status: 400 });
    await assert.rejects(svc.createOrder('alice', { planId: 'starter', currency: 'USD' }), { status: 400 });
    const order = await svc.createOrder('alice', { planId: 'starter', amount: 1, credits: 999999, userId: 'victim' });
    assert.equal(order.amount, 44900); assert.equal(order.credits, 250); assert.equal(orders.get(order.orderId).user_id, 'alice');
    assert(!JSON.stringify(order).includes(env.RAZORPAY_KEY_SECRET));
    const callback = { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_fixture', razorpay_signature: sign(`${order.orderId}|pay_fixture`) };
    await assert.rejects(svc.verify('bob', callback), { status: 404 });
    await assert.rejects(svc.verify('alice', { ...callback, razorpay_signature: '0'.repeat(64) }), { status: 400 });
    assert.equal(balance, 20);
    entity = { id: 'pay_fixture', order_id: order.orderId, amount: 44900, currency: 'INR', status: 'authorized', captured: false, amount_refunded: 0 };
    for (const status of ['authorized', 'failed']) {
        entity.status = status;
        await assert.rejects(svc.verify('alice', callback), { status: 409 });
    }
    entity.status = 'captured'; entity.captured = true;
    for (const [key, value] of [['amount',1],['currency','USD'],['order_id','order_other']]) {
        const old = entity[key]; entity[key] = value;
        await assert.rejects(svc.verify('alice', callback), { status: 400 }); entity[key] = old;
    }
    entity.amount_refunded = 100;
    await assert.rejects(svc.verify('alice', callback), { status: 409 }); entity.amount_refunded = 0;
    const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity } } }));
    await assert.rejects(svc.webhook(raw, '0'.repeat(64), 'event_fixture'), { status: 400 });
    const sig = sign(raw, env.RAZORPAY_WEBHOOK_SECRET);
    await assert.rejects(svc.webhook(Buffer.concat([raw, Buffer.from(' ')]), sig, 'event_fixture'), { status: 400 });
    await Promise.all([svc.verify('alice', callback), svc.webhook(raw, sig, 'event_fixture'), svc.verify('alice', callback), svc.webhook(raw, sig, 'event_fixture')]);
    assert.equal(balance, 270); assert.equal(grants, 1); assert.equal(events.size, 1);
    // Webhook-only delivery survives the browser being closed before verification.
    orders.set('order_closed', { ...orders.get(order.orderId), order_id: 'order_closed', payment_id: null });
    entity = { ...entity, id: 'pay_closed', order_id: 'order_closed' };
    const closed = Buffer.from(JSON.stringify({ event: 'order.paid', payload: { payment: { entity } } }));
    await svc.webhook(closed, sign(closed, env.RAZORPAY_WEBHOOK_SECRET), 'event_closed');
    assert.equal(balance, 520); assert.equal(grants, 2);
    const ignored = Buffer.from(JSON.stringify({ event: 'payment.failed' }));
    assert((await svc.webhook(ignored, sign(ignored, env.RAZORPAY_WEBHOOK_SECRET), 'event_failed')).ignored);
    assert.equal(grants, 2); assert(calls > 0);
    for (const route of ['/api/payments/orders','/api/payments/verify']) {
        assert.equal((await request(app).post(route).send({})).status, 401);
        assert.equal((await request(app).post(route).set('x-mock-auth','true').set('x-test-user-id','victim').send({})).status, 401);
    }
    assert.equal((await request(app).post('/api/payments/webhook').set('Content-Type','application/json').send('{}')).status, 503);
    assert.equal((await request(app).get('/api/payments/config')).body.enabled, false);
    const appCsp = (await request(app).get('/app.html')).headers['content-security-policy'];
    const landingCsp = (await request(app).get('/index.html')).headers['content-security-policy'];
    assert(appCsp.includes('https://checkout.razorpay.com'));
    assert(!landingCsp.includes('https://checkout.razorpay.com'));
    assert(!appCsp.includes("'unsafe-eval'"));
    const sql = fs.readFileSync(require('path').join(__dirname,'../migrations/016_razorpay_payment_ledger.sql'),'utf8');
    for (const guard of ['payment_id text UNIQUE','FOR UPDATE',"SET search_path = ''",'ENABLE ROW LEVEL SECURITY','FROM PUBLIC, anon, authenticated','public.add_credits']) assert(sql.includes(guard));
    console.log('PASS: Razorpay payment trust-boundary, capture, replay, webhook-only delivery and disabled-route tests. Database execution still requires migration replay.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
