/**
 * My Wingman Client-Side Environment Configuration
 * -------------------------------------------------------------------------
 * In Localhost Development: API_BASE_URL defaults to http://localhost:3000
 * In Production: API requests are sent to the Railway backend below.
 * Live Railway Backend: https://wingman-production-c6ce.up.railway.app
 */
window.WINGMAN_CONFIG = window.WINGMAN_CONFIG || {
    API_BASE_URL: "https://wingman-production-c6ce.up.railway.app"
};

// Shared endpoint resolution used by both the landing page and dashboard.
(function () {
    'use strict';

    function isPrivateDevelopmentHost(hostname) {
        var host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (host === 'localhost' || host.endsWith('.local') || host === '::1') return true;
        if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;

        var octets = host.split('.');
        if (octets.length !== 4 || octets.some(function (octet) {
            return !/^\d{1,3}$/.test(octet) || Number(octet) > 255;
        })) return false;

        var first = Number(octets[0]);
        var second = Number(octets[1]);
        return first === 10 ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 169 && second === 254) ||
            first === 127;
    }

    function getApiBase() {
        if (typeof window === 'undefined' || !window.location) return '';
        var hostname = window.location.hostname || '';
        var protocol = window.location.protocol || '';
        var origin = window.location.origin || '';
        var isLoopbackEnv = protocol === 'file:' || origin === 'null' || hostname === 'localhost' ||
            hostname === '127.0.0.1';
        var isHttpEnv = protocol === 'http:' || protocol === 'https:';
        var isPrivateNetworkEnv = isHttpEnv && isPrivateDevelopmentHost(hostname);

        if (isLoopbackEnv) return 'http://localhost:3000';
        if (isPrivateNetworkEnv) return (protocol === 'https:' ? 'https://' : 'http://') + hostname + ':3000';
        if (window.WINGMAN_CONFIG && window.WINGMAN_CONFIG.API_BASE_URL) {
            return String(window.WINGMAN_CONFIG.API_BASE_URL).replace(/\/+$/, '');
        }
        return origin && origin !== 'null' ? origin.replace(/\/+$/, '') : '';
    }

    window.getApiBase = getApiBase;
})();

/*
 * Production mobile runtime safeguards.
 * This file is loaded before app.js, so the patch is installed after app.js has defined its
 * handlers. It does not mint/deduct credits or bypass backend authorization; it only prevents
 * unavailable/unknown wallet state from making the text composer itself unusable.
 */
(function () {
    'use strict';

    var patched = false;

    function refreshUnknownCreditLabels() {
        var state = window.state;
        if (!state) return;
        var hasAuthoritativeNumber = state.creditsStatus === 'loaded' && typeof state.credits === 'number';
        if (hasAuthoritativeNumber) return;

        if (window.__wingmanAuthStateResolved !== true) {
            ['desktopCreditCount', 'mobileCreditCount'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.textContent = 'Syncing…';
            });
            return;
        }

        // A signed-out visitor has no authoritative account balance. Do not present the
        // absence of an account as a zero-credit balance.
        if (window.currentSupabaseSession && window.currentSupabaseSession.access_token) return;

        var desktop = document.getElementById('desktopCreditCount');
        var mobile = document.getElementById('mobileCreditCount');
        if (desktop) desktop.textContent = 'Sign in for credits';
        if (mobile) mobile.textContent = 'Sign in';
    }

    function patchRuntime() {
        if (patched || !window.state) return;
        patched = true;

        if (typeof window.updateButtonStates === 'function') {
            var originalUpdateButtonStates = window.updateButtonStates;
            window.updateButtonStates = function () {
                var result = originalUpdateButtonStates.apply(this, arguments);
                var state = window.state || {};
                var input = document.getElementById('simulator-chat-input');
                var send = document.getElementById('chatbox-send-btn');
                var busy = !!state.isLoading;

                /*
                 * The user may type before auth/consent/credit verification. Sending still goes
                 * through hasSufficientCredits(), Supabase auth, consent middleware and backend RPCs.
                 */
                if (input) {
                    input.disabled = busy;
                    input.setAttribute('aria-disabled', busy ? 'true' : 'false');
                    input.style.pointerEvents = busy ? 'none' : 'auto';
                }

                if (send) {
                    var hasText = !!(input && input.value && input.value.trim().length);
                    send.disabled = busy || !hasText;
                    send.classList.toggle('opacity-40', send.disabled);
                    send.classList.toggle('cursor-not-allowed', send.disabled);
                    send.classList.toggle('cursor-pointer', !send.disabled);
                }

                refreshUnknownCreditLabels();
                return result;
            };
        }

        var input = document.getElementById('simulator-chat-input');
        if (input && !input.__wingmanMobileInputPatched) {
            input.__wingmanMobileInputPatched = true;
            input.addEventListener('input', function () {
                if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
            });
        }

        refreshUnknownCreditLabels();
        if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
    }

    function schedulePatch() {
        setTimeout(patchRuntime, 0);
        setTimeout(patchRuntime, 120);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', schedulePatch, { once: true });
    } else {
        schedulePatch();
    }

    window.addEventListener('load', schedulePatch, { once: true });
    window.addEventListener('resize', function () {
        if (!patched) schedulePatch();
    }, { passive: true });
})();

