'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MOBILE_VIEWPORTS = [[320, 568], [390, 844], [430, 932], [568, 320], [768, 1024]];
const APP_TOUCH_VIEWPORTS = MOBILE_VIEWPORTS.filter(viewport => viewport[0] < 768);
const MOBILE_ROUTES = ['/', '/app', '/app.html'];
const MIME_TYPES = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.woff2': 'font/woff2'
};

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
}

async function assertMobileTouchScroll(browser, port, viewport, route) {
    const context = await browser.newContext({
        viewport: { width: viewport[0], height: viewport[1] },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: viewport[0] > viewport[1] ? 2 : 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const client = await context.newCDPSession(page);
        const before = await page.evaluate(() => {
            document.scrollingElement.scrollTop = 0;
            const bodyStyle = getComputedStyle(document.body);
            const rootStyle = getComputedStyle(document.documentElement);
            return {
                scrollHeight: document.scrollingElement.scrollHeight,
                viewportHeight: window.innerHeight,
                scrollTop: document.scrollingElement.scrollTop,
                htmlOverflowY: rootStyle.overflowY,
                bodyOverflowX: bodyStyle.overflowX,
                bodyOverflowY: bodyStyle.overflowY,
                htmlTouchAction: rootStyle.touchAction,
                bodyTouchAction: bodyStyle.touchAction,
                maxTouchPoints: navigator.maxTouchPoints
            };
        });
        assert(before.scrollHeight > before.viewportHeight, `${route} has no vertical scroll range at ${viewport.join('x')}: ${JSON.stringify(before)}`);
        if (viewport[0] < 768) {
            assert.strictEqual(before.htmlOverflowY, 'auto', `HTML root must own vertical scrolling at ${viewport.join('x')}: ${JSON.stringify(before)}`);
            assert.strictEqual(before.bodyOverflowX, 'clip', `mobile body must clip horizontal overflow without becoming a scroller at ${viewport.join('x')}: ${JSON.stringify(before)}`);
            assert.strictEqual(before.bodyOverflowY, 'visible', `mobile body must leave vertical scrolling to the HTML root at ${viewport.join('x')}: ${JSON.stringify(before)}`);
            assert.strictEqual(before.htmlTouchAction, 'pan-y pinch-zoom', `HTML root touch action changed at ${viewport.join('x')}: ${JSON.stringify(before)}`);
            assert.strictEqual(before.bodyTouchAction, 'pan-y pinch-zoom', `body touch action changed at ${viewport.join('x')}: ${JSON.stringify(before)}`);
        }
        assert(before.maxTouchPoints > 0, `touch emulation was not active at ${viewport.join('x')}`);
        await swipeUp(page, client, viewport);
        const after = await page.evaluate(() => ({ scrollTop: document.scrollingElement.scrollTop, windowScrollY: window.scrollY }));
        assert(after.scrollTop > 0 && after.windowScrollY > 0, `vertical touch swipe did not move ${route} at ${viewport.join('x')}: ${JSON.stringify({ before, after })}`);
    } finally {
        await context.close();
    }
}

async function assertModalScrollLockOwnership(browser, port) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const client = await context.newCDPSession(page);
        const state = await page.evaluate(() => {
            if (typeof window.openPurchaseModal !== 'function' || typeof window.closePurchaseModal !== 'function') {
                throw new Error('purchase modal API is unavailable');
            }
            if (typeof window.openPasswordRecoveryModal !== 'function' || typeof window.closePasswordRecoveryModal !== 'function') {
                throw new Error('password recovery modal API is unavailable');
            }

            window.openPurchaseModal(10);
            window.openPasswordRecoveryModal();
            window.closePurchaseModal();
            window.closePasswordRecoveryModal();

            return {
                bodyInlineOverflow: document.body.style.overflow,
                htmlInlineOverflow: document.documentElement.style.overflow,
                htmlClass: document.documentElement.className,
                bodyClass: document.body.className,
                bodyComputedOverflowY: getComputedStyle(document.body).overflowY,
                htmlComputedOverflowY: getComputedStyle(document.documentElement).overflowY,
                recoveryVisible: !!document.getElementById('wingmanPasswordRecoveryOverlay'),
                purchaseVisible: document.getElementById('purchaseModal')?.classList.contains('hidden') === false,
                staleTouchBlockers: ['purchaseModal', 'wingmanPasswordRecoveryOverlay'].filter(id => {
                    const element = document.getElementById(id);
                    if (!element) return false;
                    const style = getComputedStyle(element);
                    return style.display !== 'none' && style.pointerEvents !== 'none';
                })
            };
        });

        assert.strictEqual(state.bodyInlineOverflow, '', `body scroll lock remained after overlapping modal close: ${JSON.stringify(state)}`);
        assert.strictEqual(state.htmlInlineOverflow, '', `html inline scroll lock remained after overlapping modal close: ${JSON.stringify(state)}`);
        assert(!state.htmlClass.includes('wingman-scroll-locked'), `html scroll-lock class remained after overlapping modal close: ${JSON.stringify(state)}`);
        assert(!state.bodyClass.includes('wingman-scroll-locked'), `body scroll-lock class remained after overlapping modal close: ${JSON.stringify(state)}`);
        assert.strictEqual(state.bodyComputedOverflowY, 'visible', `body vertical overflow was not restored: ${JSON.stringify(state)}`);
        assert.strictEqual(state.htmlComputedOverflowY, 'auto', `html vertical overflow was not restored: ${JSON.stringify(state)}`);
        assert.strictEqual(state.recoveryVisible, false, `password recovery overlay remained after close: ${JSON.stringify(state)}`);
        assert.strictEqual(state.purchaseVisible, false, `purchase modal remained after close: ${JSON.stringify(state)}`);
        assert.deepStrictEqual(state.staleTouchBlockers, [], `a hidden modal still intercepted touch input: ${JSON.stringify(state)}`);

        const pageshowState = await page.evaluate(() => {
            document.documentElement.classList.add('wingman-scroll-locked');
            document.body.classList.add('wingman-scroll-locked');
            window.dispatchEvent(new Event('pageshow'));
            return {
                htmlLocked: document.documentElement.classList.contains('wingman-scroll-locked'),
                bodyLocked: document.body.classList.contains('wingman-scroll-locked')
            };
        });
        assert.deepStrictEqual(pageshowState, { htmlLocked: false, bodyLocked: false }, `pageshow did not clear a stale zero-owner scroll lock: ${JSON.stringify(pageshowState)}`);

        await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
        await swipeUp(page, client, [390, 844]);
        const afterCloseScroll = await page.evaluate(() => ({
            scrollTop: document.scrollingElement.scrollTop,
            windowScrollY: window.scrollY
        }));
        assert(afterCloseScroll.scrollTop > 0 && afterCloseScroll.windowScrollY > 0, `touch scrolling did not resume after modal lock cleanup: ${JSON.stringify(afterCloseScroll)}`);
    } finally {
        await context.close();
    }
}

