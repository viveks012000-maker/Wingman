from pathlib import Path


def replace_exact(path, old, new, expected=1):
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected}, found {count} for {old[:100]!r}")
    p.write_text(s.replace(old, new))


accessibility_js = r'''(function () {
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
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
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
            modal.setAttribute('aria-hidden', 'false');
            states.set(modal, st);
            setTimeout(function () {
                if (!isVisible(modal)) return;
                var first = focusables(modal)[0] || modal;
                try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} }
            }, 0);
        } else if (!isVisible(modal) && st.open) {
            st.open = false;
            modal.setAttribute('aria-hidden', 'true');
            states.set(modal, st);
            var target = st.returnFocus;
            st.returnFocus = null;
            if (target && target.isConnected && typeof target.focus === 'function') {
                setTimeout(function () {
                    try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
                }, 0);
            }
        } else if (!isVisible(modal)) {
            modal.setAttribute('aria-hidden', 'true');
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
        document.querySelectorAll('[onclick*="openPurchaseModal"]').forEach(function (el) {
            if (/^(BUTTON|A)$/.test(el.tagName)) return;
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

    function init() {
        Object.keys(modalConfigs).forEach(function (id) {
            var modal = document.getElementById(id);
            if (!modal) return;
            var cfg = modalConfigs[id];
            setDialogName(modal, cfg);
            enhanceCloseControls(modal, cfg);
            states.set(modal, { open: false, returnFocus: null });
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
'''
Path('accessibility.js').write_text(accessibility_js)

replace_exact(
    'app.html',
    '    <script src="app.js"></script>\n</body>',
    '    <script src="app.js"></script>\n    <script src="accessibility.js"></script>\n</body>'
)
replace_exact(
    'index.html',
    '</body>\n</html>',
    '    <script src="accessibility.js"></script>\n</body>\n</html>'
)

replace_exact(
    'scripts/build-netlify-dist.js',
    "  'config.js',\n  'supabaseClient.js',",
    "  'config.js',\n  'accessibility.js',\n  'supabaseClient.js',"
)
replace_exact(
    'scripts/build-netlify-dist.js',
    "    '/config.js',\n    '  Cache-Control: no-cache, must-revalidate',\n    '/supabaseClient.js',",
    "    '/config.js',\n    '  Cache-Control: no-cache, must-revalidate',\n    '/accessibility.js',\n    '  Cache-Control: no-cache, must-revalidate',\n    '/supabaseClient.js',"
)

replace_exact(
    'index.html',
    'text-[10px] text-slate-500/70 max-w-xl',
    'text-[10px] text-slate-400 max-w-xl'
)

for name in ['index.html', 'terms.html', 'privacy.html', 'refund.html']:
    p = Path(name)
    s = p.read_text()
    p.write_text(s.replace('hover:underline', 'underline underline-offset-2 hover:no-underline'))

style = Path('style.css')
s = style.read_text()
marker = 'Accessibility hardening: cross-browser mobile + keyboard contracts.'
if marker in s:
    raise SystemExit('style accessibility block already exists unexpectedly')
s += r'''

/* Accessibility hardening: cross-browser mobile + keyboard contracts. */
.a11y-icon-touch-target {
    min-width: 44px !important;
    min-height: 44px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
}

#analyzeEmptyState > p:nth-child(3),
#screenshotPreviewContainer > div > p:nth-child(3) {
    color: #9ca3af !important;
}

@media (max-width: 767px) {
    #authEmailInput,
    #authPasswordInput,
    #forgotEmailInput,
    #resetEmailInput,
    #bioInput,
    #auditBioInput,
    #simulator-chat-input {
        font-size: 16px !important;
    }
}
'''
style.write_text(s)

p = Path('tests/browser_viewport_live_qa.js')
s = p.read_text()
needle = '''                if (width <= 430 && pageName === 'app.html') {
                    const maeveFontPx = await page.$eval('#simulator-chat-input', el => parseFloat(getComputedStyle(el).fontSize));
                    if (maeveFontPx < 16) {
                        throw new Error(`Maeve mobile input must compute to >=16px to avoid iOS focus zoom; got ${maeveFontPx}px at ${width}px`);
                    }
                }'''
