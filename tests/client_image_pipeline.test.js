'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const imagePipelineStart = app.indexOf('const MAX_IMAGE_EDGE');
const imagePipelineEnd = app.indexOf('window.processSelectedFiles', imagePipelineStart);
assert(imagePipelineStart >= 0 && imagePipelineEnd > imagePipelineStart, 'image pipeline must be present');
const imagePipeline = app.slice(imagePipelineStart, imagePipelineEnd);
assert(imagePipeline.includes('const MAX_IMAGE_EDGE = 3072'), 'image edge bound must remain 3072px');
assert(imagePipeline.includes('const MAX_IMAGE_PIXELS = 8_000_000'), 'image pixel budget must remain 8MP');
assert(imagePipeline.includes('const MAX_IMAGE_DATA_URL_BYTES = 5 * 1024 * 1024'), 'image data URL bound must remain 5MB');
assert(imagePipeline.includes('canvas.width = dimensions.width'), 'processed images must use bounded canvas width');
assert(imagePipeline.includes('canvas.height = dimensions.height'), 'processed images must use bounded canvas height');
assert(imagePipeline.includes('ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height)'), 'images must be rendered at bounded dimensions');
assert(imagePipeline.includes('canvasToJpegDataUrl(canvas)'), 'images must be converted to JPEG data URLs');
assert(!imagePipeline.includes('enforceWordLimitClient'), 'image processing must not use the text word limiter');
console.log('Client image pipeline guard passed.');
