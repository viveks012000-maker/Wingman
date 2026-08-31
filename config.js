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

    function getApiBase() {
        if (typeof window === 'undefined' || !window.location) return '';
        var hostname = window.location.hostname || '';
        var protocol = window.location.protocol || '';
        var origin = window.location.origin || '';
        var isLocalEnv = protocol === 'file:' || origin === 'null' || hostname === 'localhost' ||
            hostname === '127.0.0.1' || hostname.indexOf('192.168.') === 0 ||
            hostname.indexOf('10.') === 0 || hostname.endsWith('.local');

        if (isLocalEnv) return 'http://localhost:3000';
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

        ['desktopCreditCount', 'mobileCreditCount'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.textContent = 'Credits —';
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
        else if (typeof window.stopPlexusAnimation === 'function' && isMobile()) {
            try { window.stopPlexusAnimation(); } catch (_) {}
        }
    }, { passive: true });
})();

/*
 * Account plan badge.
 * "Free Plan" means the account has only ever received the canonical 50 signup credits.
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

            setPlanBadge('Plan —');
            var plan = await determinePlan(user.id);
            if (plan === 'paid') setPlanBadge('Paid Plan');
            else if (plan === 'free') setPlanBadge('Free Plan');
            else setPlanBadge('Plan —');
        } catch (err) {
            console.warn('[PlanBadge] Unable to determine account plan:', err && err.message ? err.message : err);
            setPlanBadge('Plan —');
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
