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

    function reconcileDashboardSession() {
        if (!window.state) return false;

        if (typeof window.checkDashboardAuth === 'function') {
            window.checkDashboardAuth();
        }

        if (hasRestoredDashboardSession()) {
            refreshAuthoritativeCredits();
        }
        return true;
    }

    function installSessionSafeAuthButton() {
        if (!window.state || typeof window.handleAuthBtnClick !== 'function') return false;
        if (window.handleAuthBtnClick.__wingmanSessionSafe) return true;

        var safeHandler = function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();

            // The visible Sign In / Account control is never a logout control. If a restored
            // session exists but the DOM is stale, reconcile it in-place rather than signing out.
            if (hasRestoredDashboardSession()) {
                reconcileDashboardSession();
                return false;
            }

            if (typeof window.openAuthRequiredModal === 'function') {
                window.openAuthRequiredModal(e);
            }
            return false;
        };
        safeHandler.__wingmanSessionSafe = true;
        window.handleAuthBtnClick = safeHandler;
        return true;
    }

    function patchSessionBootstrap() {
        if (!window.state) return false;
        installSessionSafeAuthButton();
        return reconcileDashboardSession();
    }

    function scheduleSessionBootstrap(delay) {
        if (reconcileTimer) clearTimeout(reconcileTimer);
        reconcileTimer = setTimeout(function () {
            reconcileTimer = null;
            if (!patchSessionBootstrap()) {
                // app.js may still be defining handlers. Retry briefly without creating a loop.
                setTimeout(patchSessionBootstrap, 120);
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
