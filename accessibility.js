(function () {
    'use strict';

    var modalConfigs = {
        interstitialModal: { close: 'closeInterstitialModal', label: 'Age and consent' },
        authRequiredModal: { close: 'closeAuthRequiredModal', label: 'Sign in' },
        purchaseModal: { close: 'closePurchaseModal', label: 'Buy credits' },
        settingsModal: { close: 'closeSettingsModal', label: 'Settings' },
        cropModal: { close: 'closeCropModal', label: 'Crop image' },
        deleteAccountModal: { close: 'closeDeleteAccountModal', label: 'Delete account' },
        activationModal: { close: 'closeActivationModal', label: 'Activation' },
        unreadableErrorModal: { close: 'closeUnreadableErrorModal', label: 'Unreadable image' }
    };
    var states = new Map();

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        var style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.classList.contains('hidden') || el.classList.contains('pointer-events-none')) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function focusables(modal) {
        return Array.from(modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
            .filter(function (el) {
                var s = getComputedStyle(el);
                var r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
            });
    }

    function setDialogName(modal, config) {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('tabindex', '-1');
        var heading = modal.querySelector('h1,h2,h3,h4');
        if (heading) {
            if (!heading.id) heading.id = modal.id + '-title';
            modal.setAttribute('aria-labelledby', heading.id);
            modal.removeAttribute('aria-label');
        } else if (!modal.hasAttribute('aria-label')) {
            modal.setAttribute('aria-label', config.label + ' dialog');
        }
    }

    function setModalInteractiveState(modal, open) {
        if (open) {
            modal.inert = false;
            modal.removeAttribute('inert');
            modal.setAttribute('aria-hidden', 'false');
        } else {
            modal.inert = true;
            modal.setAttribute('inert', '');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    function enhanceCloseControls(modal, config) {
        modal.querySelectorAll('button').forEach(function (button) {
            var onclick = button.getAttribute('onclick') || '';
            var text = (button.innerText || button.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
            if (onclick.indexOf(config.close) !== -1 && (text === 'close' || text === '×' || text === '')) {
                if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Close ' + config.label.toLowerCase() + ' dialog');
                button.classList.add('a11y-icon-touch-target');
            }
        });
    }

    function openState(modal) {
        var st = states.get(modal) || { open: false, returnFocus: null };
        if (isVisible(modal) && !st.open) {
            st.open = true;
            st.returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
            setModalInteractiveState(modal, true);
            states.set(modal, st);
            setTimeout(function () {
                if (!isVisible(modal)) return;
                var first = focusables(modal)[0] || modal;
                try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} }
            }, 0);
        } else if (!isVisible(modal) && st.open) {
            st.open = false;
            setModalInteractiveState(modal, false);
            states.set(modal, st);
            var target = st.returnFocus;
            st.returnFocus = null;
            scheduleFocusAfterClose(target);
        } else if (!isVisible(modal)) {
            setModalInteractiveState(modal, false);
        }
    }

    function topOpenModal() {
        var open = Object.keys(modalConfigs).map(function (id) { return document.getElementById(id); }).filter(isVisible);
        open.sort(function (a, b) {
            return (parseInt(getComputedStyle(a).zIndex || '0', 10) || 0) - (parseInt(getComputedStyle(b).zIndex || '0', 10) || 0);
        });
        return open.length ? open[open.length - 1] : null;
    }

    function focusElement(target) {
        if (!target || !target.isConnected || typeof target.focus !== 'function') return;
        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
    }

    function canRestoreFocus(target) {
        if (!target || !target.isConnected || target === document.body || typeof target.focus !== 'function') return false;
        var owner = target.closest && target.closest('[role="dialog"], [inert]');
        return isVisible(target) && (!owner || (isVisible(owner) && !owner.hasAttribute('inert')));
    }

    function focusAuthFallback() {
        var candidates = [document.getElementById('desktopAuthBtn'), document.getElementById('mobileAuthBtn')];
        document.querySelectorAll('button[onclick*="openAuthRequiredModal"]').forEach(function (candidate) { candidates.push(candidate); });
        var fallback = candidates.find(function (candidate) {
            return candidate && !candidate.disabled && isVisible(candidate) && !candidate.closest('[inert]');
        });
        if (fallback) focusElement(fallback);
    }

    function scheduleFocusAfterClose(target) {
        setTimeout(function () {
            var activeModal = topOpenModal();
            if (activeModal) {
                if (!activeModal.contains(document.activeElement)) {
                    focusElement(focusables(activeModal)[0] || activeModal);
                }
                return;
            }
            if (canRestoreFocus(target)) focusElement(target);
            else focusAuthFallback();
        }, 0);
    }

    function closeTopModal(modal) {
        var cfg = modalConfigs[modal.id];
        if (!cfg) return false;
        var fn = window[cfg.close];
        if (typeof fn !== 'function') return false;
        try { fn(); return true; } catch (_) { return false; }
    }

    function enhancePasswordToggle() {
        var button = document.getElementById('togglePasswordBtn');
        var input = document.getElementById('authPasswordInput');
        if (!button || !input) return;
        button.removeAttribute('tabindex');
        button.classList.add('a11y-icon-touch-target');
        function sync() {
            button.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
        }
        sync();
        button.addEventListener('click', function () { setTimeout(sync, 0); });
    }

    function enhanceNonNativeActions() {
        var focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
        document.querySelectorAll('[onclick*="openPurchaseModal"]').forEach(function (el) {
            if (/^(BUTTON|A)$/.test(el.tagName)) return;

            var nestedFocusable = el.querySelector(focusableSelector);
            if (nestedFocusable) {
                el.removeAttribute('role');
                el.removeAttribute('tabindex');
                el.removeAttribute('aria-label');

                el.querySelectorAll('[onclick*="openPurchaseModal"]').forEach(function (child) {
                    if (child === el || child.__wingmanPurchaseBubbleGuard) return;
                    child.__wingmanPurchaseBubbleGuard = true;
                    child.addEventListener('click', function (event) {
                        event.stopPropagation();
                    });
                });
                return;
            }

            el.setAttribute('role', 'button');
            if (el.tabIndex < 0) el.tabIndex = 0;
            if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Buy credits');
            if (!el.__wingmanKeyboardAction) {
                el.__wingmanKeyboardAction = true;
                el.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        el.click();
                    }
                });
            }
        });
    }

    function wrapModalFunctions(modal, config) {
        var openName = config.close.replace(/^close/, 'open');
        var originalOpen = window[openName];
        if (typeof originalOpen === 'function' && !originalOpen.__wingmanA11yWrapped) {
            var wrappedOpen = function () {
                var st = states.get(modal) || { open: false, returnFocus: null };
                if (!st.open) {
                    var event = arguments[0];
                    var invoker = event && event.currentTarget && event.currentTarget.isConnected ? event.currentTarget : null;
                    st.returnFocus = invoker || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
                }
                setModalInteractiveState(modal, true);
                var result = originalOpen.apply(this, arguments);
                st.open = true;
                states.set(modal, st);
                var first = focusables(modal)[0] || modal;
                focusElement(first);
                return result;
            };
            wrappedOpen.__wingmanA11yWrapped = true;
            window[openName] = wrappedOpen;
        }

        var originalClose = window[config.close];
        if (typeof originalClose === 'function' && !originalClose.__wingmanA11yWrapped) {
            var wrappedClose = function () {
                var st = states.get(modal) || { open: false, returnFocus: null };
                var target = st.returnFocus;
                var result = originalClose.apply(this, arguments);
                st.open = false;
                st.returnFocus = null;
                setModalInteractiveState(modal, false);
                states.set(modal, st);
                scheduleFocusAfterClose(target);
                return result;
            };
            wrappedClose.__wingmanA11yWrapped = true;
            window[config.close] = wrappedClose;
        }
    }

    function initModal(id) {
            var modal = document.getElementById(id);
            if (!modal || states.has(modal)) return;
            var cfg = modalConfigs[id];
            setDialogName(modal, cfg);
            enhanceCloseControls(modal, cfg);
            states.set(modal, { open: false, returnFocus: null });
            wrapModalFunctions(modal, cfg);
            openState(modal);
            new MutationObserver(function () { openState(modal); }).observe(modal, {
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden']
            });
    }

    window.registerWingmanModal = function (id, config) {
        if (!id || !config || !config.close) return false;
        modalConfigs[id] = config;
        initModal(id);
        return !!document.getElementById(id);
    };

    function init() {
        Object.keys(modalConfigs).forEach(initModal);
        enhancePasswordToggle();
        enhanceNonNativeActions();
    }

    document.addEventListener('keydown', function (event) {
        var modal = topOpenModal();
        if (!modal) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeTopModal(modal);
            return;
        }
        if (event.key !== 'Tab') return;
        var list = focusables(modal);
        if (!list.length) {
            event.preventDefault();
            modal.focus();
            return;
        }
        var first = list[0];
        var last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        } else if (!modal.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
        }
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();

