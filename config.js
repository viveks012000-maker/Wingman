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

    function repairMobileChatGeometry() {
        if (!isMobile()) return;

        var wrapper = document.querySelector('.chatbox-wrapper');
        if (wrapper) {
            wrapper.style.setProperty('min-height', '350px', 'important');
            wrapper.style.setProperty('height', 'calc(100dvh - 300px)', 'important');
            wrapper.style.setProperty('max-height', '620px', 'important');
            wrapper.style.setProperty('overflow', 'hidden', 'important');
            wrapper.style.setProperty('backdrop-filter', 'none', 'important');
            wrapper.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        }

        var messages = document.getElementById('chatbox-messages-container');
        if (messages) {
            messages.style.setProperty('min-height', '0', 'important');
            messages.style.setProperty('max-height', 'none', 'important');
            messages.style.setProperty('overflow-y', 'auto', 'important');
        }

        var footer = document.querySelector('.chatbox-footer-sticky-wrapper');
        if (footer) {
            footer.style.setProperty('position', 'relative', 'important');
            footer.style.setProperty('bottom', 'auto', 'important');
        }

        var canvas = document.getElementById('ambient-plexus-canvas');
        if (canvas) canvas.style.setProperty('display', 'none', 'important');
        if (typeof window.stopPlexusAnimation === 'function') {
            try { window.stopPlexusAnimation(); } catch (_) {}
        }
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
                repairMobileChatGeometry();
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
                        repairMobileChatGeometry();
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
        repairMobileChatGeometry();
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
        else repairMobileChatGeometry();
    }, { passive: true });
})();