/*
 * Account plan badge.
 * "Free Plan" means no paid credit purchase has been recorded, regardless of whether the
 * account received the historical 20-credit grant or the post-cutover 50-credit welcome grant.
 * "Paid Plan" means the database has recorded paid credits. This monotonic fact is stored on
 * the authenticated user's RLS-protected profile so refreshes stay O(1) regardless of ledger size.
 */
(function () {
    'use strict';

    var refreshTimer = null;
    var authListenerAttached = false;
    var updateCreditsPatched = false;

    function getPlanBadge() {
        var emailBadge = document.getElementById('userEmailBadge');
        if (!emailBadge) return null;
        var candidate = emailBadge.nextElementSibling;
        return candidate && candidate.tagName === 'P' ? candidate : null;
    }

    function setPlanBadge(text) {
        var badge = getPlanBadge();
        if (badge) badge.textContent = text;
        var desktopPlan = document.getElementById('desktopPlanBadge');
        if (desktopPlan) desktopPlan.textContent = text;
    }

    async function getAuthenticatedUser() {
        if (!window.supabaseClient || !window.supabaseClient.auth || typeof window.supabaseClient.auth.getSession !== 'function') {
            return null;
        }
        var result = await window.supabaseClient.auth.getSession();
        if (result && result.error) throw result.error;
        return result && result.data && result.data.session ? result.data.session.user : null;
    }

    async function determinePlan(userId) {
        var profileResult = await window.supabaseClient
            .from('profiles')
            .select('has_paid_credits')
            .eq('id', userId)
            .maybeSingle();

        if (profileResult.error) throw profileResult.error;
        if (!profileResult.data || typeof profileResult.data.has_paid_credits !== 'boolean') return 'unavailable';
        return profileResult.data.has_paid_credits ? 'paid' : 'free';
    }

    async function refreshPlanBadge() {
        try {
            var user = await getAuthenticatedUser();
            if (!user || !user.id) {
                setPlanBadge('Free Plan');
                return;
            }

            var plan = await determinePlan(user.id);
            if (plan === 'paid') setPlanBadge('Paid Plan');
            else if (plan === 'free') setPlanBadge('Free Plan');
            else setPlanBadge('Free Plan');
        } catch (err) {
            console.warn('[PlanBadge] Unable to determine account plan:', err && err.message ? err.message : err);
            setPlanBadge('Free Plan');
        }
    }

    function schedulePlanRefresh() {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(function () {
            refreshTimer = null;
            refreshPlanBadge();
        }, 120);
    }

    function attachPlanRuntime() {
        schedulePlanRefresh();

        if (!authListenerAttached && window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.onAuthStateChange === 'function') {
            authListenerAttached = true;
            window.supabaseClient.auth.onAuthStateChange(function () {
                schedulePlanRefresh();
            });
        }

        if (!updateCreditsPatched && typeof window.updateUICredits === 'function') {
            updateCreditsPatched = true;
            var originalUpdateUICredits = window.updateUICredits;
            window.updateUICredits = function () {
                var result = originalUpdateUICredits.apply(this, arguments);
                schedulePlanRefresh();
                return result;
            };
        }
    }

    window.refreshUserPlanBadge = refreshPlanBadge;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachPlanRuntime, { once: true });
    } else {
        attachPlanRuntime();
    }

    window.addEventListener('load', attachPlanRuntime, { once: true });
})();

