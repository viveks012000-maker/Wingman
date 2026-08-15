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
