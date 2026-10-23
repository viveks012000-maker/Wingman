(function () {
    'use strict';
    const PENDING_ORDER_KEY = 'mywingman.payment.pending-order.v1';
    let paymentConfig = { enabled: false, mode: 'disabled', currency: 'INR', keyId: null, availablePlanIds: [] };
    let busy = false;
    let checkoutScript;
    let recoveryRunning = false;
    const toast = (message, kind) => { if (typeof window.showToast === 'function') window.showToast(message, kind || 'info'); };
    const validModes = new Set(['test', 'live_inr', 'live_usd']);
    function expectedKeyPrefix(mode) { return mode === 'test' ? 'rzp_test_' : (mode === 'live_inr' || mode === 'live_usd' ? 'rzp_live_' : ''); }
    function validConfig(config) {
        if (!config || config.enabled !== true || !validModes.has(config.mode)) return false;
        const expectedCurrency = config.mode === 'live_usd' ? 'USD' : 'INR';
        return config.currency === expectedCurrency && typeof config.keyId === 'string' &&
            config.keyId.startsWith(expectedKeyPrefix(config.mode)) && Array.isArray(config.availablePlanIds);
    }
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
    function readPendingOrder() {
        try {
            const value = JSON.parse(window.localStorage.getItem(PENDING_ORDER_KEY) || 'null');
            if (!value || typeof value.orderId !== 'string' || !/^order_[A-Za-z0-9]{1,64}$/.test(value.orderId) ||
                !validModes.has(value.mode) || !Number.isFinite(value.createdAt) || Date.now() - value.createdAt > 7 * 24 * 60 * 60 * 1000) return null;
            return value;
        } catch (_) { return null; }
    }
    function savePendingOrder(order) {
        try { window.localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ orderId: order.orderId, mode: order.mode, createdAt: Date.now() })); }
        catch (_) { /* Recovery remains available through the verified callback/webhook. */ }
    }
    function clearPendingOrder(orderId) {
        try {
            const current = readPendingOrder();
            if (!orderId || !current || current.orderId === orderId) window.localStorage.removeItem(PENDING_ORDER_KEY);
        } catch (_) { /* Storage may be unavailable in private browsing. */ }
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
    function selectedPlanId() {
        const selected = document.querySelector("input[name='pricing_tier']:checked");
        return selected && typeof selected.value === 'string' ? selected.value : '';
    }
    function sync() {
        const button = document.getElementById('confirmPurchaseBtn');
        const text = document.getElementById('purchaseBtnText');
        const currency = window.wingmanCurrency ? window.wingmanCurrency.getCurrency() : 'INR';
        const currencyAllowed = paymentConfig.enabled && currency === paymentConfig.currency;
        const planAllowed = paymentConfig.enabled && paymentConfig.availablePlanIds.includes(selectedPlanId());
        if (button) { button.disabled = !paymentConfig.enabled || busy || !currencyAllowed || !planAllowed; button.setAttribute && button.setAttribute('aria-disabled', String(button.disabled)); }
        if (text) {
            if (!paymentConfig.enabled) text.textContent = 'Purchasing not yet enabled';
            else if (busy) text.textContent = 'Preparing secure checkout…';
            else if (!currencyAllowed) text.textContent = paymentConfig.currency === 'INR' ? 'USD payments unavailable — choose INR' : 'Choose USD for checkout';
            else if (!planAllowed) text.textContent = 'This bundle is not available for checkout';
            else text.textContent = paymentConfig.mode === 'test' ? 'Continue to Test Mode checkout' : 'Continue to secure checkout';
        }
        const notice = document.getElementById('paymentAvailabilityNotice');
        if (notice) {
            if (!paymentConfig.enabled) {
                notice.textContent = currency === 'USD'
                    ? 'USD prices are for display only; international collection is not enabled. Paid checkout is unavailable in production. No payment will be collected.'
                    : 'Paid checkout is unavailable in production. INR is the only supported payment currency. No payment will be collected.';
            } else if (paymentConfig.mode === 'test') {
                notice.textContent = currency === 'USD'
                    ? 'USD prices are for display only; international collection is not enabled. Select INR for Test Mode checkout. No USD payment will be collected.'
                    : 'Test Mode checkout: no real money is charged. Live purchases remain unavailable.';
            } else if (paymentConfig.mode === 'live_usd') {
                notice.textContent = currency === 'USD'
                    ? 'Live USD checkout is available only at the fixed price shown for this bundle.'
                    : 'USD is the available checkout currency. INR collection is not enabled for this checkout.';
            } else {
                notice.textContent = currency === 'USD'
                    ? 'USD prices are for display only; international collection is not enabled. Select INR for supported checkout.'
                    : 'Live INR checkout. Your payment is verified by the server before credits are added.';
            }
        }
    }
    async function reconcilePendingOrder(options = {}) {
        if (recoveryRunning) return;
        const pending = readPendingOrder();
        if (!pending || !window.currentSupabaseSession || !window.currentSupabaseSession.access_token) return;
        recoveryRunning = true;
        try {
            const result = await paymentRequest('/api/payments/reconcile', { orderId: pending.orderId });
            if (result.reconciled === true) {
                clearPendingOrder(pending.orderId);
                if (typeof window.checkCreditBalance === 'function') await window.checkCreditBalance();
                if (!options.quiet) toast('Your completed payment was verified and your credit balance has been refreshed.', 'success');
            } else if (result.reviewRequired === true) {
                clearPendingOrder(pending.orderId);
                toast('This payment needs support review. Please do not pay for the same bundle again.', 'warning');
            } else if (result.success === false) {
                clearPendingOrder(pending.orderId);
            }
        } catch (error) {
            // Keep the opaque order reference for a later retry; never imply payment success.
            if (error && /Purchase not found/i.test(error.message || '')) clearPendingOrder(pending.orderId);
            if (!options.quiet) toast(error.message || 'We could not check this payment yet. Please try again later.', 'warning');
        } finally { recoveryRunning = false; }
    }
    async function purchase() {
        const currency = window.wingmanCurrency ? window.wingmanCurrency.getCurrency() : 'INR';
        if (currency !== paymentConfig.currency) {
            toast(paymentConfig.currency === 'USD' ? 'Choose USD for checkout.' : 'USD prices are for display only. Select INR for supported checkout.', 'warning');
            return;
        }
        if (!paymentConfig.enabled || busy) { toast('Secure purchasing will be enabled after payment activation.', 'warning'); return; }
        const planId = selectedPlanId();
        if (!planId) { toast('Select a credit bundle.', 'warning'); return; }
        if (!paymentConfig.availablePlanIds.includes(planId)) { toast('This bundle is not currently available for checkout.', 'warning'); return; }
        busy = true; sync();
        try {
            await loadCheckout();
            const order = await paymentRequest('/api/payments/orders', { planId, currency });
            const expectedPrefix = expectedKeyPrefix(paymentConfig.mode);
            if (order.mode !== paymentConfig.mode || order.currency !== paymentConfig.currency || !order.keyId || !order.keyId.startsWith(expectedPrefix) || !/^order_[A-Za-z0-9]{1,64}$/.test(order.orderId)) {
                throw new Error('Checkout configuration is unavailable.');
            }
            savePendingOrder(order);
            const checkout = new window.Razorpay({
                key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
                name: 'Wingman / MyWingman', description: order.name + (order.mode === 'test' ? ' — Test Mode' : ''),
                handler: async function (callback) {
                    try {
                        await paymentRequest('/api/payments/verify', callback);
                        clearPendingOrder(order.orderId);
                        if (typeof window.checkCreditBalance === 'function') await window.checkCreditBalance();
                        toast('Payment verified. Your credit balance has been refreshed.', 'success');
                    } catch (error) { toast(error.message, 'warning'); }
                    finally { busy = false; sync(); }
                },
                modal: { ondismiss: function () {
                    busy = false; sync();
                    toast('Checkout closed. If a payment completed, it will be verified before credits are added.');
                    void reconcilePendingOrder({ quiet: true });
                } }
            });
            checkout.on('payment.failed', function () {
                busy = false; sync();
                toast('Payment failed. No credits have been granted for this failed payment.', 'warning');
            });
            checkout.open();
        } catch (error) { busy = false; sync(); toast(error.message, 'warning'); }
    }
    window.wingmanPayments = { purchase, sync, reconcilePendingOrder };
    async function initialize() {
        try {
            const response = await fetch(window.getApiBase() + '/api/payments/config', { signal: AbortSignal.timeout(5000) });
            if (response.ok) {
                const config = await response.json();
                paymentConfig = validConfig(config) ? {
                    enabled: true, mode: config.mode, currency: config.currency, keyId: config.keyId,
                    availablePlanIds: config.availablePlanIds.filter(id => typeof id === 'string' && /^[a-z0-9_-]{1,32}$/.test(id))
                } : { enabled: false, mode: 'disabled', currency: 'INR', keyId: null, availablePlanIds: [] };
            }
        } catch (_) { paymentConfig = { enabled: false, mode: 'disabled', currency: 'INR', keyId: null, availablePlanIds: [] }; }
        sync();
        void reconcilePendingOrder({ quiet: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
})();
