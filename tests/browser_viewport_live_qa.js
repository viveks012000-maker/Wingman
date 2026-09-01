/**
 * Real Headless Browser Viewport QA Runner (Playwright)
 * 
 * Verifies document.documentElement.scrollWidth <= window.innerWidth
 * across 320, 360, 375, 390, 412, 430, 768, 1024, 1440 px viewports
 * for index.html, app.html, terms.html, privacy.html, refund.html.
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3899;
const PAGES = ['index.html', 'app.html', 'terms.html', 'privacy.html', 'refund.html'];
const VIEWPORTS = [320, 360, 375, 390, 412, 430, 768, 1024, 1440];

// MIME type dictionary
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

async function runBrowserQA() {
    console.log('\n============================================================');
    console.log('🌐 RUNNING HEADLESS BROWSER RESPONSIVE VIEWPORT QA');
    console.log('============================================================\n');

    // 1. Start local static server
    const server = http.createServer((req, res) => {
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/') reqPath = '/index.html';
        const filePath = path.join(__dirname, '..', reqPath);

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                return;
            }
            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            res.end(data);
        });
    });

    await new Promise((resolve) => server.listen(PORT, resolve));
    console.log(`📡 Local static test server listening on http://localhost:${PORT}`);

    let browser;
    let totalChecks = 0;
    let passedChecks = 0;

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        const pageErrors = [];
        page.on('pageerror', (err) => {
            console.error(`  ❌ [PAGE ERROR]: ${err.message}\n${err.stack || ''}`);
            pageErrors.push(err);
        });

        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                // Filter out non-fatal offline backend connection attempts in mock static env if any
                if (text.includes('SyntaxError') || text.includes('Uncaught') || text.includes('ReferenceError') || text.includes('TypeError')) {
                    console.error(`  ❌ [CONSOLE JS ERROR]: ${text}`);
                    pageErrors.push(new Error(`Browser Console JS Error: ${text}`));
                }
            }
        });

        for (const pageName of PAGES) {
            console.log(`\n▶ Testing [${pageName}] across all 9 viewports:`);
            const url = `http://localhost:${PORT}/${pageName}`;

            for (const width of VIEWPORTS) {
                totalChecks++;
                await page.setViewportSize({ width, height: 800 });
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(100);

                // Mobile usability regressions found by the production cross-browser audit.
                if (width <= 430 && pageName === 'app.html') {
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
                        const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
                        const candidates = [...document.querySelectorAll('[onclick*="openPurchaseModal"]')].filter(el => el.tagName !== 'BUTTON' && el.tagName !== 'A');
                        return candidates.map(el => ({
                            hasFocusableChild: !!el.querySelector(focusableSelector),
                            role: el.getAttribute('role'),
                            tabIndex: el.tabIndex,
                            label: el.getAttribute('aria-label')
                        }));
                    });
                    const nestedInvalid = buySemantics.filter(x => x.hasFocusableChild && (x.role === 'button' || x.tabIndex >= 0));
                    if (nestedInvalid.length) throw new Error(`Buy Credits container with focusable descendant must not become another interactive parent: ${JSON.stringify(nestedInvalid)}`);
                    const standaloneInvalid = buySemantics.filter(x => !x.hasFocusableChild && (x.role !== 'button' || x.tabIndex < 0 || !x.label));
                    if (standaloneInvalid.length) throw new Error(`Standalone non-native Buy Credits control lacks keyboard semantics: ${JSON.stringify(standaloneInvalid)}`);
                }

                if (width <= 430 && pageName === 'index.html') {
                    const footerLabel = await page.$eval('footer a[href="index.html"]', el => el.getAttribute('aria-label'));
                    if (footerLabel !== 'MyWingman home') {
                        throw new Error(`Footer brand link needs explicit accessible purpose; got ${footerLabel}`);
                    }

                    // Mobile navigation must be reversible and expose accurate expanded state.
                    await page.click('#mobile-menu-btn');
                    let menuState = await page.evaluate(() => ({
                        open: document.getElementById('mobileMenu').classList.contains('opacity-100'),
                        blocked: document.getElementById('mobileMenu').classList.contains('pointer-events-none'),
                        icon: document.getElementById('menu-icon').textContent.trim(),
                        expanded: document.getElementById('mobile-menu-btn').getAttribute('aria-expanded'),
                        label: document.getElementById('mobile-menu-btn').getAttribute('aria-label'),
                        bodyLocked: document.body.classList.contains('wingman-scroll-locked'),
                        htmlLocked: document.documentElement.classList.contains('wingman-scroll-locked')
                    }));
                    if (!menuState.open || menuState.blocked || menuState.icon !== 'close' || menuState.expanded !== 'true' || menuState.label !== 'Close navigation menu' || !menuState.bodyLocked || !menuState.htmlLocked) {
                        throw new Error(`Mobile menu did not enter a correct open state: ${JSON.stringify(menuState)}`);
                    }
                    await page.click('#mobile-menu-btn');
                    menuState = await page.evaluate(() => ({
                        hidden: document.getElementById('mobileMenu').classList.contains('opacity-0'),
                        blocked: document.getElementById('mobileMenu').classList.contains('pointer-events-none'),
                        icon: document.getElementById('menu-icon').textContent.trim(),
                        expanded: document.getElementById('mobile-menu-btn').getAttribute('aria-expanded'),
                        label: document.getElementById('mobile-menu-btn').getAttribute('aria-label'),
                        bodyLocked: document.body.classList.contains('wingman-scroll-locked'),
                        htmlLocked: document.documentElement.classList.contains('wingman-scroll-locked')
                    }));
                    if (!menuState.hidden || !menuState.blocked || menuState.icon !== 'menu' || menuState.expanded !== 'false' || menuState.label !== 'Open navigation menu' || menuState.bodyLocked || menuState.htmlLocked) {
                        throw new Error(`Mobile menu did not return to a correct closed state: ${JSON.stringify(menuState)}`);
                    }

                    await page.evaluate(() => window.openInterstitialModal());
                    await page.waitForTimeout(20);
                    const interstitialSemantics = await page.evaluate(() => {
                        const m = document.getElementById('interstitialModal');
                        return { role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), labelledby: m.getAttribute('aria-labelledby'), focused: m.contains(document.activeElement) };
                    });
                    if (interstitialSemantics.role !== 'dialog' || interstitialSemantics.modal !== 'true' || !interstitialSemantics.labelledby || !interstitialSemantics.focused) throw new Error(`Interstitial dialog semantics/focus invalid: ${JSON.stringify(interstitialSemantics)}`);
                    const interstitialClose = await page.$eval('#interstitialModal button[aria-label="Close age and consent dialog"]', el => {
                        const r = el.getBoundingClientRect();
                        return { width: r.width, height: r.height };
                    });
                    if (interstitialClose.width < 40 || interstitialClose.height < 40) {
                        throw new Error(`Interstitial close touch target too small: ${interstitialClose.width}x${interstitialClose.height}`);
                    }
                    await page.evaluate(() => window.closeInterstitialModal());

                    await page.evaluate(() => window.openAuthRequiredModal());
                    await page.waitForTimeout(20);
                    const authTargets = await page.evaluate(() => {
                        const modal = document.getElementById('authRequiredModal');
                        const close = document.querySelector('#authRequiredModal button[aria-label="Close sign-in dialog"]');
                        const eye = document.getElementById('togglePasswordBtn');
                        const cr = close.getBoundingClientRect();
                        const er = eye.getBoundingClientRect();
                        return {
                            modal: { role: modal.getAttribute('role'), ariaModal: modal.getAttribute('aria-modal'), labelledby: modal.getAttribute('aria-labelledby'), focused: modal.contains(document.activeElement) },
                            close: { width: cr.width, height: cr.height, label: close.getAttribute('aria-label') },
                            eye: { width: er.width, height: er.height, label: eye.getAttribute('aria-label'), tabIndex: eye.tabIndex }
                        };
                    });
                    if (authTargets.modal.role !== 'dialog' || authTargets.modal.ariaModal !== 'true' || !authTargets.modal.labelledby || !authTargets.modal.focused) {
                        throw new Error(`Auth dialog semantics/focus invalid: ${JSON.stringify(authTargets.modal)}`);
                    }
                    if (authTargets.close.width < 40 || authTargets.close.height < 40) {
                        throw new Error(`Auth close touch target too small: ${authTargets.close.width}x${authTargets.close.height}`);
                    }
                    if (authTargets.eye.width < 40 || authTargets.eye.height < 40) {
                        throw new Error(`Password visibility touch target too small: ${authTargets.eye.width}x${authTargets.eye.height}`);
                    }
                    if (authTargets.eye.label !== 'Show password' || authTargets.eye.tabIndex < 0) {
                        throw new Error(`Password visibility control accessibility invalid: ${JSON.stringify(authTargets.eye)}`);
                    }
                    await page.click('#togglePasswordBtn');
                    const hideLabel = await page.getAttribute('#togglePasswordBtn', 'aria-label');
                    if (hideLabel !== 'Hide password') throw new Error(`Password visibility label did not update: ${hideLabel}`);
                    await page.click('#togglePasswordBtn');
                    await page.evaluate(() => window.closeAuthRequiredModal());
                }

                if (pageErrors.length > 0) {
                    const firstErr = pageErrors[0];
                    throw new Error(`Page-level JavaScript exception in [${pageName}]: ${firstErr.message}`);
                }

                const metrics = await page.evaluate(() => {
                    const scrollWidth = document.documentElement.scrollWidth;
                    const innerWidth = window.innerWidth;
                    const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;
                    const overflowingElements = [];

                    document.querySelectorAll('*').forEach(el => {
                        const rect = el.getBoundingClientRect();
                        if (rect.right > innerWidth + 1 || el.scrollWidth > innerWidth + 1) {
                            overflowingElements.push({
                                tag: el.tagName,
                                id: el.id || null,
                                className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 100) : '',
                                width: rect.width,
                                right: rect.right,
                                scrollWidth: el.scrollWidth
                            });
                        }
                    });

                    return {
                        scrollWidth,
                        innerWidth,
                        bodyScrollWidth,
                        hasOverflow: scrollWidth > innerWidth || bodyScrollWidth > innerWidth,
                        overflowingElements: overflowingElements.slice(0, 5)
                    };
                });

                if (metrics.hasOverflow) {
                    console.error(`  ❌ [${pageName} @ ${width}px] OVERFLOW DETECTED: scrollWidth=${metrics.scrollWidth}px vs innerWidth=${metrics.innerWidth}px`);
                    console.error('  Overflown elements:', JSON.stringify(metrics.overflowingElements, null, 2));
                    throw new Error(`Horizontal overflow detected in ${pageName} at ${width}px (scrollWidth: ${metrics.scrollWidth}, innerWidth: ${metrics.innerWidth})`);
                } else {
                    passedChecks++;
                    console.log(`  ✔ ${width}px: scrollWidth (${metrics.scrollWidth}px) <= viewport (${metrics.innerWidth}px) [0 errors]`);
                }
            }
        }

        console.log('\n============================================================');
        console.log(`🎉 ALL HEADLESS BROWSER VIEWPORT CHECKS PASSED (${passedChecks}/${totalChecks})`);
        console.log('============================================================\n');

    } catch (err) {
        console.error('\n❌ Browser QA Failed:', err.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        server.close();
    }
}

runBrowserQA();