/* Production blocker runtime loads after app.js and after the accessibility layer is registered. */
(function () {
    'use strict';
    var loaded = false;
    function loadProductionRuntime() {
        if (loaded || document.querySelector('script[data-wingman-production-runtime]')) return;
        loaded = true;
        var script = document.createElement('script');
        script.src = 'vendor/production-runtime.js';
        script.setAttribute('data-wingman-production-runtime', 'true');
        script.async = false;
        script.onerror = function () {
            loaded = false;
            console.error('[MyWingman] Production runtime failed to load.');
        };
        document.head.appendChild(script);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadProductionRuntime, { once: true });
    else loadProductionRuntime();
})();

/* Credit read safety override: app.js loads first; this replaces only the credit-balance read path. */
(function installCreditReadSafetyOverride() {
    'use strict';

    if (!window || typeof window.checkCreditBalance !== 'function' || !window.state) return;

    const inFlightCreditReads = new Map();

    function getActiveCreditUserId() {
        if (window.currentSupabaseUser && window.currentSupabaseUser.id) {
            return window.currentSupabaseUser.id;
        }
        if (window.currentSupabaseSession && window.currentSupabaseSession.user && window.currentSupabaseSession.user.id) {
            return window.currentSupabaseSession.user.id;
        }
        return null;
    }

    function staleResult() {
        return { success: false, status: 'stale', credits: window.state.credits };
    }

    window.checkCreditBalance = function () {
        const initialUserId = getActiveCreditUserId();
        const mapKey = initialUserId;

        if (mapKey && inFlightCreditReads.has(mapKey)) {
            return inFlightCreditReads.get(mapKey);
        }

        let requestUserId = initialUserId;
        let requestPromise;

        requestPromise = (async function () {
            window.state.creditsStatus = 'loading';

            try {
                let session = null;

                if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.getSession === 'function') {
                    try {
                        const sessionResult = await window.supabaseClient.auth.getSession();
                        if (!sessionResult.error && sessionResult.data && sessionResult.data.session) {
                            session = sessionResult.data.session;
                        }
                    } catch (sessionError) {
                        console.warn('[CreditSync] Notice querying Supabase session:', sessionError);
                    }
                }

                if (!session) {
                    session = window.currentSupabaseSession || null;
                }

                const sessionUserId = session && session.user && session.user.id ? session.user.id : null;
                const activeBeforeSessionCommit = getActiveCreditUserId();

                if (requestUserId && sessionUserId && sessionUserId !== requestUserId) {
                    return staleResult();
                }
                if (requestUserId && activeBeforeSessionCommit && activeBeforeSessionCommit !== requestUserId) {
                    return staleResult();
                }
                if (!requestUserId && activeBeforeSessionCommit && sessionUserId && activeBeforeSessionCommit !== sessionUserId) {
                    return staleResult();
                }

                if (!requestUserId && sessionUserId) {
                    requestUserId = sessionUserId;
                }

                if (session && sessionUserId) {
                    window.currentSupabaseSession = session;
                    window.currentSupabaseUser = session.user;
                }

                const user = session && session.user ? session.user : window.currentSupabaseUser;
                const userId = user && user.id ? user.id : null;

                if (!userId) {
                    if (getActiveCreditUserId()) return staleResult();
                    window.state.creditsStatus = 'idle';
                    return { success: false, status: 'unauthenticated', credits: window.state.credits };
                }

                if (!requestUserId) requestUserId = userId;
                if (userId !== requestUserId || getActiveCreditUserId() !== requestUserId) {
                    return staleResult();
                }

                function requestIsCurrent() {
                    return !!requestUserId && getActiveCreditUserId() === requestUserId;
                }

                // 1. Direct authoritative profile read. Errors fall through to the existing fallbacks.
                if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
                    try {
                        const directResult = await window.supabaseClient
                            .from('profiles')
                            .select('credits')
                            .eq('id', userId)
                            .maybeSingle();

                        if (!requestIsCurrent()) return staleResult();

                        if (!directResult.error && directResult.data && typeof directResult.data.credits === 'number') {
                            window.updateUICredits(directResult.data.credits);
                            return { success: true, status: 'loaded', credits: directResult.data.credits };
                        }

                        if (!directResult.error && !directResult.data) {
                            window.state.credits = null;
                            window.state.creditsStatus = 'missing_profile';
                            return { success: false, status: 'missing_profile', code: 'PROFILE_MISSING' };
                        }
                    } catch (dbError) {
                        console.warn('[CreditSync] Supabase direct profiles query notice:', dbError);
                    }
                }

                if (!requestIsCurrent()) return staleResult();

                // 2. Existing client fallback. It receives only the authoritative Supabase user ID.
                if (typeof window.fetchProfileCredits === 'function') {
                    try {
                        const creditsResult = await window.fetchProfileCredits(userId);
                        if (!requestIsCurrent()) return staleResult();

                        if (typeof creditsResult === 'number') {
                            window.updateUICredits(creditsResult);
                            return { success: true, status: 'loaded', credits: creditsResult };
                        }

                        if (creditsResult && creditsResult.profileMissing) {
                            window.state.credits = null;
                            window.state.creditsStatus = 'missing_profile';
                            return { success: false, status: 'missing_profile', code: 'PROFILE_MISSING' };
                        }
                    } catch (profileError) {
                        console.warn('[CreditSync] fetchProfileCredits notice:', profileError);
                    }
                }

                if (!requestIsCurrent()) return staleResult();

                // 3. Authenticated API fallback.
                const apiBase = typeof window.getApiBase === 'function' ? window.getApiBase() : '';
                const authHeaders = typeof window.getSupabaseAuthHeaders === 'function'
                    ? await window.getSupabaseAuthHeaders()
                    : {};

                if (!requestIsCurrent()) return staleResult();

                if (authHeaders && authHeaders.Authorization) {
                    const response = await fetch((apiBase || '') + '/api/credits', { headers: authHeaders });
                    if (!requestIsCurrent()) return staleResult();

                    if (response.status === 404) {
                        const errorData = await response.json().catch(function () { return {}; });
                        if (!requestIsCurrent()) return staleResult();

                        if (errorData && (errorData.error === 'PROFILE_MISSING' || errorData.code === 'PROFILE_MISSING')) {
                            window.state.credits = null;
                            window.state.creditsStatus = 'missing_profile';
                            return { success: false, status: 'missing_profile', code: 'PROFILE_MISSING' };
                        }
                    }

                    if (response.ok) {
                        const responseJson = await response.json();
                        if (!requestIsCurrent()) return staleResult();

                        if (responseJson && typeof responseJson.credits === 'number') {
                            window.updateUICredits(responseJson.credits);
                            return { success: true, status: 'loaded', credits: responseJson.credits };
                        }

                        if (responseJson && responseJson.data && typeof responseJson.data.credits_inr === 'number') {
                            const creditCount = Math.round(responseJson.data.credits_inr * 10);
                            window.updateUICredits(creditCount);
                            return { success: true, status: 'loaded', credits: creditCount };
                        }
                    }
                }

                if (!requestIsCurrent()) return staleResult();
                window.state.creditsStatus = 'error';
                return { success: false, status: 'error', credits: window.state.credits };
            } catch (error) {
                console.warn('[CreditSync] Error syncing credits from Supabase profiles:', error);
                if (requestUserId && getActiveCreditUserId() !== requestUserId) {
                    return staleResult();
                }
                window.state.creditsStatus = 'error';
                return { success: false, status: 'error', credits: window.state.credits, error: error };
            } finally {
                if (mapKey && inFlightCreditReads.get(mapKey) === requestPromise) {
                    inFlightCreditReads.delete(mapKey);
                }
            }
        })();

        if (mapKey) {
            inFlightCreditReads.set(mapKey, requestPromise);
        }

        return requestPromise;
    };

    window.fetchAndSyncUserCredits = window.checkCreditBalance;
})();
