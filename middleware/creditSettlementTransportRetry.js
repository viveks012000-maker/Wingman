'use strict';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
}

function isAbortError(error, signal) {
    return Boolean((signal && signal.aborted) || (error && error.name === 'AbortError'));
}

function isSettlementRequest(input, init, supabaseUrl) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'POST') return false;

    // Retry only requests for which the request body is available for safe replay.
    if (!init || typeof init.body !== 'string') return false;

    const base = String(supabaseUrl || '').replace(/\/+$/, '');
    if (!base) return false;
    const expected = base + '/rest/v1/rpc/settle_credits';
    const actual = getRequestUrl(input).split('?')[0];
    return actual === expected;
}

function createCreditSettlementRetryFetch(originalFetch, supabaseUrl, options = {}) {
    if (typeof originalFetch !== 'function') throw new TypeError('A valid fetch implementation is required.');

    const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
        ? options.maxAttempts
        : DEFAULT_MAX_ATTEMPTS;
    const wait = typeof options.sleep === 'function' ? options.sleep : sleep;

    return async function creditSettlementRetryFetch(input, init) {
        if (!isSettlementRequest(input, init, supabaseUrl)) {
            return originalFetch(input, init);
        }

        const signal = init && init.signal;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (signal && signal.aborted) {
                const aborted = new Error('The operation was aborted.');
                aborted.name = 'AbortError';
                throw aborted;
            }

            try {
                const response = await originalFetch(input, init);
                const status = Number(response && response.status);
                if (!RETRYABLE_STATUSES.has(status) || attempt >= maxAttempts) {
                    return response;
                }

                try {
                    if (response && typeof response.arrayBuffer === 'function') await response.arrayBuffer();
                    else if (response && typeof response.text === 'function') await response.text();
                } catch (_) {}

                console.warn(`[Credit Settlement Retry] Supabase settlement returned HTTP ${status}; retrying attempt ${attempt + 1}/${maxAttempts}.`);
            } catch (error) {
                if (isAbortError(error, signal)) throw error;
                lastError = error;
                if (attempt >= maxAttempts) throw error;
                console.warn(`[Credit Settlement Retry] Supabase settlement transport failed; retrying attempt ${attempt + 1}/${maxAttempts}.`);
            }

            await wait(150 * Math.pow(2, attempt - 1));
        }

        throw lastError || new Error('Credit settlement request failed.');
    };
}

function installCreditSettlementTransportRetry(supabaseUrl) {
    if (typeof globalThis.fetch !== 'function') return false;
    if (globalThis.fetch.__wingmanCreditSettlementRetryInstalled) return true;

    const wrapped = createCreditSettlementRetryFetch(globalThis.fetch.bind(globalThis), supabaseUrl);
    Object.defineProperty(wrapped, '__wingmanCreditSettlementRetryInstalled', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
    });
    globalThis.fetch = wrapped;
    return true;
}

module.exports = {
    RETRYABLE_STATUSES,
    createCreditSettlementRetryFetch,
    installCreditSettlementTransportRetry,
    isSettlementRequest
};
