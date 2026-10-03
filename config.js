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

    var MOBILE_QUERY = '(max-width: 767px)';
    var patched = false;

    function isMobile() {
        try {
            return window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
        } catch (_) {
            return window.innerWidth < 768;
        }
    }

    function refreshUnknownCreditLabels() {
        var state = window.state;
        if (!state) return;
        var hasAuthoritativeNumber = state.creditsStatus === 'loaded' && typeof state.credits === 'number';
        if (hasAuthoritativeNumber) return;

        // Only show "0 Credits" for signed-out state.
        // If authenticated, leave display so the loading/unknown state
        // resolves once the authoritative balance is restored.
        if (window.currentSupabaseSession && window.currentSupabaseSession.access_token) return;

        ['desktopCreditCount', 'mobileCreditCount'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.textContent = '0 Credits';
        });
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

        if (typeof window.switchTab === 'function') {
            var originalSwitchTab = window.switchTab;
            window.switchTab = function (tabId) {
                var result = originalSwitchTab.apply(this, arguments);
                if (isMobile()) {
                    requestAnimationFrame(function () {
                        var main = document.getElementById('mainContentCanvas') || document.querySelector('main');
                        try {
                            if (main && typeof main.scrollTo === 'function') main.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                        } catch (_) {}
                        try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, 0); }
                    });
                }
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
 * "Free Plan" means the account has only ever received the canonical 20 signup credits.
 * "Paid Plan" means the account has ever had credits beyond that signup grant. The database
 * persists this monotonic fact on the authenticated user's RLS-protected profile so refreshes
 * stay O(1) regardless of credit-ledger size.
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

        if (!window.supabaseClient || !window.supabaseClient.auth || typeof window.supabaseClient.auth.getSession !== 'function') {
            return Promise.resolve(null);
        }

        if (sessionHydrationInFlight) return sessionHydrationInFlight;

        var hydrationPromise;
        hydrationPromise = (async function () {
            try {
                var result = await window.supabaseClient.auth.getSession();
                if (result && result.error) throw result.error;

                // Do not replace a newer authenticated session that may have arrived while the
                // canonical getSession() call was pending.
                if (hasRestoredDashboardSession()) {
                    return window.currentSupabaseSession;
                }

                var session = result && result.data ? result.data.session : null;
                if (session && session.access_token && session.user && session.user.id) {
                    window.currentSupabaseSession = session;
                    window.currentSupabaseUser = session.user;
                    return session;
                }

                return null;
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
 * WINGMAN BILINGUAL CLIENT-SIDE i18n SYSTEM (English + Roman-script Hinglish)
 * -------------------------------------------------------------------------
 * - Default: 'en' (English)
 * - Supported: 'en', 'hinglish'
 * - Persistence: localStorage['wingman_language'] (fail-safe)
 * - Roman-script Hinglish only: zero Devanagari Unicode characters
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'wingman_language';
    var DEFAULT_LANG = 'en';

    var DICTIONARY = {
        en: {
            language_label: "Language",
            language_desc: "AI suggestions & app language",
            nav_how_it_works: "How It Works",
            nav_ai_coach: "24/7 AI Coach",
            nav_results: "Real-World Results",
            nav_pricing: "Pricing",
            nav_faq: "FAQ",
            nav_sign_in: "Sign In",
            nav_launch_app: "Launch App",
            hero_badge: "Next-Gen Dating Intelligence",
            hero_title_1: "Never Get",
            hero_title_2: "Left On Read",
            hero_title_3: "Again.",
            hero_subtitle: "AI Wingman engineered to turn dry conversations, stalled matches, and awkward pauses into effortless, magnetic dates.",
            hero_cta: "Fix My Dating Life",
            tab_screenshot: "Screenshot Analyzer",
            tab_icebreakers: "Icebreakers",
            tab_bio_optimizer: "Bio Optimizer",
            tab_practice: "Practice Partner",
            tab_saved: "Saved Items",
            screenshot_desc: "Upload a chat screenshot to get 10 strategic reply options.",
            icebreakers_desc: "Drop her bio or profile details to generate 10 charismatic openers.",
            bio_desc: "Transform your raw profile details into 10 high-status, charismatic bios.",
            coach_desc: "Real-time communication drills and unfiltered dating advice with Maeve.",
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
            nav_ai_coach: "24/7 AI Coach",
            nav_results: "Real Results",
            nav_pricing: "Pricing",
            nav_faq: "FAQ",
            nav_sign_in: "Sign In",
            nav_launch_app: "Launch App",
            hero_badge: "Next-Gen Dating Intelligence",
            hero_title_1: "Kabhi Bhi",
            hero_title_2: "Left On Read",
            hero_title_3: "Mat Raho.",
            hero_subtitle: "AI Wingman jo dry chats, stuck matches aur awkward pauses ko effortless, magnetic dates me badal de.",
            hero_cta: "Fix My Dating Life",
            tab_screenshot: "Screenshot Analyzer",
            tab_icebreakers: "Icebreakers",
            tab_bio_optimizer: "Bio Optimizer",
            tab_practice: "Practice Partner",
            tab_saved: "Saved Items",
            screenshot_desc: "Chat screenshot upload karo aur 10 strategic reply options pao.",
            icebreakers_desc: "Uski bio ya profile details daalo aur 10 witty openers generate karo.",
            bio_desc: "Apni basic profile details ko 10 high-status, charismatic bios me badlo.",
            coach_desc: "Maeve ke saath real-time chat drills aur dating strategy advice.",
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

    var currentLang = DEFAULT_LANG;
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

    function canonicalize(lang) {
        if (!lang || typeof lang !== 'string') return DEFAULT_LANG;
        var normalized = lang.trim().toLowerCase();
        if (normalized === 'hinglish' || normalized === 'hi-latn' || normalized === 'hi_latn') {
            return 'hinglish';
        }
        return 'en';
    }

    function getLanguage() {
        return currentLang;
    }

    function t(key, defaultVal) {
        var dict = DICTIONARY[currentLang] || DICTIONARY.en;
        if (dict && typeof dict[key] === 'string') {
            return dict[key];
        }
        if (DICTIONARY.en && typeof DICTIONARY.en[key] === 'string') {
            return DICTIONARY.en[key];
        }
        return defaultVal !== undefined ? defaultVal : key;
    }

    function updateToggleButtonStates() {
        if (typeof document === 'undefined') return;
        var buttons = document.querySelectorAll('.lang-toggle-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var btnLang = canonicalize(btn.getAttribute('data-lang'));
            if (btnLang === currentLang) {
                btn.classList.add('bg-violet-600', 'text-white');
                btn.classList.remove('text-slate-400');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.classList.remove('bg-violet-600', 'text-white');
                btn.classList.add('text-slate-400');
                btn.setAttribute('aria-pressed', 'false');
            }
        }
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

    function setLanguage(newLang) {
        var validLang = canonicalize(newLang);
        currentLang = validLang;
        safeSetStorage(STORAGE_KEY, validLang);

        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = validLang === 'hinglish' ? 'hi-Latn' : 'en';
        }

        updateToggleButtonStates();
        applyTranslations();

        for (var i = 0; i < listeners.length; i++) {
            try {
                listeners[i](validLang);
            } catch (e) {
                console.error('[i18n listener error]', e);
            }
        }

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            try {
                var evt = new CustomEvent('wingman:languagechange', { detail: { language: validLang } });
                window.dispatchEvent(evt);
            } catch (_) {}
        }

        return validLang;
    }

    function onLanguageChange(fn) {
        if (typeof fn === 'function') {
            listeners.push(fn);
        }
    }

    function bindLanguageButtons() {
        if (typeof document === 'undefined') return;
        var buttons = document.querySelectorAll('.lang-toggle-btn');
        for (var i = 0; i < buttons.length; i++) {
            (function (btn) {
                if (btn.__wingmanLangBound) return;
                btn.__wingmanLangBound = true;
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var targetLang = btn.getAttribute('data-lang');
                    setLanguage(targetLang);
                });
            })(buttons[i]);
        }
        updateToggleButtonStates();
    }

    function init() {
        var saved = safeGetStorage(STORAGE_KEY);
        var initial = canonicalize(saved || DEFAULT_LANG);
        currentLang = initial;
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = initial === 'hinglish' ? 'hi-Latn' : 'en';
        }
        bindLanguageButtons();
        applyTranslations();
    }

    window.wingmanI18n = {
        getLanguage: getLanguage,
        setLanguage: setLanguage,
        t: t,
        applyTranslations: applyTranslations,
        onLanguageChange: onLanguageChange,
        bindButtons: bindLanguageButtons,
        canonicalize: canonicalize,
        init: init
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
        window.addEventListener('load', bindLanguageButtons, { once: true });
    }
})();