/*
 * Dashboard refresh/session reconciliation.
 * Supabase is intentionally loaded before app.js. On a fast refresh it can restore a valid
 * browser session before app.js has defined the dashboard UI handlers. The auth event is then
 * already over by the time those handlers exist, which can leave the source placeholders
 * ("Credits —" and "Sign In / Account") on screen. This catch-up layer reconciles the already
 * restored canonical Supabase session once app.js is ready. It never authenticates from local
 * flags, never invents a balance, and never changes backend credit accounting.
 */
(function () {
    'use strict';

    var reconcileTimer = null;
    var reconcileInFlight = false;
    var sessionHydrationInFlight = null;

    function hasRestoredDashboardSession() {
        var session = window.currentSupabaseSession;
        return !!(
            session &&
            session.access_token &&
            session.user &&
            session.user.id
        );
    }

    function logRefreshFailure(err) {
        console.warn('[SessionBootstrap] Credit refresh failed:', err && err.message ? err.message : err);
    }

    function logSessionFailure(err) {
        console.warn('[SessionBootstrap] Session reconciliation failed:', err && err.message ? err.message : err);
    }

    function hydrateCanonicalDashboardSession() {
        if (hasRestoredDashboardSession()) {
            return Promise.resolve(window.currentSupabaseSession);
        }

        if (window.__wingmanAuthStateResolved === true) {
            return Promise.resolve(null);
        }

        if (window.wingmanAuthStateReady && typeof window.wingmanAuthStateReady.then === 'function') {
            if (sessionHydrationInFlight) return sessionHydrationInFlight;

            var authReadyPromise;
            authReadyPromise = Promise.resolve(window.wingmanAuthStateReady).then(function () {
                return hasRestoredDashboardSession() ? window.currentSupabaseSession : null;
            }).finally(function () {
                if (sessionHydrationInFlight === authReadyPromise) {
                    sessionHydrationInFlight = null;
                }
            });
            sessionHydrationInFlight = authReadyPromise;
            return authReadyPromise;
        }

        if (!window.supabaseClient || !window.supabaseClient.auth || typeof window.supabaseClient.auth.getSession !== 'function') {
            return Promise.resolve(null);
        }

        if (sessionHydrationInFlight) return sessionHydrationInFlight;

        var hydrationPromise;
        hydrationPromise = (async function () {
            var hydrationRevision = Number(window.__wingmanAuthStateRevision) || 0;
            try {
                var result = await window.supabaseClient.auth.getSession();
                if (result && result.error) throw result.error;

                // Do not replace a newer auth event that may have arrived while getSession()
                // was pending, including a sign-out or switch to another account.
                if ((Number(window.__wingmanAuthStateRevision) || 0) !== hydrationRevision) {
                    return window.currentSupabaseSession;
                }

                var session = result && result.data ? result.data.session : null;
                if (session && session.access_token && session.user && session.user.id) {
                    window.currentSupabaseSession = session;
                    window.currentSupabaseUser = session.user;
                } else {
                    window.currentSupabaseSession = null;
                    window.currentSupabaseUser = null;
                }

                window.__wingmanAuthStateResolved = true;
                if (typeof window.renderHomepageAuthState === 'function') {
                    window.renderHomepageAuthState();
                }
                if (typeof window.checkDashboardAuth === 'function') {
                    window.checkDashboardAuth();
                }
                return window.currentSupabaseSession;
            } catch (err) {
                if ((Number(window.__wingmanAuthStateRevision) || 0) === hydrationRevision) {
                    // A failed canonical check must settle the UI into a recoverable signed-out
                    // state instead of leaving authentication controls in a loading state.
                    window.currentSupabaseSession = null;
                    window.currentSupabaseUser = null;
                    window.__wingmanAuthStateResolved = true;
                    if (typeof window.renderHomepageAuthState === 'function') {
                        window.renderHomepageAuthState();
                    }
                    if (typeof window.checkDashboardAuth === 'function') {
                        window.checkDashboardAuth();
                    }
                }
                throw err;
            } finally {
                if (sessionHydrationInFlight === hydrationPromise) {
                    sessionHydrationInFlight = null;
                }
            }
        })();

        sessionHydrationInFlight = hydrationPromise;
        return hydrationPromise;
    }

    function refreshAuthoritativeCredits() {
        if (!hasRestoredDashboardSession() || typeof window.checkCreditBalance !== 'function') return;
        if (reconcileInFlight) return;
        if (window.state && ['loading', 'loaded', 'missing_profile'].indexOf(window.state.creditsStatus) !== -1) return;

        reconcileInFlight = true;
        try {
            var result = window.checkCreditBalance();
            if (result && typeof result.then === 'function') {
                result.catch(logRefreshFailure).finally(function () {
                    reconcileInFlight = false;
                });
            } else {
                reconcileInFlight = false;
            }
        } catch (err) {
            reconcileInFlight = false;
            logRefreshFailure(err);
        }
    }

    async function reconcileDashboardSession() {
        if (!window.state) return false;

        try {
            await hydrateCanonicalDashboardSession();
        } catch (err) {
            logSessionFailure(err);
        }

        // Render only after the canonical browser session has had a chance to hydrate. This
        // prevents a valid persisted session from being painted as signed-out during refresh.
        if (typeof window.checkDashboardAuth === 'function') {
            window.checkDashboardAuth();
        }

        if (hasRestoredDashboardSession()) {
            refreshAuthoritativeCredits();
        }
        return true;
    }

    function bindAuthButton(elementId) {
        var button = document.getElementById(elementId);
        if (!button || button.__wingmanSessionSafeBound) return;

        button.__wingmanSessionSafeBound = true;
        button.onclick = function (e) {
            if (elementId === 'mobileAuthBtn' && hasRestoredDashboardSession()) {
                if (typeof window.handleSignOut === 'function') {
                    return window.handleSignOut(e);
                }
            }
            if (typeof window.handleAuthBtnClick === 'function') {
                return window.handleAuthBtnClick(e);
            }
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            return false;
        };
    }

    function installSessionSafeAuthButton() {
        if (!window.state || typeof window.handleAuthBtnClick !== 'function') return false;

        if (!window.handleAuthBtnClick.__wingmanSessionSafe) {
            var safeHandler = function (e) {
                if (e && typeof e.preventDefault === 'function') e.preventDefault();

                // The visible Sign In / Account control is never a logout control. If a restored
                // session exists but the DOM is stale, reconcile it in-place rather than signing out.
                if (hasRestoredDashboardSession()) {
                    reconcileDashboardSession().catch(logSessionFailure);
                    return false;
                }

                if (typeof window.openAuthRequiredModal === 'function') {
                    window.openAuthRequiredModal(e);
                }
                return false;
            };
            safeHandler.__wingmanSessionSafe = true;
            window.handleAuthBtnClick = safeHandler;
        }

        bindAuthButton('desktopAuthBtn');
        bindAuthButton('mobileAuthBtn');
        return true;
    }

    function patchSessionBootstrap() {
        if (!window.state) return false;
        installSessionSafeAuthButton();
        return reconcileDashboardSession();
    }

    function runSessionBootstrap() {
        var result;
        try {
            result = patchSessionBootstrap();
        } catch (err) {
            logSessionFailure(err);
            return false;
        }

        if (result && typeof result.then === 'function') {
            result.catch(logSessionFailure);
            return true;
        }
        return result;
    }

    function scheduleSessionBootstrap(delay) {
        if (reconcileTimer) clearTimeout(reconcileTimer);
        reconcileTimer = setTimeout(function () {
            reconcileTimer = null;
            if (!runSessionBootstrap()) {
                // app.js may still be defining handlers. Retry briefly without creating a loop.
                setTimeout(runSessionBootstrap, 120);
            }
        }, delay || 0);
    }

    window.reconcileDashboardSession = reconcileDashboardSession;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            scheduleSessionBootstrap(0);
        }, { once: true });
    } else {
        scheduleSessionBootstrap(0);
    }

    window.addEventListener('load', function () {
        scheduleSessionBootstrap(0);
    }, { once: true });
})();

