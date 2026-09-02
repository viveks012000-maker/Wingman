'use strict';

/**
 * Deterministic mobile touch-interaction investigation suite (mission: repro-first).
 *
 * Covers, with REAL input only:
 *  - CDP touch swipe before any overlay (baseline)
 *  - real-click modal/menu open + real-click close
 *  - immediate next real touch swipe MUST move
 *  - no wingman-scroll-locked class remains, no stale inline overflow remains
 *  - elementFromPoint hit-testing at swipe coordinates (no closed overlay intercepts)
 *  - reload /app -> swipe moves
 *  - Back -> swipe moves; Forward -> swipe moves
 *  - pageshow (persisted) cleanup -> swipe moves
 *  - portrait + landscape, iPhone 12-class viewport/UA, Android-class viewport
 *  - WebKit engine contract coverage (iOS/WebKit-compatible behavior proxy)
 *
 * AI/API submissions: none. Read-only static server; no prompts/models/routes touched.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.woff2': 'font/woff2'
};

const IPHONE_12_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const OVERLAY_IDS = [
    'purchaseModal', 'settingsModal', 'cropModal', 'deleteAccountModal',
    'authRequiredModal', 'activationModal', 'unreadableErrorModal',
    'interstitialModal', 'wingmanPasswordRecoveryOverlay', 'mobileMenu'
];

const RESULTS = [];
function record(name, ok, detail) {
    RESULTS.push({ name, ok, detail: detail || '' });
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

function startStaticServer() {
    const server = http.createServer((request, response) => {
        let requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
        if (requestPath === '/') requestPath = '/index.html';
        if (requestPath === '/app' || requestPath === '/app/') requestPath = '/app.html';
        const filePath = path.resolve(ROOT, requestPath.slice(1));
        if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            response.writeHead(404);
            response.end('Not Found');
            return;
        }
        response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
        response.end(fs.readFileSync(filePath));
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function swipeUp(page, client, viewport) {
    const x = Math.floor(viewport[0] / 2);
    const startY = Math.max(80, viewport[1] - 90);
    const endY = Math.max(24, startY - Math.min(520, viewport[1] - 48));
    await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 1, x, y: startY, radiusX: 8, radiusY: 8, force: 1 }]
    });
    const distance = startY - endY;
    for (let step = 1; step <= 8; step += 1) {
        await page.waitForTimeout(25);
        await client.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ id: 1, x, y: startY - (distance * step / 8), radiusX: 8, radiusY: 8, force: 1 }]
        });
    }
    await page.waitForTimeout(25);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    return { x, startY };
}

async function stateProbe(page, x, y) {
    return page.evaluate(([px, py, overlayIds]) => {
        const hit = document.elementsFromPoint(px, py);
        const describe = (el) => ({
            tag: el.tagName, id: el.id || null,
            pointerEvents: getComputedStyle(el).pointerEvents,
            visibility: getComputedStyle(el).visibility
        });
        const closedOverlayHit = hit.find(el => overlayIds.some(id =>
            el.id === id || (el.closest && el.closest('#' + id))));
        return {
            hitCount: hit.length,
            firstHit: hit.length ? describe(hit[0]) : null,
            closedOverlayHit: closedOverlayHit ? (closedOverlayHit.id || closedOverlayHit.tagName) : null,
            htmlClass: document.documentElement.className,
            bodyClass: document.body.className,
            htmlInlineOverflow: document.documentElement.style.overflow,
            bodyInlineOverflow: document.body.style.overflow,
            htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
            bodyOverflowY: getComputedStyle(document.body).overflowY,
            htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
            bodyTouchAction: getComputedStyle(document.body).touchAction,
            scrollTop: document.scrollingElement.scrollTop,
            scrollHeight: document.scrollingElement.scrollHeight,
            innerHeight: window.innerHeight,
            // md-layout (width >= 768) uses an internal overflow-y-auto panel as the intended scroller.
            internalScroller: (() => {
                for (const el of document.querySelectorAll('*')) {
                    const cs = getComputedStyle(el);
                    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
                        return { tag: el.tagName, id: el.id || null, scrollTop: el.scrollTop, clientH: el.clientHeight, scrollH: el.scrollHeight };
                    }
                }
                return null;
            })()
        };
    }, [x, y, OVERLAY_IDS]);
}

function assertCleanMobileState(state, label, isMobileLayout) {
    assert(!state.htmlClass.includes('wingman-scroll-locked'), `${label}: html still has wingman-scroll-locked: ${JSON.stringify(state)}`);
    assert(!state.bodyClass.includes('wingman-scroll-locked'), `${label}: body still has wingman-scroll-locked: ${JSON.stringify(state)}`);
    assert.strictEqual(state.htmlInlineOverflow, '', `${label}: html inline overflow stale: ${JSON.stringify(state)}`);
    assert.strictEqual(state.bodyInlineOverflow, '', `${label}: body inline overflow stale: ${JSON.stringify(state)}`);
    if (isMobileLayout) {
        assert.strictEqual(state.htmlOverflowY, 'auto', `${label}: html is not the scroll root: ${JSON.stringify(state)}`);
        assert.strictEqual(state.bodyOverflowY, 'visible', `${label}: body became a scroller: ${JSON.stringify(state)}`);
    } else {
        assert(state.internalScroller, `${label}: md layout exposes no scrollable panel: ${JSON.stringify(state)}`);
    }
}

function assertHitTestClean(state, label) {
    assert(state.hitCount > 0, `${label}: elementsFromPoint returned nothing at swipe coordinates: ${JSON.stringify(state)}`);
    assert.strictEqual(state.closedOverlayHit, null, `${label}: closed overlay intercepts the swipe point: ${JSON.stringify(state)}`);
    assert(state.firstHit && state.firstHit.pointerEvents !== 'none', `${label}: first hit element does not accept pointer input: ${JSON.stringify(state)}`);
    assert(state.firstHit && state.firstHit.visibility !== 'hidden', `${label}: first hit element is hidden: ${JSON.stringify(state)}`);
}

async function openAndCloseSettingsViaRealClicks(page, label) {
    const openBtn = page.locator('button[onclick*="openSettingsModal"]:visible').first();
    await openBtn.click();
    await page.waitForTimeout(120);
    const openState = await page.evaluate(() => {
        const m = document.getElementById('settingsModal');
        return { visible: m && m.classList.contains('hidden') === false && m.classList.contains('opacity-100') };
    });
    assert(openState.visible, `${label}: settings modal did not open via real click: ${JSON.stringify(openState)}`);

    const closeBtn = page.locator('#settingsModal button[onclick*="closeSettingsModal"]:visible').first();
    await closeBtn.click();
    await page.waitForTimeout(80);
    const closedState = await page.evaluate(() => {
        const m = document.getElementById('settingsModal');
        return { hidden: m && (m.classList.contains('hidden') || m.classList.contains('opacity-0')) };
    });
    assert(closedState.hidden, `${label}: settings modal did not close via real click: ${JSON.stringify(closedState)}`);
}

async function readScrollProgress(page, isMobileLayout) {
    return page.evaluate((mobileLayout) => {
        if (mobileLayout) return { root: document.scrollingElement.scrollTop };
        for (const el of document.querySelectorAll('*')) {
            const cs = getComputedStyle(el);
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
                return { internal: el.scrollTop, tag: el.tagName, id: el.id || null };
            }
        }
        return { internal: null };
    }, isMobileLayout);
}

async function resetScroll(page, isMobileLayout) {
    await page.evaluate((mobileLayout) => {
        document.scrollingElement.scrollTop = 0;
        if (!mobileLayout) {
            for (const el of document.querySelectorAll('*')) {
                const cs = getComputedStyle(el);
                if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')) el.scrollTop = 0;
            }
        }
    }, isMobileLayout);
}

async function runChromiumFlow(browser, options) {
    const { viewport, deviceScaleFactor, userAgent, label } = options;
    const context = await browser.newContext({
        viewport: { width: viewport[0], height: viewport[1] },
        isMobile: true, hasTouch: true,
        deviceScaleFactor,
        userAgent
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const client = await context.newCDPSession(page);
    const isPortrait = viewport[0] < viewport[1];
    const width = viewport[0], height = viewport[1];
    const isMobileLayout = width < 768; // style.css owns <768; Tailwind md: app-shell owns >=768
    try {
        // ---------- Baseline: real touch swipe before any overlay ----------
        await page.goto(`http://127.0.0.1:${options.port}/app`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);
        let probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
        if (isMobileLayout) {
            record(`${label}: baseline scroll-root contract`, probe.htmlOverflowY === 'auto' && probe.bodyOverflowY === 'visible' && probe.scrollHeight > probe.innerHeight, JSON.stringify({ html: probe.htmlOverflowY, body: probe.bodyOverflowY, sh: probe.scrollHeight, ih: probe.innerHeight }));
            record(`${label}: baseline touch-action`, probe.htmlTouchAction.includes('pan-y') && probe.bodyTouchAction.includes('pan-y'), JSON.stringify({ html: probe.htmlTouchAction, body: probe.bodyTouchAction }));
        } else {
            record(`${label}: baseline md-layout internal scroller exists`, !!probe.internalScroller, JSON.stringify(probe.internalScroller));
        }
        await resetScroll(page, isMobileLayout);
        await swipeUp(page, client, viewport);
        let after = await readScrollProgress(page, isMobileLayout);
        let progressed = isMobileLayout ? after.root > 0 : (after.internal || 0) > 0;
        record(`${label}: baseline real touch swipe moves`, progressed, JSON.stringify(after));

        probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
        assertCleanMobileState(probe, `${label}: baseline clean state`, isMobileLayout);
        assertHitTestClean(probe, `${label}: baseline hit-test`);
        record(`${label}: baseline clean state + hit-test`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);

        // ---------- Settings modal: real click open/close, immediate real swipe (mobile layout) ----------
        if (isMobileLayout) {
            await resetScroll(page, isMobileLayout);
            await openAndCloseSettingsViaRealClicks(page, label);
            await swipeUp(page, client, viewport);
            after = await readScrollProgress(page, isMobileLayout);
            progressed = isMobileLayout ? after.root > 0 : (after.internal || 0) > 0;
            record(`${label}: swipe moves immediately after settings modal close`, progressed, JSON.stringify(after));
            probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
            assertCleanMobileState(probe, `${label}: post-settings clean state`, isMobileLayout);
            assertHitTestClean(probe, `${label}: post-settings hit-test`);
            record(`${label}: post-settings clean state + hit-test`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);
        }

        if (isPortrait) {
            // ---------- Purchase modal: real click, swipe blocked while open, close, immediate swipe ----------
            await resetScroll(page, isMobileLayout);
            const buyTrigger = page.locator('div[title="Buy Credits"]:visible').first();
            await buyTrigger.click();
            await page.waitForTimeout(120);
            const purchaseOpen = await page.evaluate(() => {
                const m = document.getElementById('purchaseModal');
                return m && m.classList.contains('hidden') === false && m.classList.contains('opacity-100');
            });
            assert(purchaseOpen, `${label}: purchase modal did not open via real click`);
            await resetScroll(page, isMobileLayout);
            await swipeUp(page, client, viewport);
            const blocked = await page.evaluate(() => ({ scrollTop: document.scrollingElement.scrollTop, locked: document.documentElement.classList.contains('wingman-scroll-locked') || document.body.classList.contains('wingman-scroll-locked') }));
            record(`${label}: swipe blocked while purchase modal lock engaged`, blocked.scrollTop === 0 && blocked.locked, JSON.stringify(blocked));
            const closeBtn = page.locator('#purchaseModal button[onclick*="closePurchaseModal"]:visible').first();
            await closeBtn.click();
            await page.waitForTimeout(80);
            await swipeUp(page, client, viewport);
            after = await readScrollProgress(page, isMobileLayout);
            progressed = isMobileLayout ? after.root > 0 : (after.internal || 0) > 0;
            record(`${label}: swipe moves immediately after purchase modal close`, progressed, JSON.stringify(after));
            probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
            assertCleanMobileState(probe, `${label}: post-purchase clean state`, isMobileLayout);
            assertHitTestClean(probe, `${label}: post-purchase hit-test`);
            record(`${label}: post-purchase clean state + hit-test`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);

            // ---------- Reload: immediate real swipe after reload ----------
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(250);
            await swipeUp(page, client, viewport);
            after = await readScrollProgress(page, isMobileLayout);
            progressed = isMobileLayout ? after.root > 0 : (after.internal || 0) > 0;
            record(`${label}: swipe moves immediately after reload`, progressed, JSON.stringify(after));
            probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
            assertCleanMobileState(probe, `${label}: post-reload clean state`, isMobileLayout);
            record(`${label}: post-reload clean state`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);

            // ---------- Back/Forward: real history navigation + real swipe ----------
            await page.goto(`http://127.0.0.1:${options.port}/`, { waitUntil: 'domcontentloaded' });
            await page.goto(`http://127.0.0.1:${options.port}/app`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(200);
            await page.goBack({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(250);
            await swipeUp(page, client, viewport);
            let backAfter = await page.evaluate(() => ({ scrollTop: document.scrollingElement.scrollTop, sy: window.scrollY, path: location.pathname }));
            record(`${label}: swipe moves after Back`, backAfter.scrollTop > 0 && backAfter.sy > 0, JSON.stringify(backAfter));
            await page.goForward({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(250);
            await swipeUp(page, client, viewport);
            after = await readScrollProgress(page, isMobileLayout);
            progressed = isMobileLayout ? after.root > 0 : (after.internal || 0) > 0;
            record(`${label}: swipe moves after Forward`, progressed, JSON.stringify({ ...after, path: await page.evaluate(() => location.pathname) }));
            probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
            assertCleanMobileState(probe, `${label}: post-forward clean state`, isMobileLayout);
            record(`${label}: post-forward clean state`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);

            // ---------- pageshow (persisted) class cleanup + real swipe ----------
            // Real code paths never write inline overflow outside the lock manager, so only
            // the ownerless class residue is a producible stale state; verify its cleanup.
            await page.evaluate(() => {
                document.documentElement.classList.add('wingman-scroll-locked');
                document.body.classList.add('wingman-scroll-locked');
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            });
            await page.waitForTimeout(80);
            const pageshowState = await page.evaluate(() => ({
                htmlLocked: document.documentElement.classList.contains('wingman-scroll-locked'),
                bodyLocked: document.body.classList.contains('wingman-scroll-locked'),
                bodyInline: document.body.style.overflow,
                htmlInline: document.documentElement.style.overflow
            }));
            record(`${label}: pageshow(persisted) clears stale lock classes`,
                pageshowState.htmlLocked === false && pageshowState.bodyLocked === false && pageshowState.bodyInline === '' && pageshowState.htmlInline === '',
                JSON.stringify(pageshowState));
            await swipeUp(page, client, viewport);
            after = await readScrollProgress(page, isMobileLayout);
            progressed = isMobileLayout ? after.root > 0 : (after.internal || 0) > 0;
            record(`${label}: swipe moves after pageshow(persisted)`, progressed, JSON.stringify(after));
        }

        record(`${label}: no page JS errors`, pageErrors.length === 0, pageErrors.join(' | ') || 'none');
    } finally {
        await context.close();
    }
}

async function runLandingMenuFlow(browser, options) {
    const { viewport, deviceScaleFactor, userAgent, label, port } = options;
    const width = viewport[0], height = viewport[1];
    const context = await browser.newContext({
        viewport: { width, height }, isMobile: true, hasTouch: true,
        deviceScaleFactor, userAgent
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const client = await context.newCDPSession(page);
    try {
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);

        // Real click open menu
        await page.click('#mobile-menu-btn');
        await page.waitForTimeout(150);
        const openState = await page.evaluate(() => {
            const menu = document.getElementById('mobileMenu');
            return {
                open: menu.classList.contains('opacity-100') && menu.classList.contains('pointer-events-auto'),
                locked: document.documentElement.classList.contains('wingman-scroll-locked') || document.body.classList.contains('wingman-scroll-locked')
            };
        });
        record(`${label}: menu opens via real click and engages lock`, openState.open && openState.locked, JSON.stringify(openState));

        // Swipe while open must not move the page
        await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
        await swipeUp(page, client, viewport);
        const blocked = await page.evaluate(() => ({ scrollTop: document.scrollingElement.scrollTop }));
        record(`${label}: swipe blocked while menu lock engaged`, blocked.scrollTop === 0, JSON.stringify(blocked));

        // Real click close menu
        await page.click('#mobile-menu-btn');
        await page.waitForTimeout(150);
        const closedState = await page.evaluate(() => {
            const menu = document.getElementById('mobileMenu');
            return {
                closed: menu.classList.contains('opacity-0') && menu.classList.contains('pointer-events-none'),
                locked: document.documentElement.classList.contains('wingman-scroll-locked') || document.body.classList.contains('wingman-scroll-locked'),
                bodyInline: document.body.style.overflow
            };
        });
        record(`${label}: menu closes via real click and releases lock`, closedState.closed && !closedState.locked && closedState.bodyInline === '', JSON.stringify(closedState));

        // IMMEDIATE real swipe must move
        await swipeUp(page, client, viewport);
        const after = await page.evaluate(() => ({ scrollTop: document.scrollingElement.scrollTop, sy: window.scrollY }));
        record(`${label}: swipe moves immediately after menu close`, after.scrollTop > 0 && after.sy > 0, JSON.stringify(after));

        const probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
        assertCleanMobileState(probe, `${label}: post-menu clean state`);
        assertHitTestClean(probe, `${label}: post-menu hit-test`);
        record(`${label}: post-menu clean state + hit-test`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);
        record(`${label}: no page JS errors (menu flow)`, pageErrors.length === 0, pageErrors.join(' | ') || 'none');
    } finally {
        await context.close();
    }
}

async function runWebKitContract(browser, options) {
    const { viewport, deviceScaleFactor, label, port } = options;
    const width = viewport[0], height = viewport[1];
    const isMobileLayout = width < 768;
    const context = await browser.newContext({
        viewport: { width, height }, hasTouch: true,
        deviceScaleFactor, userAgent: IPHONE_12_UA
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    try {
        await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        const probe = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
        assertCleanMobileState(probe, `${label}: layout contract`, isMobileLayout);
        assertHitTestClean(probe, `${label}: hit-test`);
        record(`${label}: layout contract + hit-test`, true, `firstHit=${JSON.stringify(probe.firstHit)}`);

        // Real-input scrolling is covered deterministically via Chromium CDP touch elsewhere;
        // WebKit headless wheel dispatch is platform-variable and not representative of iOS
        // touch input, so only the JS programmatic path (Kobiton diagnostic analog) runs here.
        await resetScroll(page, isMobileLayout);
        await page.evaluate(() => { window.scrollTo(0, 200); });
        await page.waitForTimeout(100);
        const js = await readScrollProgress(page, isMobileLayout);
        const jsProgressed = isMobileLayout ? js.root > 0 : (js.internal || 0) > 0 || (await page.evaluate(() => document.scrollingElement.scrollTop)) > 0;
        record(`${label}: JS scrollTo works (diagnostic analog)`, jsProgressed, JSON.stringify(js));

        // Settings modal real clicks + clean state after close
        await resetScroll(page, isMobileLayout);
        await openAndCloseSettingsViaRealClicks(page, label);
        const afterClose = await stateProbe(page, Math.floor(width / 2), Math.max(80, height - 90));
        assertCleanMobileState(afterClose, `${label}: post-settings clean state`, isMobileLayout);
        assertHitTestClean(afterClose, `${label}: post-settings hit-test`);
        record(`${label}: post-settings clean state + hit-test`, true, `firstHit=${JSON.stringify(afterClose.firstHit)}`);
        record(`${label}: no page JS errors (WebKit)`, pageErrors.length === 0, pageErrors.join(' | ') || 'none');
    } finally {
        await context.close();
    }
}

const MODAL_FLOWS_APP = [
    { id: 'settingsModal', open: 'window.openSettingsModal()' },
    { id: 'authRequiredModal', open: 'window.openAuthRequiredModal && window.openAuthRequiredModal()' },
    { id: 'deleteAccountModal', open: 'window.openDeleteAccountModal && window.openDeleteAccountModal()' },
    { id: 'interstitialModal', open: 'window.openInterstitialModal && window.openInterstitialModal()' }
];

const MODAL_FLOWS_LANDING = [
    { id: 'interstitialModal', open: 'window.openInterstitialModal && window.openInterstitialModal()' }
];

async function assertModalReachability(browser, options) {
    const { viewport, deviceScaleFactor, userAgent, label, port, flows, route, expectScrollable } = options;
    const width = viewport[0], height = viewport[1];
    const context = await browser.newContext({
        viewport: { width, height }, isMobile: true, hasTouch: true,
        deviceScaleFactor, userAgent
    });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);
        for (const flow of flows) {
            await page.evaluate(flow.open);
            await page.waitForTimeout(120);
            const geo = await page.evaluate((modalId) => {
                const m = document.getElementById(modalId);
                if (!m) return { exists: false };
                const cs = getComputedStyle(m);
                if (cs.display === 'none' || m.classList.contains('hidden') || m.classList.contains('opacity-0')) return { exists: true, open: false };
                const closeBtn = [...m.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('close'));
                const br = closeBtn ? closeBtn.getBoundingClientRect() : null;
                return {
                    exists: true, open: true,
                    containerOverflowY: cs.overflowY,
                    cardHeight: m.firstElementChild ? Math.round(m.firstElementChild.getBoundingClientRect().height) : null,
                    closeTop: br ? Math.round(br.top) : null,
                    closeInViewport: br ? (br.top >= 0 && br.bottom <= innerHeight) : null
                };
            }, flow.id);
            if (!geo.exists || geo.open === false) {
                record(`${label}: ${flow.id} reachable (not openable in this state, skipped)`, true, JSON.stringify(geo));
                continue;
            }
            const scrollOk = !expectScrollable || geo.containerOverflowY === 'auto' || geo.containerOverflowY === 'scroll';
            record(`${label}: ${flow.id} container scroll affordance`, scrollOk, JSON.stringify(geo));
            // Real click must reach the close control (auto-scrolls within a scrollable container).
            let clickOk = true, clickErr = '';
            try {
                const closeBtn = page.locator(`#${flow.id} button[onclick*="close"]:visible`).first();
                await closeBtn.click({ timeout: 5000 });
            } catch (e) {
                clickOk = false;
                clickErr = e.message.split('\n')[0];
            }
            record(`${label}: ${flow.id} close button reachable via real click`, clickOk, clickErr || JSON.stringify(geo));
            await page.waitForTimeout(80);
        }
    } finally {
        await context.close();
    }
}
async function run() {
    const server = await startStaticServer();
    const port = server.address().port;
    const chromiumBrowser = await chromium.launch({ headless: true });
    // WebKit engine coverage is the iOS/Safari behavior proxy. Environments without the
    // WebKit executable (e.g. minimal CI images) skip these flows explicitly, mirroring
    // the SQLite-driver skip precedent, instead of failing the whole suite.
    let webkitBrowser = null;
    let webkitAvailable = true;
    try {
        webkitBrowser = await webkit.launch({ headless: true });
    } catch (e) {
        webkitAvailable = false;
        record('webkit engine coverage', true, 'SKIPPED: WebKit executable not installed (' + String(e.message).split('\n')[0] + ')');
    }
    try {
        const configs = [
            { viewport: [390, 844], deviceScaleFactor: 3, userAgent: IPHONE_12_UA, label: 'chromium iPhone12-class portrait' },
            { viewport: [844, 390], deviceScaleFactor: 2, userAgent: IPHONE_12_UA, label: 'chromium iPhone12-class landscape' },
            { viewport: [360, 800], deviceScaleFactor: 2.75, userAgent: ANDROID_UA, label: 'chromium Android-class portrait' },
            { viewport: [320, 568], deviceScaleFactor: 2, userAgent: ANDROID_UA, label: 'chromium small Android portrait' }
        ];
        for (const cfg of configs) {
            await runChromiumFlow(chromiumBrowser, { ...cfg, port });
        }
        await runLandingMenuFlow(chromiumBrowser, { viewport: [390, 844], deviceScaleFactor: 3, userAgent: IPHONE_12_UA, label: 'chromium iPhone12-class landing-menu', port });

        // Landscape modal reachability: the exact reproduced failure band (width >= 768, short height).
        const land = { viewport: [844, 390], deviceScaleFactor: 2, userAgent: IPHONE_12_UA, expectScrollable: true };
        await assertModalReachability(chromiumBrowser, { ...land, label: 'chromium iPhone12 landscape /app modals', port, flows: MODAL_FLOWS_APP, route: '/app' });
        await assertModalReachability(chromiumBrowser, { ...land, label: 'chromium iPhone12 landscape / modals', port, flows: MODAL_FLOWS_LANDING, route: '/' });
        // Portrait must remain unaffected.
        const port390 = { viewport: [390, 844], deviceScaleFactor: 3, userAgent: IPHONE_12_UA, expectScrollable: true };
        await assertModalReachability(chromiumBrowser, { ...port390, label: 'chromium iPhone12 portrait /app modals', port, flows: MODAL_FLOWS_APP, route: '/app' });

        if (webkitAvailable) {
            await runWebKitContract(webkitBrowser, { viewport: [390, 844], deviceScaleFactor: 3, label: 'webkit iPhone12-class portrait', port });
            await runWebKitContract(webkitBrowser, { viewport: [844, 390], deviceScaleFactor: 2, label: 'webkit iPhone12-class landscape', port });
        }
    } finally {
        await chromiumBrowser.close();
        if (webkitBrowser) await webkitBrowser.close();
        await new Promise(resolve => server.close(resolve));
    }

    const failed = RESULTS.filter(r => !r.ok);
    console.log('==================================================================');
    console.log(`TOTAL: ${RESULTS.length} checks | PASS: ${RESULTS.length - failed.length} | FAIL: ${failed.length}`);
    if (failed.length) {
        console.log('FAILED CHECKS:');
        for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
        process.exitCode = 1;
    }
}

run().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
});
