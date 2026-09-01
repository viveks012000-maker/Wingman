'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let staticServerPort = null;
const MOBILE_VIEWPORTS = [
    [320, 568], [360, 800], [375, 667], [390, 700], [390, 844],
    [393, 852], [412, 915], [430, 932], [568, 320], [568, 500], [568, 501]
];
const DESKTOP_VIEWPORTS = [[768, 1024], [1366, 768], [1920, 1080]];
const BREAKPOINT_VIEWPORTS = [[639, 800], [640, 800], [767, 800], [768, 800], [769, 800], [1023, 800], [1024, 800]];
const PRACTICE_HEIGHT_BOUNDARIES = [[568, 520], [568, 521]];
const MIME_TYPES = {
    '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
    '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'
};

function startStaticServer() {
    const server = http.createServer((req, res) => {
        let requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (requestPath === '/') requestPath = '/index.html';
        const filePath = path.resolve(ROOT, requestPath.slice(1));
        if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
        res.end(fs.readFileSync(filePath));
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
        staticServerPort = server.address().port;
        resolve(server);
    }));
}

async function openPage(browser, pageName, viewport) {
    const isMobileViewport = viewport[0] < 768;
    const context = await browser.newContext({
        viewport: { width: viewport[0], height: viewport[1] },
        isMobile: true,
        hasTouch: true,
        ...(isMobileViewport ? {
            deviceScaleFactor: viewport[0] > viewport[1] ? 2 : 3,
            userAgent: viewport[0] > viewport[1]
                ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240505.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
                : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        } : {})
    });
    const page = await context.newPage();
    const pageErrors = [];
    const failedRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure() && request.failure().errorText }));
    await page.goto(`http://127.0.0.1:${staticServerPort}/${pageName}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(140);
    await page.waitForFunction(() => {
        const hero = document.querySelector('#hero-reveal-container');
        if (!hero) return true;
        const transform = getComputedStyle(hero).transform;
        return transform === 'none' || Math.abs(new DOMMatrix(transform).m42) < 0.5;
    }, null, { timeout: 2000 });
    return { context, page, pageErrors, failedRequests };
}

async function getLayout(page) {
    return page.evaluate(() => {
        const rect = selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
                display: style.display, position: style.position, overflowY: style.overflowY,
                marginTop: style.marginTop, marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, top: style.top, bottomOffset: style.bottom,
                scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth
            };
        };
        const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        };
        return {
            viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport ? visualViewport.height : innerHeight },
            document: { scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, scrollHeight: document.documentElement.scrollHeight, bodyScrollHeight: document.body.scrollHeight },
            nav: rect('nav'),
            hero: rect('#hero-reveal-container'),
            landingSection: rect('#differentiation'),
            landingFooterLogo: rect('footer img'),
            landingFooterLinks: rect('footer > div > div:last-child'),
            landingAuthEmail: rect('#authEmailInput'),
            landingAuthPassword: rect('#authPasswordInput'),
            interstitialCard: rect('#interstitialCard'),
            interstitialModal: rect('#interstitialModal'),
            appHeader: rect('body > header'),
            appCanvas: rect('#mainContentCanvas'),
            mobileNav: rect('#mobileNavBar'),
            chatSection: rect('#chatboxSection'),
            chatPanel: rect('#chatbox-simulator-panel'),
            chatWrapper: rect('.chatbox-wrapper'),
            chatProfile: rect('.gf-profile-header'),
            chatMessages: rect('#chatbox-messages-container'),
            chatFooter: rect('.chatbox-footer-sticky-wrapper'),
            chatFooterRow: rect('.chatbox-footer'),
            chatFooterChildren: [...(document.querySelector('.chatbox-footer-sticky-wrapper') || { children: [] }).children].map(child => ({ id: child.id, className: child.className, offsetTop: child.offsetTop, offsetHeight: child.offsetHeight, computedPosition: getComputedStyle(child).position, display: getComputedStyle(child).display, transform: getComputedStyle(child).transform })),
            chatNotice: rect('#chatbox-credit-notice'),
            chatInput: rect('#simulator-chat-input'),
            chatReset: rect('#reset-chat-btn'),
            chatReview: rect('#simulatorReviewBtn'),
            settingsCard: rect('#settingsCard'),
            settingsModal: rect('#settingsModal'),
            menuButton: rect('#mobile-menu-btn'),
            menu: rect('#mobileMenu'),
            visibleDialogs: [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(visible).map(element => ({ id: element.id, rect: rect('#' + element.id) })),
            navButtons: [...document.querySelectorAll('#mobileNavBar button')].map(button => {
                const box = button.getBoundingClientRect();
                return { width: box.width, height: box.height };
            }),
            touchControls: [...document.querySelectorAll('button, a, input, textarea, select')].filter(visible).map(element => {
                const box = element.getBoundingClientRect();
                return { id: element.id, text: (element.textContent || '').trim().slice(0, 36), width: box.width, height: box.height };
            }).filter(control => control.id || control.text)
        };
    });
}

async function getMobileScrollContract(page) {
    return page.evaluate(() => ({
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
        bodyTouchAction: getComputedStyle(document.body).touchAction,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
    }));
}

async function assertDocumentScrolls(page, pageName, viewport) {
    const canScroll = await page.evaluate(() => {
        const scroller = document.scrollingElement;
        if (!scroller) return false;
        const maxScroll = scroller.scrollHeight - window.innerHeight;
        scroller.style.setProperty('scroll-behavior', 'auto', 'important');
        scroller.scrollTop = 0;
        return maxScroll > 0;
    });
    assert(canScroll, `${pageName} has no vertical scroll range at ${viewport.join('x')}`);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.scrollingElement && document.scrollingElement.scrollTop > 0, null, { timeout: 1000 });
    const moved = await page.evaluate(() => document.scrollingElement && document.scrollingElement.scrollTop > 0);
    assert(moved, `${pageName} document did not respond to vertical scrolling at ${viewport.join('x')}`);
}

async function assertRootScrollUnlocked(page, pageName, viewport) {
    const scrollContract = await page.evaluate(() => ({
        inlineOverflow: document.body.style.overflow,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY
    }));
    assert.strictEqual(scrollContract.inlineOverflow, '', `${pageName} left an inline body scroll lock after close at ${viewport.join('x')}`);
    assert.strictEqual(scrollContract.htmlOverflowY, 'auto', `${pageName} did not restore root scrolling after close at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
    assert.strictEqual(scrollContract.bodyOverflowY, 'visible', `${pageName} did not leave vertical scrolling to the HTML root after close at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
}

function assertNoPageErrors(pageName, viewport, pageErrors) {
    assert.deepStrictEqual(pageErrors, [], `${pageName} at ${viewport.join('x')} raised browser errors: ${pageErrors.join('; ')}`);
}

function rectsOverlap(first, second) {
    return first && second && first.x < second.right && first.right > second.x && first.y < second.bottom && first.bottom > second.y;
}

async function assertLanding(browser, viewport) {
    const opened = await openPage(browser, 'index.html', viewport);
    try {
        assertNoPageErrors('index.html', viewport, opened.pageErrors);
        const layout = await getLayout(opened.page);
        assert(layout.document.scrollWidth <= viewport[0] + 1, `landing document overflows at ${viewport.join('x')}`);
        assert(layout.document.bodyScrollWidth <= viewport[0] + 1, `landing body overflows at ${viewport.join('x')}`);
        if (viewport[0] < 768) {
            const scrollContract = await getMobileScrollContract(opened.page);
            assert.strictEqual(scrollContract.htmlOverflowY, 'auto', `landing document must remain vertically scrollable at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert.strictEqual(scrollContract.bodyOverflowY, 'visible', `landing body must leave vertical scrolling to the HTML root at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert.strictEqual(scrollContract.htmlTouchAction, 'pan-y pinch-zoom', `landing document must allow vertical touch panning and pinch zoom at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert.strictEqual(scrollContract.bodyTouchAction, 'pan-y pinch-zoom', `landing body must allow vertical touch panning and pinch zoom at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            const heroScrollContract = await opened.page.$eval('body.landing-page > section:first-of-type', element => {
                const style = getComputedStyle(element);
                return { overflowX: style.overflowX, overflowY: style.overflowY, touchAction: style.touchAction };
            });
            assert.strictEqual(heroScrollContract.overflowX, 'clip', `landing hero must clip visual overflow without creating a mobile touch barrier at ${viewport.join('x')}: ${JSON.stringify(heroScrollContract)}`);
            assert.strictEqual(heroScrollContract.overflowY, 'visible', `landing hero must leave vertical panning to the document at ${viewport.join('x')}: ${JSON.stringify(heroScrollContract)}`);
            assert.strictEqual(heroScrollContract.touchAction, 'pan-y', `landing hero must allow vertical touch panning at ${viewport.join('x')}: ${JSON.stringify(heroScrollContract)}`);
            const compatibilityScrollContract = await opened.page.$eval('#compatibility-row', element => {
                const style = getComputedStyle(element);
                return { overflowX: style.overflowX, overflowY: style.overflowY, touchAction: style.touchAction };
            });
            assert.strictEqual(compatibilityScrollContract.overflowX, 'clip', `landing compatibility marquee must clip horizontally without creating a vertical touch barrier at ${viewport.join('x')}: ${JSON.stringify(compatibilityScrollContract)}`);
            assert.strictEqual(compatibilityScrollContract.overflowY, 'visible', `landing compatibility marquee must leave vertical panning to the document at ${viewport.join('x')}: ${JSON.stringify(compatibilityScrollContract)}`);
            assert.strictEqual(compatibilityScrollContract.touchAction, 'pan-y', `landing compatibility marquee must allow vertical touch panning at ${viewport.join('x')}: ${JSON.stringify(compatibilityScrollContract)}`);
        }
        if (viewport[0] <= 639) {
            assert(layout.hero.y - layout.nav.bottom <= 56, `landing hero has excessive top gap at ${viewport.join('x')}: hero=${layout.hero.y}, nav=${layout.nav.bottom}`);
            const maxLandingStart = viewport[0] <= 360 ? 1050 : 930;
            assert(layout.landingSection.y <= maxLandingStart, `landing content starts too low at ${viewport.join('x')}: ${layout.landingSection.y}`);
            assert(layout.landingFooterLogo.height <= 88, `landing footer logo is oversized at ${viewport.join('x')}`);
            const footerWrap = await opened.page.evaluate(() => getComputedStyle(document.querySelector('footer > div > div:last-child')).flexWrap);
            assert(layout.landingFooterLinks && footerWrap === 'wrap', `landing footer links must wrap at ${viewport.join('x')}`);
            assert(layout.menuButton.width >= 44 && layout.menuButton.height >= 44, `landing menu touch target is too small at ${viewport.join('x')}`);

            await opened.page.click('#mobile-menu-btn');
            await opened.page.waitForTimeout(30);
            if (viewport[1] <= 520) {
                const menuContract = await opened.page.$eval('#mobileMenu', menu => {
                    const items = [...menu.querySelectorAll('a, button')];
                    const menuRect = menu.getBoundingClientRect();
                    const fullyVisible = item => {
                        const rect = item.getBoundingClientRect();
                        return rect.top >= menuRect.top && rect.bottom <= menuRect.bottom;
                    };
                    const firstVisibleAtStart = fullyVisible(items[0]);
                    menu.scrollTop = menu.scrollHeight - menu.clientHeight;
                    return {
                        scrollRange: menu.scrollHeight - menu.clientHeight,
                        overflowY: getComputedStyle(menu).overflowY,
                        firstVisibleAtStart,
                        lastVisibleAtEnd: fullyVisible(items[items.length - 1])
                    };
                });
                assert(menuContract.scrollRange > 0 && ['auto', 'scroll'].includes(menuContract.overflowY), `compact landing menu must be internally scrollable at ${viewport.join('x')}: ${JSON.stringify(menuContract)}`);
                assert(menuContract.firstVisibleAtStart && menuContract.lastVisibleAtEnd, `compact landing menu items must be reachable by scrolling at ${viewport.join('x')}: ${JSON.stringify(menuContract)}`);
            }
            const menuScrollRange = await opened.page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
            const menuTopBeforeWheel = await opened.page.evaluate(() => document.scrollingElement.scrollTop);
            await opened.page.mouse.wheel(0, 80);
            const menuScrollLock = await opened.page.evaluate(() => ({
                inlineOverflow: document.body.style.overflow,
                htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
                bodyOverflowY: getComputedStyle(document.body).overflowY,
                top: document.scrollingElement.scrollTop
            }));
            assert.strictEqual(menuScrollLock.inlineOverflow, 'hidden', `mobile menu must set a body scroll lock at ${viewport.join('x')}`);
            assert.strictEqual(menuScrollLock.htmlOverflowY, 'hidden', `mobile menu must lock the root scroller at ${viewport.join('x')}: ${JSON.stringify(menuScrollLock)}`);
            assert.strictEqual(menuScrollLock.bodyOverflowY, 'hidden', `mobile menu body scroll lock is overridden at ${viewport.join('x')}: ${JSON.stringify(menuScrollLock)}`);
            if (menuScrollRange > 0) {
                assert.strictEqual(menuScrollLock.top > menuTopBeforeWheel, false, `mobile menu allowed document scrolling at ${viewport.join('x')}: ${JSON.stringify({ ...menuScrollLock, menuTopBeforeWheel })}`);
            }
            await opened.page.click('#mobile-menu-btn');
            await opened.page.waitForTimeout(30);
            await assertRootScrollUnlocked(opened.page, 'landing menu', viewport);

            await opened.page.evaluate(() => window.openAuthRequiredModal());
            await opened.page.waitForTimeout(30);
            const authInputs = await opened.page.evaluate(() => [document.getElementById('authEmailInput'), document.getElementById('authPasswordInput')].map(input => parseFloat(getComputedStyle(input).fontSize)));
            assert(authInputs.every(size => size >= 16), `landing auth inputs must use 16px text at ${viewport.join('x')}`);
            await opened.page.evaluate(() => window.closeAuthRequiredModal());

            await opened.page.evaluate(() => window.openInterstitialModal());
            await opened.page.waitForTimeout(30);
            const consent = await getLayout(opened.page);
            assert(consent.interstitialCard && consent.interstitialCard.bottom <= consent.viewport.visualHeight + 1, `landing consent dialog exceeds visual viewport at ${viewport.join('x')}`);
            if (consent.interstitialCard.scrollHeight > consent.interstitialCard.clientHeight) {
                assert(['auto', 'scroll'].includes(consent.interstitialCard.overflowY), `landing consent dialog is not internally scrollable at ${viewport.join('x')}`);
            }
            await opened.page.evaluate(() => window.closeInterstitialModal());
            await opened.page.waitForTimeout(30);
        }
    } finally {
        await opened.context.close();
    }
}

async function assertLegal(browser, pageName, viewport) {
    const opened = await openPage(browser, pageName, viewport);
    try {
        assertNoPageErrors(pageName, viewport, opened.pageErrors);
        const layout = await getLayout(opened.page);
        assert(layout.document.scrollWidth <= viewport[0] + 1, `${pageName} overflows at ${viewport.join('x')}`);
        if (viewport[0] < 768) {
            const linkWrap = await opened.page.$eval('footer > div > div:last-child', element => getComputedStyle(element).flexWrap);
            assert.strictEqual(linkWrap, 'wrap', `${pageName} footer links do not wrap at ${viewport.join('x')}`);
            assert(layout.touchControls.filter(control => control.text.includes('Home') || control.text.includes('Policy') || control.text.includes('Terms')).every(control => control.height >= 40), `${pageName} important links have undersized touch targets at ${viewport.join('x')}`);
        }
    } finally {
        await opened.context.close();
    }
}

async function activateTab(page, tabId) {
    await page.evaluate(tab => window.switchTab(tab), tabId);
    await page.waitForTimeout(80);
}

async function assertDynamicDialog(page, selector, name) {
    const metrics = await page.$eval(selector, modal => {
        const card = modal.firstElementChild;
        const modalRect = modal.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const modalStyle = getComputedStyle(modal);
        const cardStyle = getComputedStyle(card);
        return {
            visible: modalStyle.display !== 'none' && modalStyle.visibility !== 'hidden' && modalRect.width > 0 && modalRect.height > 0,
            focused: modal.contains(document.activeElement),
            cardBottom: cardRect.bottom,
            visualHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight,
            internallyScrollable: card.scrollHeight > card.clientHeight && ['auto', 'scroll'].includes(cardStyle.overflowY),
            cardOverflow: cardStyle.overflowY
        };
    });
    assert(metrics.visible, `${name} did not become visible`);
    assert(metrics.focused, `${name} did not retain focus inside the dialog`);
    assert(metrics.cardBottom <= metrics.visualHeight + 1 || metrics.internallyScrollable, `${name} exceeds the visual viewport without internal scrolling: ${JSON.stringify(metrics)}`);
}

async function assertApp(browser, viewport) {
    const opened = await openPage(browser, 'app.html', viewport);
    try {
        assertNoPageErrors('app.html', viewport, opened.pageErrors);
        const initial = await getLayout(opened.page);
        assert(initial.document.scrollWidth <= viewport[0] + 1, `app document overflows at ${viewport.join('x')}`);
        if (viewport[0] < 768) {
            const scrollContract = await getMobileScrollContract(opened.page);
            assert.strictEqual(scrollContract.htmlOverflowY, 'auto', `app document must remain vertically scrollable at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert.strictEqual(scrollContract.bodyOverflowY, 'visible', `app body must leave vertical scrolling to the HTML root at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert.strictEqual(scrollContract.htmlTouchAction, 'pan-y pinch-zoom', `app document must allow vertical touch panning and pinch zoom at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert.strictEqual(scrollContract.bodyTouchAction, 'pan-y pinch-zoom', `app body must allow vertical touch panning and pinch zoom at ${viewport.join('x')}: ${JSON.stringify(scrollContract)}`);
            assert(initial.mobileNav.height >= 72, `mobile app navigation is too short at ${viewport.join('x')}`);
            assert(initial.navButtons.every(button => button.width >= 44 && button.height >= 44), `mobile app navigation touch target is too small at ${viewport.join('x')}`);
            assert(initial.appHeader.height <= 80, `mobile app header is too tall at ${viewport.join('x')}`);

            await activateTab(opened.page, 'chatboxSection');
            const chat = await getLayout(opened.page);
            const scenarioScrollContract = await opened.page.$eval('#practiceScenarioBar', element => {
                const style = getComputedStyle(element);
                return { overflowX: style.overflowX, overflowY: style.overflowY, touchAction: style.touchAction };
            });
            assert.strictEqual(scenarioScrollContract.overflowX, 'auto', `Practice scenario bar must retain horizontal scrolling at ${viewport.join('x')}: ${JSON.stringify(scenarioScrollContract)}`);
            assert.strictEqual(scenarioScrollContract.overflowY, 'hidden', `Practice scenario bar must not create a vertical scroll container at ${viewport.join('x')}: ${JSON.stringify(scenarioScrollContract)}`);
            assert.strictEqual(scenarioScrollContract.touchAction, 'pan-x pan-y', `Practice scenario bar must allow vertical touch panning to its parent at ${viewport.join('x')}: ${JSON.stringify(scenarioScrollContract)}`);
            const navVisible = chat.mobileNav.display !== 'none' && chat.mobileNav.height > 0;
            const navTop = navVisible ? chat.mobileNav.y : chat.viewport.visualHeight;
            const shortLandscape = viewport[0] < 768 && viewport[1] <= 520;
            assert(chat.chatSection && chat.chatWrapper && chat.chatFooter && chat.chatNotice && chat.chatInput && chat.chatReset && chat.chatReview, `chat controls missing at ${viewport.join('x')}`);
            assert(!rectsOverlap(chat.chatFooter, chat.chatProfile), `chat composer overlaps the profile header at ${viewport.join('x')}: ${JSON.stringify(chat)}`);
            assert(!rectsOverlap(chat.chatFooter, chat.chatMessages), `chat composer overlaps the message region at ${viewport.join('x')}: ${JSON.stringify(chat)}`);
            assert(chat.chatFooter.bottom <= chat.chatWrapper.bottom + 1 && chat.chatNotice.bottom <= chat.chatWrapper.bottom + 1, `chat footer content is clipped by its wrapper at ${viewport.join('x')}: ${JSON.stringify({ wrapper: chat.chatWrapper, footer: chat.chatFooter, notice: chat.chatNotice })}`);
            if (shortLandscape) {
                assert(navVisible && chat.mobileNav.height >= 72, `short Practice landscape must keep mobile tab navigation reachable at ${viewport.join('x')}: ${JSON.stringify(chat.mobileNav)}`);
                await opened.page.click('#mobileNavBar button[data-tab="analyzeSection"]');
                await opened.page.waitForTimeout(80);
                const analyzeReachable = await opened.page.evaluate(() => {
                    const section = document.getElementById('analyzeSection');
                    return !!section && getComputedStyle(section).display !== 'none';
                });
                assert(analyzeReachable, 'short Practice landscape mobile navigation cannot return to Analyze');
                await activateTab(opened.page, 'chatboxSection');
            }
            if (shortLandscape) {
                assert(chat.document.scrollHeight > viewport[1], `short Practice landscape must remain document-scrollable for fixed-nav clearance: ${JSON.stringify(chat.document)}`);
            } else {
                assert(chat.chatSection.bottom <= navTop + 1, `chat section is covered by bottom nav at ${viewport.join('x')}: section=${JSON.stringify(chat.chatSection)}, nav=${navTop}`);
                assert(chat.chatFooter.bottom <= navTop + 1, `chat composer is covered by bottom nav at ${viewport.join('x')}: footer=${JSON.stringify(chat.chatFooter)}, nav=${navTop}, wrapper=${JSON.stringify(chat.chatWrapper)}, profile=${JSON.stringify(chat.chatProfile)}, messages=${JSON.stringify(chat.chatMessages)}, footerRow=${JSON.stringify(chat.chatFooterRow)}, notice=${JSON.stringify(chat.chatNotice)}, children=${JSON.stringify(chat.chatFooterChildren)}`);
                assert(chat.chatNotice.bottom <= navTop + 1, `chat credit notice is covered by bottom nav at ${viewport.join('x')}: notice=${chat.chatNotice.bottom}, nav=${navTop}`);
            }
            assert(chat.chatInput.height >= 44, `chat input is too short at ${viewport.join('x')}`);
            assert(chat.chatReset.height >= 44, `chat reset/review control is too short at ${viewport.join('x')}`);
            assert(chat.chatReview.height >= 44, `chat Finish & Review control is too short at ${viewport.join('x')}`);
            const minimumMessagesHeight = viewport[1] <= 521 ? 40 : 72;
            assert(chat.chatMessages.height >= minimumMessagesHeight, `chat message region is not usable on ${viewport.join('x')}: profile=${JSON.stringify(chat.chatProfile)}, footer=${JSON.stringify(chat.chatFooter)}, row=${JSON.stringify(chat.chatFooterRow)}, notice=${JSON.stringify(chat.chatNotice)}`);
            if (!navVisible) {
                assert(chat.chatWrapper.overflowY === 'auto' && chat.chatWrapper.scrollHeight > chat.chatWrapper.clientHeight, `short Practice chat must remain internally scrollable when the mobile nav is hidden at ${viewport.join('x')}: ${JSON.stringify(chat.chatWrapper)}`);
            }
            if (shortLandscape) {
                assert(chat.document.scrollHeight > viewport[1], `short Practice landscape must remain document-scrollable after the chat card expands: ${JSON.stringify(chat.document)}`);
                await opened.page.evaluate(() => {
                    const scroller = document.scrollingElement;
                    scroller.scrollTop = scroller.scrollHeight - window.innerHeight;
                });
                const footerAtScrollEnd = await getLayout(opened.page);
                assert(footerAtScrollEnd.chatFooter.bottom <= footerAtScrollEnd.mobileNav.y + 1, `short Practice composer is hidden behind the fixed nav after scrolling: ${JSON.stringify(footerAtScrollEnd)}`);
            } else {
                assert(chat.document.scrollHeight <= viewport[1] + 1, `Practice adds duplicate vertical clearance at ${viewport.join('x')}: ${JSON.stringify(chat.document)}`);
            }
            const visualHeight = await opened.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wingman-visual-height').trim());
            assert(visualHeight.endsWith('px'), `visual viewport height is not published at ${viewport.join('x')}`);
            if (!shortLandscape) {
                assert(chat.chatWrapper.bottom <= viewport[1] + 1, `chat wrapper is clipped below the viewport at ${viewport.join('x')}`);
            }

            await opened.page.evaluate(() => window.openSettingsModal());
            await opened.page.waitForTimeout(50);
            const settings = await getLayout(opened.page);
            assert(settings.settingsCard && settings.settingsModal, `settings dialog did not open at ${viewport.join('x')}`);
            assert(settings.settingsCard.bottom <= settings.viewport.visualHeight + 1, `settings dialog exceeds visual viewport at ${viewport.join('x')}`);
            if (settings.settingsCard.scrollHeight > settings.settingsCard.clientHeight) {
                assert(['auto', 'scroll'].includes(settings.settingsCard.overflowY), `settings dialog is not internally scrollable at ${viewport.join('x')}`);
            }
            await opened.page.evaluate(() => window.closeSettingsModal());

            await opened.page.evaluate(() => {
                document.scrollingElement.scrollTop = 0;
                window.openPurchaseModal();
            });
            await opened.page.waitForTimeout(50);
            const pricingState = await opened.page.$eval('#pricingTiers', element => ({
                scrollRange: element.scrollHeight - element.clientHeight,
                overflowY: getComputedStyle(element).overflowY
            }));
            assert(pricingState.scrollRange > 0 && ['auto', 'scroll'].includes(pricingState.overflowY), `purchase pricing pane must retain an internal scroll contract at ${viewport.join('x')}: ${JSON.stringify(pricingState)}`);
            const purchaseScrollLock = await opened.page.evaluate(() => ({
                inlineOverflow: document.body.style.overflow,
                computedOverflowY: getComputedStyle(document.body).overflowY,
                htmlOverflowY: getComputedStyle(document.documentElement).overflowY
            }));
            assert.strictEqual(purchaseScrollLock.inlineOverflow, 'hidden', `purchase modal must set a body scroll lock at ${viewport.join('x')}`);
            assert.strictEqual(purchaseScrollLock.computedOverflowY, 'hidden', `purchase modal body scroll lock is overridden at ${viewport.join('x')}: ${JSON.stringify(purchaseScrollLock)}`);
            assert.strictEqual(purchaseScrollLock.htmlOverflowY, 'hidden', `purchase modal must lock the root scroller at ${viewport.join('x')}: ${JSON.stringify(purchaseScrollLock)}`);
            await opened.page.evaluate(() => window.closePurchaseModal());
            await assertRootScrollUnlocked(opened.page, 'purchase modal', viewport);

            if (viewport[0] === 320 && viewport[1] === 568) {
                await opened.page.focus('#simulator-chat-input');
                const focusedEmptyInput = await opened.page.evaluate(() => document.activeElement && document.activeElement.id === 'simulator-chat-input');
                assert(focusedEmptyInput, 'empty chat input did not receive focus');

                const originalViewport = { width: viewport[0], height: viewport[1] };
                await opened.page.setViewportSize({ width: viewport[1], height: viewport[0] });
                await opened.page.waitForTimeout(80);
                const rotatedViewport = await opened.page.evaluate(() => ({
                    visualHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight,
                    publishedHeight: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wingman-visual-height'))
                }));
                assert(Math.abs(rotatedViewport.visualHeight - rotatedViewport.publishedHeight) <= 1, `visualViewport height contract did not update after orientation change: ${JSON.stringify(rotatedViewport)}`);
                await opened.page.setViewportSize(originalViewport);
                await opened.page.waitForTimeout(80);

                await opened.page.evaluate(() => document.body.classList.add('chat-keyboard-open'));
                const keyboardLayout = await opened.page.evaluate(() => ({
                    navDisplay: getComputedStyle(document.getElementById('mobileNavBar')).display,
                    noticeDisplay: getComputedStyle(document.getElementById('chatbox-credit-notice')).display,
                    noticeHeight: document.getElementById('chatbox-credit-notice').getBoundingClientRect().height
                }));
                assert.strictEqual(keyboardLayout.navDisplay, 'none', `keyboard state must remove bottom navigation from the visual viewport: ${JSON.stringify(keyboardLayout)}`);
                assert(keyboardLayout.noticeDisplay !== 'none' && keyboardLayout.noticeHeight > 0, `keyboard state must keep the credit notice reachable: ${JSON.stringify(keyboardLayout)}`);
                await opened.page.evaluate(() => document.body.classList.remove('chat-keyboard-open'));

                await opened.page.evaluate(async () => {
                    const session = { access_token: 'test-token', user: { id: 'qa-user', email: 'qa@example.com' } };
                    window.currentSupabaseSession = session;
                    window.currentSupabaseUser = session.user;
                    window.supabaseClient = { auth: { getSession: async () => ({ data: { session }, error: null }) } };
                    window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer test-token' });
                    window.checkCreditBalance = async () => {
                        window.updateUICredits(50);
                        return { success: true, status: 'loaded', credits: 50 };
                    };
                    window.fetch = async url => {
                        if (String(url).includes('/api/consent/status')) {
                            return new Response(JSON.stringify({ hasActiveConsent: true, termsVersion: '2026.1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                        }
                        return new Response(JSON.stringify({ reply: 'Keyboard path reply', credits: 48 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                    };
                    await window.checkServerConsentStatus();
                    window.clearAndResetChatbox();
                    const input = document.getElementById('simulator-chat-input');
                    input.value = 'Keyboard path fixture';
                });
                await opened.page.focus('#simulator-chat-input');
                await opened.page.evaluate(() => window.submitChatboxMessage());
                await opened.page.waitForTimeout(80);
                const sendState = await opened.page.evaluate(() => ({
                    focused: document.activeElement && document.activeElement.id === 'simulator-chat-input',
                    userMessage: document.getElementById('chatbox-messages-container').textContent.includes('Keyboard path fixture'),
                    reply: document.getElementById('chatbox-messages-container').textContent.includes('Keyboard path reply')
                }));
                assert(sendState.focused && sendState.userMessage && sendState.reply, `send/refocus path failed: ${JSON.stringify(sendState)}`);

                await opened.page.evaluate(() => document.body.classList.add('chat-keyboard-open'));
                await activateTab(opened.page, 'analyzeSection');
                const switchedAway = await opened.page.evaluate(() => ({ focusedId: document.activeElement && document.activeElement.id, keyboardClass: document.body.classList.contains('chat-keyboard-open') }));
                assert.notStrictEqual(switchedAway.focusedId, 'simulator-chat-input', 'switching tabs must blur the chat input');
                assert.strictEqual(switchedAway.keyboardClass, false, 'switching tabs must clear keyboard layout state');
                await activateTab(opened.page, 'chatboxSection');
                assert(await opened.page.isVisible('#simulator-chat-input'), 'returning to Practice must keep the composer visible');
            }

            await opened.page.evaluate(() => window.openPasswordRecoveryModal());
            await opened.page.waitForTimeout(50);
            const recoveryDialogs = await opened.page.evaluate(() => [
                document.getElementById('wingmanPasswordRecoveryOverlay'),
                document.getElementById('passwordRecoveryModal')
            ].filter(Boolean).length);
            assert.strictEqual(recoveryDialogs, 1, `password recovery must render exactly one dialog, found ${recoveryDialogs}`);
            await assertDynamicDialog(opened.page, '#wingmanPasswordRecoveryOverlay', 'password recovery dialog');
            await opened.page.keyboard.press('Escape');
            await opened.page.waitForTimeout(30);

            await opened.page.evaluate(() => {
                const messages = document.getElementById('chatbox-messages-container');
                messages.innerHTML = '';
                const user = document.createElement('div');
                user.className = 'animate-chat-bubble';
                user.style.alignSelf = 'flex-end';
                user.textContent = 'Review user fixture';
                const assistant = document.createElement('div');
                assistant.className = 'animate-chat-bubble';
                assistant.style.alignSelf = 'flex-start';
                assistant.textContent = 'Review assistant fixture';
                messages.append(user, assistant);
                window.getSupabaseAuthHeaders = async () => ({ Authorization: 'Bearer review-token' });
                window.fetch = async () => new Response(JSON.stringify({ success: true, overall_score: 82, status_text: 'REVIEW COMPLETE', wit_score: 80, text_economy: 84, confidence_score: 82, performance_summary: 'Solid fixture', biggest_strength: 'Clarity', biggest_mistake: 'None', priority_focus: 'Keep practicing', credits: 48 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            });
            await opened.page.evaluate(() => window.triggerFinishAndReview());
            await opened.page.waitForTimeout(100);
            await assertDynamicDialog(opened.page, '#simulatorReviewModal', 'simulator review dialog');
            await opened.page.evaluate(() => window.closeSessionReviewModal());
            await opened.page.evaluate(() => {
                const messages = document.getElementById('chatbox-messages-container');
                messages.innerHTML = '<div class="animate-chat-bubble">Conversation fixture</div>';
            });
            await activateTab(opened.page, 'analyzeSection');
            await activateTab(opened.page, 'chatboxSection');
            const preserved = await opened.page.$eval('#chatbox-messages-container', element => element.textContent.includes('Conversation fixture'));
            assert(preserved, `chat history must survive switching app tabs at ${viewport.join('x')}`);
        } else {
            await activateTab(opened.page, 'chatboxSection');
            const desktopChat = await getLayout(opened.page);
            assert(desktopChat.chatPanel.x - desktopChat.appCanvas.x >= 16, `desktop chat tab strips the main content gutter at ${viewport.join('x')}`);
        }
    } finally {
        await opened.context.close();
    }
}

async function assertPracticeHeightBoundary(browser, viewport) {
    const opened = await openPage(browser, 'app.html', viewport);
    try {
        assertNoPageErrors('app.html', viewport, opened.pageErrors);
        const scrollContract = await getMobileScrollContract(opened.page);
        assert.strictEqual(scrollContract.htmlOverflowY, 'auto', `boundary app root must remain vertically scrollable at ${viewport.join('x')}`);
        assert.strictEqual(scrollContract.bodyOverflowY, 'visible', `boundary app body must leave vertical scrolling to the HTML root at ${viewport.join('x')}`);
        assert.strictEqual(scrollContract.htmlTouchAction, 'pan-y pinch-zoom', `boundary app root touch action changed at ${viewport.join('x')}`);
        assert.strictEqual(scrollContract.bodyTouchAction, 'pan-y pinch-zoom', `boundary app body touch action changed at ${viewport.join('x')}`);
        await activateTab(opened.page, 'chatboxSection');
        const layout = await getLayout(opened.page);
        assert(layout.chatWrapper && layout.chatFooter && layout.chatMessages && layout.mobileNav, `boundary Practice controls missing at ${viewport.join('x')}`);
        assert(layout.chatFooter.bottom <= layout.chatWrapper.bottom + 1, `boundary Practice footer is clipped at ${viewport.join('x')}`);
        assert(layout.chatMessages.height >= 40, `boundary Practice message region is unusable at ${viewport.join('x')}`);
        if (viewport[1] <= 520) {
            assert(layout.document.scrollHeight > viewport[1], `compact boundary Practice must remain document-scrollable at ${viewport.join('x')}`);
        } else {
            assert(layout.chatSection.bottom <= layout.mobileNav.y + 1, `normal boundary Practice is covered by the fixed nav at ${viewport.join('x')}`);
        }
    } finally {
        await opened.context.close();
    }
}

async function assertRealInputScroll(browser, pageName, viewport) {
    const opened = await openPage(browser, pageName, viewport);
    try {
        assertNoPageErrors(pageName, viewport, opened.pageErrors);
        await assertDocumentScrolls(opened.page, pageName, viewport);
    } finally {
        await opened.context.close();
    }
}

async function run() {
    const server = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
        for (const viewport of MOBILE_VIEWPORTS) {
            await assertLanding(browser, viewport);
            await assertApp(browser, viewport);
            for (const pageName of ['terms.html', 'privacy.html', 'refund.html']) await assertLegal(browser, pageName, viewport);
        }
        for (const viewport of [...DESKTOP_VIEWPORTS, ...BREAKPOINT_VIEWPORTS]) {
            await assertLanding(browser, viewport);
            await assertApp(browser, viewport);
        }
        for (const viewport of PRACTICE_HEIGHT_BOUNDARIES) await assertPracticeHeightBoundary(browser, viewport);
        await assertRealInputScroll(browser, 'index.html', [320, 568]);
        await assertRealInputScroll(browser, 'app.html', [390, 700]);
        console.log(`Mobile presentation QA passed across ${MOBILE_VIEWPORTS.length} mobile, ${DESKTOP_VIEWPORTS.length} desktop, ${BREAKPOINT_VIEWPORTS.length} breakpoint, and ${PRACTICE_HEIGHT_BOUNDARIES.length} Practice height-boundary viewports with real-input scroll probes.`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