async function assertAppFeatureNavigation(browser, port) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const features = await page.evaluate(() => [
            ['Analyzer', 'analyzeSection'],
            ['Icebreaker', 'icebreakSection'],
            ['Bio Optimizer', 'optimizeSection'],
            ['Practice', 'chatboxSection']
        ].map(([name, id]) => {
            window.switchTab(id);
            const section = document.getElementById(id);
            return {
                name,
                exists: !!section,
                hidden: !section || section.classList.contains('hidden'),
                sectionScrollHeight: section ? section.scrollHeight : 0
            };
        }));
        assert.deepStrictEqual(features.map(feature => ({ ...feature, hidden: false })), features, `app feature navigation did not expose every feature: ${JSON.stringify(features)}`);
        assert(features.every(feature => feature.exists), `app feature navigation found a missing section: ${JSON.stringify(features)}`);
    } finally {
        await context.close();
    }
}

async function assertMobilePlexusCanvas(browser, port) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        const firstFrame = await page.evaluate(() => {
            const canvas = document.getElementById('ambient-plexus-canvas');
            const toggle = document.getElementById('settingPlexusToggle');
            const pixels = canvas && canvas.width && canvas.height ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data : [];
            let paintedPixels = 0;
            for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) paintedPixels += 1;
            return {
                display: canvas ? getComputedStyle(canvas).display : 'missing',
                width: canvas ? canvas.getBoundingClientRect().width : 0,
                height: canvas ? canvas.getBoundingClientRect().height : 0,
                backingWidth: canvas ? canvas.width : 0,
                backingHeight: canvas ? canvas.height : 0,
                paintedPixels,
                toggleDisabled: toggle ? toggle.disabled : true,
                toggleChecked: toggle ? toggle.checked : false,
                stateEnabled: window.state ? window.state.showPlexus !== false : false
            };
        });
        assert.notStrictEqual(firstFrame.display, 'none', `mobile plexus canvas was hidden: ${JSON.stringify(firstFrame)}`);
        assert(firstFrame.width > 0 && firstFrame.height > 0, `mobile plexus canvas has no rendered viewport: ${JSON.stringify(firstFrame)}`);
        assert(firstFrame.paintedPixels > 0, `mobile plexus canvas is not painting: ${JSON.stringify(firstFrame)}`);
        assert(firstFrame.backingWidth <= firstFrame.width * 2, `mobile plexus backing width is too large for a phone: ${JSON.stringify(firstFrame)}`);
        assert(firstFrame.backingHeight <= firstFrame.height * 2, `mobile plexus backing height is too large for a phone: ${JSON.stringify(firstFrame)}`);
        assert.strictEqual(firstFrame.toggleDisabled, false, `mobile plexus setting is hard-disabled: ${JSON.stringify(firstFrame)}`);
        assert.strictEqual(firstFrame.toggleChecked, true, `mobile plexus setting is not enabled by default: ${JSON.stringify(firstFrame)}`);
        assert.strictEqual(firstFrame.stateEnabled, true, `mobile plexus state is disabled at startup: ${JSON.stringify(firstFrame)}`);

        await page.evaluate(() => window.openSettingsModal());
        await page.waitForTimeout(50);
        await page.locator('label:has(#settingPlexusToggle)').click();
        await page.waitForTimeout(50);
        const disabledFrame = await page.evaluate(() => ({
            display: getComputedStyle(document.getElementById('ambient-plexus-canvas')).display,
            checked: document.getElementById('settingPlexusToggle').checked,
            stateEnabled: window.state.showPlexus
        }));
        assert.strictEqual(disabledFrame.display, 'none', `mobile plexus did not hide when toggled off: ${JSON.stringify(disabledFrame)}`);
        assert.strictEqual(disabledFrame.checked, false, `mobile plexus toggle did not switch off: ${JSON.stringify(disabledFrame)}`);
        assert.strictEqual(disabledFrame.stateEnabled, false, `mobile plexus state did not persist off: ${JSON.stringify(disabledFrame)}`);

        await page.locator('label:has(#settingPlexusToggle)').click();
        await page.waitForTimeout(100);
        const reenabledFrame = await page.evaluate(() => ({
            display: getComputedStyle(document.getElementById('ambient-plexus-canvas')).display,
            checked: document.getElementById('settingPlexusToggle').checked,
            stateEnabled: window.state.showPlexus
        }));
        assert.notStrictEqual(reenabledFrame.display, 'none', `mobile plexus did not restart when toggled on: ${JSON.stringify(reenabledFrame)}`);
        assert.strictEqual(reenabledFrame.checked, true, `mobile plexus toggle did not switch on: ${JSON.stringify(reenabledFrame)}`);
        assert.strictEqual(reenabledFrame.stateEnabled, true, `mobile plexus state did not persist on: ${JSON.stringify(reenabledFrame)}`);

        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(50);
        assert.strictEqual(await page.locator('#ambient-plexus-canvas').evaluate(canvas => getComputedStyle(canvas).display), 'none', 'mobile plexus must pause while the document is hidden');

        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(100);
        assert.notStrictEqual(await page.locator('#ambient-plexus-canvas').evaluate(canvas => getComputedStyle(canvas).display), 'none', 'mobile plexus must resume when the document is visible');
    } finally {
        await context.close();
    }
}

