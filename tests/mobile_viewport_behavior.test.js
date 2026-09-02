'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert(app.includes('visualViewport'), 'mobile layout must react to the visual viewport');
assert(app.includes('--wingman-visual-height'), 'mobile layout must publish the visual viewport height');
assert(!html.includes('min-height: calc(100vh - 160px) !important'), 'mobile chat must not use a fixed layout viewport height');
assert(!html.includes('min-height: calc(100vh - 240px) !important'), 'mobile chat wrapper must not use a fixed layout viewport height');
assert(!html.includes('max-height: calc(100vh - 380px) !important'), 'mobile chat messages must not use a fixed layout viewport height');
assert(/id="settingPlexusToggle"[\s\S]{0,500}checked/i.test(html), 'Plexus control must be enabled by default');
assert(!app.includes('mobilePlexusDisabled'), 'Plexus control must not be hard-disabled on mobile');
assert(css.includes('env(safe-area-inset-bottom'), 'mobile layout must reserve the bottom safe area');
assert(css.includes('100dvh'), 'mobile layout must use a dynamic viewport unit');

console.log('Mobile viewport behavior guard passed.');
