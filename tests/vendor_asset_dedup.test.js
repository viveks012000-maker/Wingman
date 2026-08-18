'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8').replace(/\r\n/g, '\n');

assert.ok(!fs.existsSync(path.join(ROOT, 'vendor', 'cropper.min.js')), 'unused duplicate root Cropper JS must stay removed');
assert.ok(!fs.existsSync(path.join(ROOT, 'vendor', 'cropper.min.css')), 'unused duplicate root Cropper CSS must stay removed');
assert.ok(fs.existsSync(path.join(ROOT, 'vendor', 'cropperjs', 'cropper.min.js')), 'canonical Cropper JS must remain');
assert.ok(fs.existsSync(path.join(ROOT, 'vendor', 'cropperjs', 'cropper.min.css')), 'canonical Cropper CSS must remain');
assert.ok(appHtml.includes('./vendor/cropperjs/cropper.min.js'), 'dashboard must keep using canonical Cropper JS');
assert.ok(appHtml.includes('./vendor/cropperjs/cropper.min.css'), 'dashboard must keep using canonical Cropper CSS');
assert.ok(!appHtml.includes('src="./vendor/cropper.min.js"'), 'dashboard must not reference removed duplicate Cropper JS');
assert.ok(!appHtml.includes('href="./vendor/cropper.min.css"'), 'dashboard must not reference removed duplicate Cropper CSS');

console.log('✅ Vendor Cropper deduplication regression guard passed.');
