'use strict';

/**
 * =========================================================================================
 * WINGMAN AUTHORITATIVE PRICING & CURRENCY CATALOG
 * =========================================================================================
 * Single source of truth for credit tiers, pricing, integer minor amounts, and formatting.
 *
 * NOTE ON CURRENCY COMPLIANCE:
 * - INR prices below are the owner-approved package prices.
 * - USD is an indicative display conversion calculated by the backend at runtime;
 *   it is intentionally not stored as an approved or chargeable catalog price.
 * - Razorpay collection remains INR-only.
 * - Integer minor units are mandatory on the backend:
 *     USD: cents (1 USD = 100 cents)
 *     INR: paise (1 INR = 100 paise)
 * - Credits are server-authoritative and NEVER derived from client-submitted money.
 * - INR amounts are owner-approved package prices; tax treatment is handled in customer-facing checkout disclosures.
 * =========================================================================================
 */

const SUPPORTED_CURRENCIES = ['USD', 'INR'];
const CHECKOUT_CURRENCIES = ['INR'];
const DEFAULT_CURRENCY = 'INR';
const STORAGE_KEY = 'wingman_setting_currency';

const PRICING_CATALOG = {
    starter: {
        id: 'starter',
        name: 'Starter Pack',
        modalBundleName: 'Starter Bundle',
        credits: 250,
        prices: {
            INR: {
                amountMinor: 44900,
                regularMinor: null,
                formattedSale: '₹449',
                formattedRegular: null,
                formattedPerCredit: '₹1.80 per credit',
                formattedSaving: null,
                ctaPrice: '₹449'
            }
        }
    },
    pro: {
        id: 'pro',
        name: 'Pro Pack',
        modalBundleName: 'Pro Bundle',
        credits: 600,
        prices: {
            INR: {
                amountMinor: 89900,
                regularMinor: null,
                formattedSale: '₹899',
                formattedRegular: null,
                formattedPerCredit: '₹1.50 per credit',
                formattedSaving: null,
                ctaPrice: '₹899'
            }
        }
    },
    elite: {
        id: 'elite',
        name: 'Elite Pack',
        modalBundleName: 'Elite Bundle',
        credits: 3000,
        prices: {
            INR: {
                amountMinor: 179900,
                regularMinor: null,
                formattedSale: '₹1,799',
                formattedRegular: null,
                formattedPerCredit: '₹0.60 per credit',
                formattedSaving: null,
                ctaPrice: '₹1,799'
            }
        }
    },
    limited: {
        id: 'limited',
        name: 'VIP Pack',
        modalBundleName: 'VIP Bundle',
        credits: 100000,
        prices: {
            INR: {
                amountMinor: 449900,
                regularMinor: null,
                formattedSale: '₹4,499',
                formattedRegular: null,
                formattedPerCredit: '₹0.045 per credit',
                formattedSavingLanding: null,
                formattedSavingApp: null,
                ctaPrice: '₹4,499',
                buttonText: 'View VIP Bundle'
            }
        }
    }
};

/**
 * Validates and canonicalizes currency string.
 * @param {string} currency
 * @returns {'USD' | 'INR'}
 */
function canonicalizeCurrency(currency) {
    if (!currency || typeof currency !== 'string') return DEFAULT_CURRENCY;
    const normalized = currency.trim().toUpperCase();
    if (SUPPORTED_CURRENCIES.includes(normalized)) return normalized;
    return DEFAULT_CURRENCY;
}

/**
 * Formats a major currency amount using native Intl.NumberFormat.
 * @param {number} amount
 * @param {'USD' | 'INR'} currency
 * @param {Object} [options]
 * @returns {string}
 */
function formatCurrencyAmount(amount, currency, options = {}) {
    const validCurrency = canonicalizeCurrency(currency);
    const locale = validCurrency === 'INR' ? 'en-IN' : 'en-US';

    // For whole numbers in INR, default to 0 fraction digits unless requested
    let fractionDigits = options.fractionDigits;
    if (fractionDigits === undefined) {
        if (validCurrency === 'INR') {
            fractionDigits = (amount % 1 === 0) ? 0 : 2;
        } else {
            fractionDigits = (amount % 1 === 0) ? 0 : 2;
        }
    }

    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: validCurrency,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits
        }).format(amount);
    } catch (_) {
        const symbol = validCurrency === 'INR' ? '₹' : '$';
        return symbol + (amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2));
    }
}

/**
 * Returns the plan pricing record for a given tier and currency.
 * @param {string} planId
 * @param {'USD' | 'INR'} currency
 * @returns {Object | null}
 */
function getPlanPricing(planId, currency) {
    const plan = PRICING_CATALOG[planId];
    if (!plan) return null;
    const cur = canonicalizeCurrency(currency);
    return plan.prices[cur] || null;
}

// Universal module export: both the backend and browser use this exact catalog.
const WINGMAN_PRICING = {
    SUPPORTED_CURRENCIES,
    CHECKOUT_CURRENCIES,
    DEFAULT_CURRENCY,
    STORAGE_KEY,
    PRICING_CATALOG,
    canonicalizeCurrency,
    formatCurrencyAmount,
    getPlanPricing
};

if (typeof module !== 'undefined' && module.exports) module.exports = WINGMAN_PRICING;
if (typeof window !== 'undefined') {
    window.WINGMAN_PRICING = WINGMAN_PRICING;
    window.WINGMAN_PRICING_CATALOG = PRICING_CATALOG;
}