/**
 * WINGMAN ENGLISH UI / AUTO AI LANGUAGE COMPATIBILITY
 * -------------------------------------------------------------------------
 * - Static UI remains English, including for saved legacy Hinglish preferences.
 * - AI requests use languageMode: 'auto'; the server selects conversational language.
 * - Legacy dictionaries and method names remain available for compatibility.
 */
(function () {
    'use strict';

    var DICTIONARY = {
        en: {
            language_label: "Language",
            language_desc: "AI suggestions & app language",
            nav_how_it_works: "How It Works",
            nav_ai_coach: "AI Coach",
            nav_results: "Examples",
            nav_pricing: "Pricing",
            nav_faq: "FAQ",
            nav_sign_in: "Sign In",
            nav_launch_app: "Launch App",
            hero_badge: "MYWINGMAN · THE AI TEXTING ASSISTANT",
            hero_title_1: "The AI",
            hero_title_2: "Texting Assistant",
            hero_title_3: "Stop staring at the typing box. Find a better starting point.",
            hero_subtitle: "Not sure what to reply? Worried your message sounds off? MyWingman helps you explore AI-written replies from your own chats, improve profile bios, generate icebreakers, and practise conversations. Pick what fits, edit it your way, and send it yourself.",
            hero_cta: "Explore the Tools",
            tab_screenshot: "Screenshot Analyzer",
            tab_icebreakers: "Icebreakers",
            tab_bio_optimizer: "Bio Optimizer",
            tab_practice: "Practice Partner",
            tab_saved: "Saved Items",
            screenshot_desc: "Upload a chat screenshot to get 10 strategic reply options.",
            icebreakers_desc: "Use profile details to explore 10 conversation starters. Review and edit them before use.",
            bio_desc: "Generate 10 AI-written profile bio drafts to review and edit.",
            coach_desc: "Practise social and romantic conversation wording with optional AI-generated feedback from Maeve.",
            btn_generate_replies: "Generate Replies",
            btn_generate_openers: "Generate Openers",
            btn_optimize_bio: "Optimize My Bio",
            btn_send: "Send",
            btn_save: "Save",
            btn_copy: "Copy",
            btn_copied: "Copied!",
            settings_title: "System Settings",
            setting_linguistic_shorthand: "Linguistic Shorthand",
            setting_linguistic_desc: "Enforce lowercase and casual spacing",
            setting_emoji_format: "Emoji Formatting",
            setting_plexus: "Background Plexus Canvas",
            setting_plexus_desc: "Turn off interactive lines to extend battery life"
        },
        hinglish: {
            language_label: "Language",
            language_desc: "AI suggestions aur app ki language",
            nav_how_it_works: "Kaise Kaam Karta Hai",
            nav_ai_coach: "AI Coach",
            nav_results: "Examples",
            nav_pricing: "Pricing",
            nav_faq: "FAQ",
            nav_sign_in: "Sign In",
            nav_launch_app: "Launch App",
            hero_badge: "MYWINGMAN · THE AI TEXTING ASSISTANT",
            hero_title_1: "The AI",
            hero_title_2: "Texting Assistant",
            hero_title_3: "Stop staring at the typing box. Find a better starting point.",
            hero_subtitle: "Apne chats se reply options dekho, profile bio improve karo, icebreakers banao aur conversations practise karo. Jo fit lage use edit karo aur khud send karo. Social aur romantic communication ke liye; matching ya date booking nahi.",
            hero_cta: "Tools Dekho",
            tab_screenshot: "Screenshot Analyzer",
            tab_icebreakers: "Icebreakers",
            tab_bio_optimizer: "Bio Optimizer",
            tab_practice: "Practice Partner",
            tab_saved: "Saved Items",
            screenshot_desc: "Chat screenshot upload karo aur 10 strategic reply options pao.",
            icebreakers_desc: "Profile details se 10 conversation starters explore karo. Use karne se pehle review aur edit karo.",
            bio_desc: "Apni profile ke liye 10 AI-written bio drafts banao, phir unhe review aur edit karo.",
            coach_desc: "Maeve ke optional AI feedback ke saath social aur romantic conversation wording practise karo.",
            btn_generate_replies: "Replies Generate Karo",
            btn_generate_openers: "Openers Generate Karo",
            btn_optimize_bio: "Bio Optimize Karo",
            btn_send: "Bhejo",
            btn_save: "Save Karo",
            btn_copy: "Copy",
            btn_copied: "Copied!",
            settings_title: "System Settings",
            setting_linguistic_shorthand: "Linguistic Shorthand",
            setting_linguistic_desc: "Lowercase aur casual spacing use karo",
            setting_emoji_format: "Emoji Formatting",
            setting_plexus: "Background Animation",
            setting_plexus_desc: "Battery save karne ke liye interactive lines band karo"
        }
    };

    // UI language is always English; saved manual preferences no longer select AI output.
    function getLanguage() { return 'en'; }
    function t(key, defaultVal) {
        return typeof DICTIONARY.en[key] === 'string' ? DICTIONARY.en[key] : (defaultVal !== undefined ? defaultVal : key);
    }
    function applyTranslations(root) {
        if (typeof document === 'undefined') return;
        var container = root || document;

        var textElements = container.querySelectorAll('[data-i18n]');
        for (var i = 0; i < textElements.length; i++) {
            var el = textElements[i];
            var key = el.getAttribute('data-i18n');
            if (key) {
                var translated = t(key);
                if (translated && translated !== key) {
                    el.textContent = translated;
                }
            }
        }

        var placeholderElements = container.querySelectorAll('[data-i18n-placeholder]');
        for (var j = 0; j < placeholderElements.length; j++) {
            var pel = placeholderElements[j];
            var pkey = pel.getAttribute('data-i18n-placeholder');
            if (pkey) {
                var ptrans = t(pkey);
                if (ptrans && ptrans !== pkey) {
                    pel.setAttribute('placeholder', ptrans);
                }
            }
        }
    }


    function init() {
        if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = 'en';
        applyTranslations();
    }
    window.wingmanI18n = {
        getLanguage: getLanguage,
        getLanguageMode: function () { return 'auto'; },
        setLanguage: function () { init(); return 'en'; },
        t: t,
        applyTranslations: applyTranslations,
        onLanguageChange: function () {},
        bindButtons: function () {},
        canonicalize: function () { return 'en'; },
        init: init
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }
})();

