'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert(start >= 0, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not parse ${name}`);
}

const canvases = [];
class MockFileReader {
  readAsDataURL() {
    this.onload({ target: { result: 'data:image/png;base64,input' } });
  }
}
class MockImage {
  constructor() {
    this.naturalWidth = 10000;
    this.naturalHeight = 8000;
  }

  set src(value) {
    this.onload();
  }
}
const documentMock = {
  createElement(tag) {
    assert.strictEqual(tag, 'canvas');
    const canvas = {
      set width(value) { this._width = value; },
      get width() { return this._width; },
      set height(value) { this._height = value; },
      get height() { return this._height; },
      getContext() { return { drawImage() {} }; },
      toDataURL() { return 'data:image/jpeg;base64,compressed'; }
    };
    canvases.push(canvas);
    return canvas;
  }
};

const imagePipelineStart = app.indexOf('const MAX_IMAGE_EDGE');
const imagePipelineEnd = app.indexOf('window.processSelectedFiles', imagePipelineStart);
const imagePipelineSource = app.slice(imagePipelineStart, imagePipelineEnd);
// lgtm [js/code-injection] This evaluates checked-in app.js source, never request data.
const processImage = vm.runInNewContext(`${imagePipelineSource}\nprocessImageToJpegDataUrl`, {
  FileReader: MockFileReader,
  Image: MockImage,
  document: documentMock,
  Promise
});

(async () => {
  const result = await processImage({ name: 'large.png', type: 'image/png' });
  assert.ok(result.startsWith('data:image/jpeg;'), 'processed image must be a JPEG data URL');
  assert.strictEqual(canvases.length, 1);
  assert(canvases[0].width <= 3072, `image width must be bounded, got ${canvases[0].width}`);
  assert(canvases[0].height <= 3072, `image height must be bounded, got ${canvases[0].height}`);
  assert(canvases[0].width * canvases[0].height <= 8_000_000, 'image pixel budget must be bounded');

  const functionStart = app.indexOf('function processImageToJpegDataUrl');
  const functionEnd = app.indexOf('window.processSelectedFiles', functionStart);
  const imagePipeline = app.slice(functionStart, functionEnd);
  assert(!imagePipeline.includes('enforceWordLimitClient'), 'image processing must not use the text word limiter');
  console.log('Client image pipeline guard passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
