'use strict';

const { formatCurrencyAmount } = require('../config/pricingCatalog');

const RATE_URL = 'https://api.frankfurter.dev/v2/rate/inr/usd';
const RATE_SOURCE = 'Frankfurter reference rate';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isValidDateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isUsableRate(record, now, maxAgeMs = MAX_RATE_AGE_MS) {
    if (!record || record.base !== 'INR' || record.quote !== 'USD' ||
        !Number.isFinite(record.rate) || record.rate <= 0 || record.rate >= 1 ||
        !isValidDateOnly(record.date)) return false;
    const age = now - Date.parse(`${record.date}T00:00:00.000Z`);
    return age >= -5 * 60 * 1000 && age <= maxAgeMs;
}

function formatUsdPerCredit(amountMinor, credits) {
    const centsPerCredit = amountMinor / credits;
    const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(centsPerCredit);
    return `${value}¢ per credit`;
}

function buildIndicativeCatalog(catalog, record, now = Date.now()) {
    const available = isUsableRate(record, now);
    const plans = {};

    for (const [planId, plan] of Object.entries(catalog)) {
        const inr = plan.prices && plan.prices.INR;
        const usd = available && inr && Number.isInteger(inr.amountMinor) && Number.isInteger(plan.credits)
            ? Math.round(inr.amountMinor * record.rate)
            : null;
        plans[planId] = {
            ...plan,
            prices: {
                ...plan.prices,
                USD: usd === null ? { available: false, indicative: true } : {
                    available: true,
                    indicative: true,
                    displayAmountMinor: usd,
                    formattedSale: `≈${formatCurrencyAmount(usd / 100, 'USD', { fractionDigits: 2 })}`,
                    formattedRegular: null,
                    formattedPerCredit: formatUsdPerCredit(usd, plan.credits),
                    formattedSaving: null,
                    formattedSavingLanding: null,
                    formattedSavingApp: null,
                    ctaPrice: `≈${formatCurrencyAmount(usd / 100, 'USD', { fractionDigits: 2 })}`,
                    ...(planId === 'limited' ? { buttonText: 'View VIP Bundle' } : {})
                }
            }
        };
    }

    const fetchedAt = available && Number.isFinite(record.fetchedAt)
        ? new Date(record.fetchedAt).toISOString()
        : null;
    return {
        plans,
        exchangeRate: available ? {
            available: true,
            base: 'INR',
            quote: 'USD',
            rate: record.rate,
            asOfDate: record.date,
            fetchedAt,
            source: RATE_SOURCE
        } : {
            available: false,
            base: 'INR',
            quote: 'USD',
            source: RATE_SOURCE
        }
    };
}

function createIndicativeUsdPricing({
    catalog,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    cacheTtlMs = CACHE_TTL_MS,
    maxRateAgeMs = MAX_RATE_AGE_MS
}) {
    let cached = null;

    function usable(record) {
        return isUsableRate(record, now(), maxRateAgeMs);
    }

    async function loadRate() {
        const time = now();
        if (cached && usable(cached) && time - cached.fetchedAt < cacheTtlMs) return cached;
        if (typeof fetchImpl !== 'function') return usable(cached) ? cached : null;

        try {
            const response = await fetchImpl(RATE_URL, {
                method: 'GET',
                redirect: 'error',
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(4000)
            });
            if (!response || !response.ok) throw new Error('Reference-rate provider is unavailable.');
            const payload = await response.json();
            const record = {
                date: payload && payload.date,
                base: payload && String(payload.base || '').toUpperCase(),
                quote: payload && String(payload.quote || '').toUpperCase(),
                rate: payload && payload.rate,
                fetchedAt: now()
            };
            if (!usable(record)) throw new Error('Reference rate is invalid or stale.');
            cached = record;
            return record;
        } catch (_) {
            return usable(cached) ? cached : null;
        }
    }

    async function getPricing() {
        const rate = await loadRate();
        return buildIndicativeCatalog(catalog, rate, now());
    }

    return { getPricing };
}

module.exports = {
    RATE_URL,
    RATE_SOURCE,
    CACHE_TTL_MS,
    MAX_RATE_AGE_MS,
    isUsableRate,
    buildIndicativeCatalog,
    createIndicativeUsdPricing
};
