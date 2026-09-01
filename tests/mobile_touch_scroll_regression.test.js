'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MOBILE_VIEWPORTS = [[320, 568], [390, 844], [430, 932], [568, 320], [768, 1024]];
const MIME_TYPES = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.woff2': 'font/woff2'
};

function startStaticServer() {
    const server = http.createServer((request, response) => {
        let requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
        if (requestPath === '/') requestPath = '/index.html';
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

async function assertMobileTouchScroll(browser, port, viewport) {
    const context = await browser.newContext({
        viewport: { width: viewport[0], height: viewport[1] },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: viewport[0] > viewport[1] ? 2 : 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    });
    const page = await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
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
        assert(before.scrollHeight > before.viewportHeight, `landing page has no vertical scroll range at ${viewport.join('x')}: ${JSON.stringify(before)}`);
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
        assert(after.scrollTop > 0 && after.windowScrollY > 0, `vertical touch swipe did not move the landing document at ${viewport.join('x')}: ${JSON.stringify({ before, after })}`);
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
        for (const viewport of MOBILE_VIEWPORTS) await assertMobileTouchScroll(browser, port, viewport);
        await assertDesktopWheelScroll(browser, port);
        console.log(`Mobile touch scroll regression passed across ${MOBILE_VIEWPORTS.map(viewport => viewport.join('x')).join(', ')}; desktop wheel scroll remained functional.`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
