'use strict';

const ANALYZER_ENDPOINT = 'https://api.aicredits.in/v1/chat/completions';
const ANALYZER_VISION_MODEL = 'qwen/qwen3.5-flash-02-23';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isAbortError(error, signal) {
    return Boolean((signal && signal.aborted) || (error && error.name === 'AbortError'));
}

function isAnalyzerVisionRequest(input, init) {
    const url = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : '');
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (url !== ANALYZER_ENDPOINT || method !== 'POST') return false;

    const body = init && init.body;
    if (typeof body !== 'string') return false;

    try {
        const parsed = JSON.parse(body);
        return parsed && parsed.model === ANALYZER_VISION_MODEL;
    } catch (_) {
        return false;
    }
}

function createAnalyzerRetryFetch(originalFetch, options = {}) {
    if (typeof originalFetch !== 'function') {
        throw new TypeError('A valid fetch implementation is required.');
    }

    const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
        ? options.maxAttempts
        : DEFAULT_MAX_ATTEMPTS;
    const wait = typeof options.sleep === 'function' ? options.sleep : sleep;

    return async function analyzerRetryFetch(input, init) {
        if (!isAnalyzerVisionRequest(input, init)) {
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
                if (!RETRYABLE_STATUSES.has(Number(response && response.status)) || attempt >= maxAttempts) {
                    return response;
                }

                // Drain the retryable response so Node can safely reuse/release the connection.
                try {
                    if (response && typeof response.arrayBuffer === 'function') await response.arrayBuffer();
                    else if (response && typeof response.text === 'function') await response.text();
                } catch (_) {}

                console.warn(`[Analyzer Provider Retry] Vision request received HTTP ${response.status}; retrying attempt ${attempt + 1}/${maxAttempts}.`);
            } catch (error) {
                if (isAbortError(error, signal)) throw error;
                lastError = error;
                if (attempt >= maxAttempts) throw error;
                console.warn(`[Analyzer Provider Retry] Vision transport failed; retrying attempt ${attempt + 1}/${maxAttempts}.`);
            }

            // Keep retries short and bounded. The caller's existing AbortSignal remains the
            // authoritative 25-second deadline for the full provider operation.
            await wait(250 * Math.pow(2, attempt - 1));
        }

        throw lastError || new Error('Analyzer vision provider request failed.');
    };
}

function installAnalyzerTransportRetry() {
    if (typeof globalThis.fetch !== 'function') return false;
    if (globalThis.fetch.__wingmanAnalyzerRetryInstalled) return true;

    const wrapped = createAnalyzerRetryFetch(globalThis.fetch.bind(globalThis));
    Object.defineProperty(wrapped, '__wingmanAnalyzerRetryInstalled', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
    });
    globalThis.fetch = wrapped;
    return true;
}

module.exports = {
    ANALYZER_ENDPOINT,
    ANALYZER_VISION_MODEL,
    RETRYABLE_STATUSES,
    createAnalyzerRetryFetch,
    installAnalyzerTransportRetry,
    isAnalyzerVisionRequest
};