replacement = '''                if (width <= 430 && pageName === 'app.html') {
                    const mobileInputFonts = await page.evaluate(() => ['authEmailInput','authPasswordInput','resetEmailInput','bioInput','auditBioInput','simulator-chat-input'].map(id => document.getElementById(id)).filter(Boolean).map(el => ({ id: el.id, px: parseFloat(getComputedStyle(el).fontSize) })));
                    const undersized = mobileInputFonts.filter(x => x.px < 16);
                    if (undersized.length) {
                        throw new Error(`Mobile text inputs must compute to >=16px to avoid iOS focus zoom: ${JSON.stringify(undersized)}`);
                    }

                    await page.evaluate(() => window.openAuthRequiredModal());
                    await page.waitForTimeout(30);
                    const appAuth = await page.evaluate(() => {
                        const m = document.getElementById('authRequiredModal');
                        const close = [...m.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('closeAuthRequiredModal'));
                        const eye = document.getElementById('togglePasswordBtn');
                        const cr = close.getBoundingClientRect();
                        const er = eye.getBoundingClientRect();
                        return {
                            role: m.getAttribute('role'),
                            modal: m.getAttribute('aria-modal'),
                            labelledby: m.getAttribute('aria-labelledby'),
                            focused: m.contains(document.activeElement),
                            close: { w: cr.width, h: cr.height, label: close.getAttribute('aria-label') },
                            eye: { w: er.width, h: er.height, label: eye.getAttribute('aria-label'), tabIndex: eye.tabIndex }
                        };
                    });
                    if (appAuth.role !== 'dialog' || appAuth.modal !== 'true' || !appAuth.labelledby || !appAuth.focused) throw new Error(`App auth dialog semantics/focus invalid: ${JSON.stringify(appAuth)}`);
                    if (appAuth.close.w < 40 || appAuth.close.h < 40 || !appAuth.close.label) throw new Error(`App auth close target invalid: ${JSON.stringify(appAuth.close)}`);
                    if (appAuth.eye.w < 40 || appAuth.eye.h < 40 || appAuth.eye.tabIndex < 0 || appAuth.eye.label !== 'Show password') throw new Error(`App password toggle invalid: ${JSON.stringify(appAuth.eye)}`);
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(30);
                    if (await page.isVisible('#authRequiredModal')) throw new Error('Escape did not close app auth dialog');

                    const buySemantics = await page.evaluate(() => {
                        const candidates = [...document.querySelectorAll('[onclick*="openPurchaseModal"]')].filter(el => el.tagName !== 'BUTTON' && el.tagName !== 'A');
                        return candidates.map(el => ({ role: el.getAttribute('role'), tabIndex: el.tabIndex, label: el.getAttribute('aria-label') }));
                    });
                    if (buySemantics.some(x => x.role !== 'button' || x.tabIndex < 0 || !x.label)) throw new Error(`Non-native Buy Credits control lacks keyboard semantics: ${JSON.stringify(buySemantics)}`);
                }'''
if s.count(needle) != 1:
    raise SystemExit(f'app browser QA anchor mismatch: {s.count(needle)}')
s = s.replace(needle, replacement)

needle2 = '''                    await page.evaluate(() => window.openInterstitialModal());
                    await page.waitForTimeout(20);
                    const interstitialClose = await page.$eval('#interstitialModal button[aria-label="Close age and consent dialog"]', el => {'''
replacement2 = '''                    await page.evaluate(() => window.openInterstitialModal());
                    await page.waitForTimeout(20);
                    const interstitialSemantics = await page.evaluate(() => {
                        const m = document.getElementById('interstitialModal');
                        return { role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), labelledby: m.getAttribute('aria-labelledby'), focused: m.contains(document.activeElement) };
                    });
                    if (interstitialSemantics.role !== 'dialog' || interstitialSemantics.modal !== 'true' || !interstitialSemantics.labelledby || !interstitialSemantics.focused) throw new Error(`Interstitial dialog semantics/focus invalid: ${JSON.stringify(interstitialSemantics)}`);
                    const interstitialClose = await page.$eval('#interstitialModal button[aria-label="Close age and consent dialog"]', el => {'''
if s.count(needle2) != 1:
    raise SystemExit(f'index interstitial anchor mismatch: {s.count(needle2)}')
s = s.replace(needle2, replacement2)

needle3 = '''                    await page.evaluate(() => window.openAuthRequiredModal());
                    await page.waitForTimeout(20);
                    const authTargets = await page.evaluate(() => {
                        const close = document.querySelector('#authRequiredModal button[aria-label="Close sign-in dialog"]');'''
replacement3 = '''                    await page.evaluate(() => window.openAuthRequiredModal());
                    await page.waitForTimeout(20);
                    const authTargets = await page.evaluate(() => {
                        const modal = document.getElementById('authRequiredModal');
                        const close = document.querySelector('#authRequiredModal button[aria-label="Close sign-in dialog"]');'''
if s.count(needle3) != 1:
    raise SystemExit(f'index auth anchor mismatch: {s.count(needle3)}')
s = s.replace(needle3, replacement3)

old_return = '''                        return {
                            close: { width: cr.width, height: cr.height, label: close.getAttribute('aria-label') },
                            eye: { width: er.width, height: er.height, label: eye.getAttribute('aria-label'), tabIndex: eye.tabIndex }
                        };'''
new_return = '''                        return {
                            modal: { role: modal.getAttribute('role'), ariaModal: modal.getAttribute('aria-modal'), labelledby: modal.getAttribute('aria-labelledby'), focused: modal.contains(document.activeElement) },
                            close: { width: cr.width, height: cr.height, label: close.getAttribute('aria-label') },
                            eye: { width: er.width, height: er.height, label: eye.getAttribute('aria-label'), tabIndex: eye.tabIndex }
                        };'''
if s.count(old_return) != 1:
    raise SystemExit(f'auth return anchor mismatch: {s.count(old_return)}')
s = s.replace(old_return, new_return)

old_if = '''                    if (authTargets.close.width < 40 || authTargets.close.height < 40) {'''
new_if = '''                    if (authTargets.modal.role !== 'dialog' || authTargets.modal.ariaModal !== 'true' || !authTargets.modal.labelledby || !authTargets.modal.focused) {
                        throw new Error(`Auth dialog semantics/focus invalid: ${JSON.stringify(authTargets.modal)}`);
                    }
                    if (authTargets.close.width < 40 || authTargets.close.height < 40) {'''
if s.count(old_if) != 1:
    raise SystemExit(f'auth if anchor mismatch: {s.count(old_if)}')
p.write_text(s.replace(old_if, new_if))
