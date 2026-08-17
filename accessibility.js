(function () {
    'use strict';

    var modalConfigs = {
        interstitialModal: { close: 'closeInterstitialModal', label: 'Age and consent' },
        authRequiredModal: { close: 'closeAuthRequiredModal', label: 'Sign in' },
        purchaseModal: { close: 'closePurchaseModal', label: 'Buy credits' },
        settingsModal: { close: 'closeSettingsModal', label: 'Settings' },
        cropModal: { close: 'closeCropModal', label: 'Crop image' },
        deleteAccountModal: { close: 'closeDeleteAccountModal', label: 'Delete account' }
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
            if (target && target.isConnected && typeof target.focus === 'function') {
                setTimeout(function () {
                    try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
                }, 0);
            }
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
                // Do not create an interactive parent around an already-focusable child.
                // The native child remains the keyboard-accessible purchase action.
                el.removeAttribute('role');
                el.removeAttribute('tabindex');
                el.removeAttribute('aria-label');

                // Avoid calling the same purchase-modal action twice when a nested
                // purchase control bubbles to the clickable card container.
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
                    st.returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
                }
                setModalInteractiveState(modal, true);
                var result = originalOpen.apply(this, arguments);
                st.open = true;
                states.set(modal, st);
                var first = focusables(modal)[0] || modal;
                try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} }
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
                if (target && target.isConnected && typeof target.focus === 'function') {
                    setTimeout(function () {
                        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
                    }, 0);
                }
                return result;
            };
            wrappedClose.__wingmanA11yWrapped = true;
            window[config.close] = wrappedClose;
        }
    }

    function init() {
        Object.keys(modalConfigs).forEach(function (id) {
            var modal = document.getElementById(id);
            if (!modal) return;
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
        });
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