/**
 * WINGMAN CLIENT-SIDE PRICING DISPLAY
 * -------------------------------------------------------------------------
 * - Default: 'INR'
 * - INR is the only checkout currency; USD is a fixed display-only catalog
 * - Razorpay collection remains INR-only
 * - Persistence: localStorage['wingman_setting_currency'] (safe fail-soft)
 * - Single source of truth for presentation across index.html & app.html
 */
(function () {
    'use strict';

    var pricingSource = window.WINGMAN_PRICING;
    // Node-based tests import config.js directly; browser pages load the shared script first.
    if (!pricingSource && typeof module !== 'undefined' && module.exports) {
        pricingSource = require('./pricing-catalog.js');
    }
    if (!pricingSource || !pricingSource.PRICING_CATALOG) {
        throw new Error('The authoritative Wingman pricing catalog did not load.');
    }
    var STORAGE_KEY = pricingSource.STORAGE_KEY;
    var DEFAULT_CURRENCY = pricingSource.DEFAULT_CURRENCY;
    var SUPPORTED_CURRENCIES = pricingSource.SUPPORTED_CURRENCIES;
    var PRICING_CATALOG = pricingSource.PRICING_CATALOG;
    // Fixed USD presentation values are client-only; backend checkout amounts stay INR-authoritative.
    var USD_DISPLAY_PRICES = {
        starter: { displayAmountMinor: 499, regularMinor: null, formattedSale: '$4.99', formattedRegular: null, formattedPerCredit: '2.0¢ per credit', formattedSaving: null, ctaPrice: '$4.99' },
        pro: { displayAmountMinor: 999, regularMinor: null, formattedSale: '$9.99', formattedRegular: null, formattedPerCredit: '1.67¢ per credit', formattedSaving: null, ctaPrice: '$9.99' },
        elite: { displayAmountMinor: 1999, regularMinor: null, formattedSale: '$19.99', formattedRegular: null, formattedPerCredit: '0.67¢ per credit', formattedSaving: null, ctaPrice: '$19.99' },
        limited: { displayAmountMinor: 4999, regularMinor: null, formattedSale: '$49.99', formattedRegular: null, formattedPerCredit: '0.05¢ per credit', formattedSaving: null, formattedSavingLanding: null, formattedSavingApp: null, ctaPrice: '$49.99', buttonText: 'View VIP Bundle' }
    };
    var displayCatalog = {};
    Object.keys(PRICING_CATALOG).forEach(function (planId) {
        var usdPrice = USD_DISPLAY_PRICES[planId];
        if (!usdPrice) throw new Error('A fixed USD display price is missing for ' + planId + '.');
        var plan = PRICING_CATALOG[planId];
        displayCatalog[planId] = {
            ...plan,
            prices: { ...plan.prices, USD: usdPrice }
        };
    });
    var currentCurrency = DEFAULT_CURRENCY;
    var listeners = [];

    function safeGetStorage(key) {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem(key);
            }
        } catch (_) {}
        return null;
    }

    function safeSetStorage(key, val) {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(key, val);
            }
        } catch (_) {}
    }

    function canonicalize(curr) {
        if (!curr || typeof curr !== 'string') return DEFAULT_CURRENCY;
        var normalized = curr.trim().toUpperCase();
        if (SUPPORTED_CURRENCIES.indexOf(normalized) !== -1) return normalized;
        return DEFAULT_CURRENCY;
    }

    function getCurrency() {
        return currentCurrency;
    }

    function getPlan(planId) {
        return displayCatalog[planId] || null;
    }

    function getPlanPricing(planId, curr) {
        var plan = getPlan(planId);
        if (!plan) return null;
        var c = canonicalize(curr || currentCurrency);
        return plan.prices[c] || null;
    }

    function formatPlanSale(planId, curr) {
        var pricing = getPlanPricing(planId, curr);
        if (pricing) return pricing.formattedSale;
        return '';
    }

    function getPlanPriceNumber(planId, curr) {
        var pricing = getPlanPricing(planId, curr);
        if (!pricing) return null;
        var amountMinor = canonicalize(curr || currentCurrency) === 'USD'
            ? pricing.displayAmountMinor
            : pricing.amountMinor;
        return Number.isInteger(amountMinor) ? amountMinor / 100 : null;
    }

    function getCredits(planId) {
        var plan = getPlan(planId);
        return plan ? plan.credits : 0;
    }

    function updateCurrencyDisclosure() {
        if (typeof document === 'undefined') return;
        var message = currentCurrency === 'USD'
            ? 'Fixed USD prices are for display only; INR checkout is unavailable.'
            : 'Prices shown in INR. Paid checkout is currently unavailable in production.';
        ['pricingCurrencyDisclosure', 'appPricingCurrencyDisclosure'].forEach(function (id) {
            var disclosure = document.getElementById(id);
            if (disclosure) disclosure.textContent = message;
        });
    }

    function emitCurrencyChange() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](currentCurrency); } catch (e) { console.error('[currency listener error]', e); }
        }
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            try {
                var evt = new CustomEvent('wingman:currencychange', { detail: { currency: currentCurrency } });
                window.dispatchEvent(evt);
            } catch (_) {}
        }
    }

    function updateToggleButtonStates() {
        if (typeof document === 'undefined') return;
        var buttons = document.querySelectorAll('.currency-toggle-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var btnCurr = canonicalize(btn.getAttribute('data-currency'));
            btn.classList.remove('bg-violet-600', 'text-white', 'shadow-sm', 'text-slate-300', 'text-slate-400');
            if (btnCurr === currentCurrency) {
                btn.classList.add('bg-violet-600', 'text-white', 'shadow-sm');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.classList.add('text-slate-400');
                btn.setAttribute('aria-pressed', 'false');
            }
        }
    }

    function updatePricingDisplay(root) {
        if (typeof document === 'undefined') return;
        var container = root || document;

        var summaryCurrencyLabel = document.getElementById('summaryCurrencyLabel');
        if (summaryCurrencyLabel) summaryCurrencyLabel.textContent = currentCurrency;

        var priceElements = container.querySelectorAll('[data-plan][data-price-role]');
        for (var i = 0; i < priceElements.length; i++) {
            var el = priceElements[i];
            var planId = el.getAttribute('data-plan');
            var role = el.getAttribute('data-price-role');
            var pricing = getPlanPricing(planId, currentCurrency);
            if (!pricing) {
                if (currentCurrency === 'USD') {
                    var unavailableLabel = 'USD price unavailable';
                    if (role === 'sale' || role === 'per-credit') el.textContent = unavailableLabel;
                    if (role === 'regular' || role === 'saving') {
                        el.textContent = '';
                        el.hidden = true;
                        el.style.display = 'none';
                    }
                    if (role === 'button-price') el.textContent = unavailableLabel;
                    if (role === 'button-text') el.textContent = unavailableLabel;
                }
                continue;
            }

            if (role === 'sale') {
                el.textContent = pricing.formattedSale;
            } else if (role === 'regular') {
                el.textContent = pricing.formattedRegular || '';
                el.hidden = !pricing.formattedRegular;
                el.style.display = el.hidden ? 'none' : '';
            } else if (role === 'per-credit') {
                el.textContent = pricing.formattedPerCredit;
            } else if (role === 'saving') {
                var savingText;
                if (planId === 'limited') {
                    // Distinguish landing vs app modal if different copy is used
                    var isLanding = !!el.closest('#pricing');
                    savingText = isLanding ? pricing.formattedSavingLanding : pricing.formattedSavingApp;
                } else {
                    savingText = pricing.formattedSaving;
                }
                el.textContent = savingText || '';
                el.hidden = !savingText;
                el.style.display = el.hidden ? 'none' : '';
            } else if (role === 'cta-price' || role === 'button-text') {
                el.textContent = pricing.buttonText || ('Acquire ' + planId + ' - ' + pricing.formattedSale);
            } else if (role === 'button-price') {
                el.textContent = pricing.ctaPrice || pricing.formattedSale;
            }
        }

        // Also update any radio inputs with data-price attribute in app.html
        var radios = container.querySelectorAll("input[name='pricing_tier']");
        for (var r = 0; r < radios.length; r++) {
            var radio = radios[r];
            var rPlan = radio.value;
            var rPricing = getPlanPricing(rPlan, currentCurrency);
            if (rPricing) {
                var radioAmountMinor = currentCurrency === 'USD' ? rPricing.displayAmountMinor : rPricing.amountMinor;
                if (Number.isInteger(radioAmountMinor)) radio.setAttribute('data-price', (radioAmountMinor / 100).toFixed(2));
                else radio.removeAttribute('data-price');
                radio.setAttribute('data-price-formatted', rPricing.formattedSale);
                radio.setAttribute('data-currency', currentCurrency);
            } else if (currentCurrency === 'USD') {
                radio.removeAttribute('data-price');
                radio.setAttribute('data-price-formatted', 'USD price unavailable');
                radio.setAttribute('data-currency', currentCurrency);
            }
        }

        // Synchronize modal confirm purchase button text if present
        var purchaseBtnTextEl = document.getElementById('purchaseBtnText');
        if (purchaseBtnTextEl) {
            var activeRadio = document.querySelector("input[name='pricing_tier']:checked");
            var selectedTierValue = activeRadio ? activeRadio.value : 'elite';
            var selectedPlan = getPlan(selectedTierValue);
            var selectedPricing = getPlanPricing(selectedTierValue, currentCurrency);
            if (selectedPlan && selectedPricing) {
                var bundleLabel = selectedPlan.modalBundleName || 'Bundle';
                purchaseBtnTextEl.textContent = 'Purchasing not yet enabled';
                if (window.wingmanPayments) window.wingmanPayments.sync();
            }
        }
    }

    function setCurrency(newCurrency) {
        var valid = canonicalize(newCurrency);
        currentCurrency = valid;
        safeSetStorage(STORAGE_KEY, valid);

        updateToggleButtonStates();
        updatePricingDisplay();
        updateCurrencyDisclosure();
        emitCurrencyChange();

        return valid;
    }

    function onCurrencyChange(fn) {
        if (typeof fn === 'function') {
            listeners.push(fn);
        }
    }

    function bindCurrencyButtons() {
        if (typeof document === 'undefined') return;
        var buttons = document.querySelectorAll('.currency-toggle-btn');
        for (var i = 0; i < buttons.length; i++) {
            (function (btn) {
                if (btn.__wingmanCurrencyBound) return;
                btn.__wingmanCurrencyBound = true;
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var targetCurr = btn.getAttribute('data-currency');
                    setCurrency(targetCurr);
                });
            })(buttons[i]);
        }
        updateToggleButtonStates();
    }

    function init() {
        var saved = safeGetStorage(STORAGE_KEY);
        var initial = canonicalize(saved || DEFAULT_CURRENCY);
        currentCurrency = initial;
        bindCurrencyButtons();
        updatePricingDisplay();
        updateCurrencyDisclosure();
    }

    window.WINGMAN_PRICING_CATALOG = displayCatalog;
    window.wingmanCurrency = {
        getCurrency: getCurrency,
        setCurrency: setCurrency,
        canonicalize: canonicalize,
        getPlan: getPlan,
        getPlanPricing: getPlanPricing,
        formatPlanSale: formatPlanSale,
        getPlanPriceNumber: getPlanPriceNumber,
        getCredits: getCredits,
        updatePricingDisplay: updatePricingDisplay,
        onCurrencyChange: onCurrencyChange,
        bindButtons: bindCurrencyButtons,
        catalog: displayCatalog,
        supportedCurrencies: SUPPORTED_CURRENCIES,
        defaultCurrency: DEFAULT_CURRENCY,
        storageKey: STORAGE_KEY,
        init: init
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
        window.addEventListener('load', function () {
            bindCurrencyButtons();
            updatePricingDisplay();
        }, { once: true });
    }
})();

