'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

assert(app.includes('visualViewport'), 'mobile layout must react to the visual viewport');
assert(app.includes('--wingman-visual-height'), 'mobile layout must publish the visual viewport height');
assert(!html.includes('min-height: calc(100vh - 160px) !important'), 'mobile chat must not use a fixed layout viewport height');
assert(!html.includes('min-height: calc(100vh - 240px) !important'), 'mobile chat wrapper must not use a fixed layout viewport height');
assert(!html.includes('max-height: calc(100vh - 380px) !important'), 'mobile chat messages must not use a fixed layout viewport height');
assert(/id="settingPlexusToggle"[\s\S]{0,500}checked/i.test(html), 'Plexus control must be enabled by default');
assert(!app.includes('mobilePlexusDisabled'), 'Plexus control must not be hard-disabled on mobile');
assert(css.includes('env(safe-area-inset-bottom'), 'mobile layout must reserve the bottom safe area');
assert(css.includes('100dvh'), 'mobile layout must use a dynamic viewport unit');
assert(css.includes('body.app-page #mainContentCanvas > section.hidden'), 'inactive feature sections must stay hidden even when a layout rule forces display');
assert(css.includes('var(--wingman-visual-bottom-inset)'), 'mobile navigation must account for the visual viewport bottom inset');
assert(/body\.app-page\.chat-keyboard-open\s+#mobileNavBar\s*\{[^}]*display:\s*flex\s*!important;[^}]*pointer-events:\s*auto\s*!important;/s.test(css), 'keyboard-open mobile navigation must remain visible and interactive');
assert(!/body\.app-page\.chat-keyboard-open\s+#mobileNavBar\s*\{[^}]*display:\s*none/i.test(css), 'keyboard-open mobile navigation must not be hidden');
assert(app.includes('viewport.offsetTop'), 'mobile viewport layout must account for visual viewport top offsets');
assert(app.includes('scheduleVisualViewportUpdate'), 'viewport updates must be coalesced to animation frames');
assert(!app.includes("ci.scrollIntoView({ behavior: 'smooth', block: 'nearest' })"), 'chat focus must not trigger competing delayed scrollIntoView operations');
assert(!config.includes('window.switchTab'), 'config must not add a second tab-switch scroll wrapper');

console.log('Mobile viewport behavior guard passed.');