async function assertMobilePlexusPreferenceOff(browser, port) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${port}`, localStorage: [{ name: 'wingman_setting_plexus', value: 'false' }] }] } });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        const frame = await page.evaluate(() => ({
            display: getComputedStyle(document.getElementById('ambient-plexus-canvas')).display,
            checked: document.getElementById('settingPlexusToggle').checked,
            stateEnabled: window.state.showPlexus
        }));
        assert.strictEqual(frame.display, 'none', `mobile plexus ignored persisted off preference: ${JSON.stringify(frame)}`);
        assert.strictEqual(frame.checked, false, `mobile plexus toggle ignored persisted off preference: ${JSON.stringify(frame)}`);
        assert.strictEqual(frame.stateEnabled, false, `mobile plexus state ignored persisted off preference: ${JSON.stringify(frame)}`);
    } finally {
        await context.close();
    }
}

async function assertDesktopWheelScroll(browser, port) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const before = await page.evaluate(() => {
            window.scrollTo(0, 0);
            return {
                scrollHeight: document.scrollingElement.scrollHeight,
                viewportHeight: window.innerHeight,
                scrollTop: document.scrollingElement.scrollTop
            };
        });
        assert(before.scrollHeight > before.viewportHeight, `desktop page has no vertical scroll range: ${JSON.stringify(before)}`);
        assert.strictEqual(before.scrollTop, 0, `desktop page did not start at the top: ${JSON.stringify(before)}`);
        await page.mouse.move(683, 384);
        await page.mouse.wheel(0, 520);
        await page.waitForTimeout(100);
        const scrollTop = await page.evaluate(() => document.scrollingElement.scrollTop);
        assert(scrollTop > 0, `desktop wheel scrolling changed at 1366x768: ${scrollTop}`);
    } finally {
        await context.close();
    }
}

async function run() {
    const server = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
        const port = server.address().port;
        for (const route of MOBILE_ROUTES) {
            const viewports = route === '/' ? MOBILE_VIEWPORTS : APP_TOUCH_VIEWPORTS;
            for (const viewport of viewports) await assertMobileTouchScroll(browser, port, viewport, route);
        }
        await assertAppFeatureNavigation(browser, port);
        await assertMobilePlexusCanvas(browser, port);
        await assertMobilePlexusPreferenceOff(browser, port);
        await assertModalScrollLockOwnership(browser, port);
        await assertDesktopWheelScroll(browser, port);
        console.log(`Mobile touch scroll regression passed across ${MOBILE_ROUTES.join(', ')} at ${MOBILE_VIEWPORTS.map(viewport => viewport.join('x')).join(', ')}; modal lock ownership and desktop wheel scroll remained functional.`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
