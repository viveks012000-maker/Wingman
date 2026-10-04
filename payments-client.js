(function () {
    'use strict';
    let enabled = false;
    let busy = false;
    let checkoutScript;
    const toast = (message, kind) => { if (typeof window.showToast === 'function') window.showToast(message, kind || 'info'); };
    async function paymentRequest(path, body) {
        const session = window.currentSupabaseSession;
        if (!session || !session.access_token) throw new Error('Please sign in to purchase credits.');
        const response = await fetch(window.getApiBase() + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify(body), signal: AbortSignal.timeout(25000)
        });
        const data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.error || 'Payment could not be verified. Contact support if you were charged.');
        return data;
    }
    function loadCheckout() {
        if (window.Razorpay) return Promise.resolve();
        if (!checkoutScript) checkoutScript = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = resolve;
            script.onerror = () => { script.remove(); checkoutScript = null; reject(new Error('Checkout could not load. Please try again.')); };
            document.head.appendChild(script);
        });
        return checkoutScript;
    }
    function sync() {
        const button = document.getElementById('confirmPurchaseBtn');
        const text = document.getElementById('purchaseBtnText');
        const currencyAllowed = !window.wingmanCurrency || window.wingmanCurrency.getCurrency() === 'INR';
        if (button) { button.disabled = !enabled || busy || !currencyAllowed; button.setAttribute && button.setAttribute('aria-disabled', String(button.disabled)); }
        if (text) text.textContent = !currencyAllowed ? 'USD payments unavailable — choose INR' : (enabled ? (busy ? 'Preparing test checkout…' : 'Continue to Test Mode checkout') : 'Paid checkout unavailable');
    }
    async function purchase() {
        const currency = window.wingmanCurrency ? window.wingmanCurrency.getCurrency() : 'INR';
        if (currency !== 'INR') { toast('USD prices are for display only. USD/international payment collection is not enabled. Select INR for supported checkout.', 'warning'); return; }
        if (!enabled || busy) { toast('Credit purchasing is currently unavailable while payment gateway upgrades are underway.', 'warning'); return; }
        busy = true; sync();
        try {
            const selected = document.querySelector("input[name='pricing_tier']:checked");
            if (!selected) throw new Error('Select a credit bundle.');
            await loadCheckout();
            const order = await paymentRequest('/api/payments/orders', { planId: selected.value, currency });
            if (order.mode !== 'test' || order.currency !== 'INR' || !/^rzp_test_/.test(order.keyId)) throw new Error('Checkout configuration is unavailable.');
            // No secret, client-defined entitlement, or card details enter Wingman storage.
            const checkout = new window.Razorpay({
                key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
                name: 'Wingman / MyWingman', description: order.name + ' — Test Mode',
                handler: async function (callback) {
                    try {
                        await paymentRequest('/api/payments/verify', callback);
                        // Refresh the server wallet; never optimistically mint client credits.
                        if (typeof window.checkCreditBalance === 'function') await window.checkCreditBalance();
                        toast('Test payment verified. Your credit balance has been refreshed.', 'success');
                    } catch (error) { toast(error.message, 'warning'); }
                    finally { busy = false; sync(); }
                },
                modal: { ondismiss: function () { busy = false; sync(); toast('Checkout closed. If a payment completed, its verified webhook will reconcile credits.'); } }
            });
            checkout.on('payment.failed', function () { busy = false; sync(); toast('Payment failed. No credits have been granted for this failed payment.', 'warning'); });
            checkout.open();
        } catch (error) { busy = false; sync(); toast(error.message, 'warning'); }
    }
    window.wingmanPayments = { purchase, sync };
    async function initialize() {
        try {
            const response = await fetch(window.getApiBase() + '/api/payments/config', { signal: AbortSignal.timeout(5000) });
            if (response.ok) {
                const config = await response.json();
                enabled = config.enabled === true && config.mode === 'test' && config.currency === 'INR';
                if (enabled) {
                    const notice = document.getElementById('paymentAvailabilityNotice');
                    if (notice) notice.textContent = 'Test Mode checkout: no real money is charged. Live purchases remain unavailable.';
                }
            }
        } catch (_) { enabled = false; }
        sync();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
})();
