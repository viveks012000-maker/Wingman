'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
async function main() {
    // Load fixed repository modules normally; never evaluate file text as code.
    global.window = { addEventListener() {} };
    global.document = { readyState: 'loading', addEventListener() {} };
    require('../config.js');
    const currencyContext = { window: global.window };
    const catalog = require('../config/pricingCatalog').PRICING_CATALOG;
    const sql = fs.readFileSync(path.join(root,'migrations/016_razorpay_payment_ledger.sql'),'utf8');
    for (const [id,plan] of Object.entries(catalog)) {
        assert.equal(currencyContext.window.WINGMAN_PRICING_CATALOG[id].credits,plan.credits);
        assert.equal(currencyContext.window.WINGMAN_PRICING_CATALOG[id].prices.INR.amountMinor,plan.prices.INR.amountMinor);
        assert(sql.includes(`plan_id='${id}' AND credits=${plan.credits} AND amount_minor=${plan.prices.INR.amountMinor}`));
    }
    let checkout, verified = false, rejectVerify = false, refreshes = 0, providerOpened = 0;
    const posts = [], notices = [], button = {}, label = {}, notice = {};
    const window = {
        currentSupabaseSession: { access_token: 'fixture' }, getApiBase: () => 'https://backend.example',
        showToast: text => notices.push(text), checkCreditBalance: async () => { assert(verified); refreshes++; },
        Razorpay: function (options) { checkout = options; this.on = function () {}; this.open = () => providerOpened++; }
    };
    const document = {
        readyState: 'complete',
        getElementById: id => ({confirmPurchaseBtn:button,purchaseBtnText:label,paymentAvailabilityNotice:notice}[id]),
        querySelector: () => ({value:'starter'})
    };
    const fetch = async (url, options) => {
        if (url.endsWith('/config')) return {ok:true,json:async()=>({enabled:true,mode:'test',currency:'INR'})};
        assert.equal(options.headers.Authorization,'Bearer fixture');
        posts.push({url,body:JSON.parse(options.body)});
        if (url.endsWith('/orders')) return {ok:true,json:async()=>({keyId:'rzp_test_fixture',orderId:'order_fixture',amount:44900,currency:'INR',mode:'test',name:'Starter Pack'})};
        assert(url.endsWith('/verify'));
        if (rejectVerify) return {ok:false,json:async()=>({success:false,error:'Invalid payment signature.'})};
        verified = true; return {ok:true,json:async()=>({success:true,credits:270})};
    };
    global.window = window; global.document = document; global.fetch = fetch;
    require('../payments-client.js');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(button.disabled,false); assert(notice.textContent.includes('no real money'));
    await window.wingmanPayments.purchase();
    assert.equal(providerOpened,1); assert.equal(refreshes,0); assert.deepEqual(posts[0].body,{planId:'starter'});
    checkout.modal.ondismiss(); assert.equal(button.disabled,false); assert.equal(refreshes,0);
    await window.wingmanPayments.purchase();
    const callback={razorpay_order_id:'order_fixture',razorpay_payment_id:'pay_fixture',razorpay_signature:'fixture'};
    rejectVerify=true; await checkout.handler(callback);
    assert.equal(refreshes,0); assert(notices.includes('Invalid payment signature.'));
    rejectVerify=false; await window.wingmanPayments.purchase(); await checkout.handler(callback);
    assert.equal(refreshes,1); assert.equal(button.disabled,false);
    window.currentSupabaseSession=null; const before=posts.length;
    await window.wingmanPayments.purchase(); assert.equal(posts.length,before);
    assert(notices.includes('Please sign in to purchase credits.'));
    console.log('PASS: Checkout client sends only planId, never optimistically grants credits, handles dismissal/verification failure, and refreshes after server verification. Catalog mirrors match.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
