const assert = require('node:assert/strict');
const { normalizeAnalyzerImages } = require('../middleware/imageValidator');

const sample = Buffer.from('synthetic image payload').toString('base64');
const dataUrl = `data:image/png;base64,${sample}`;

const normalized = normalizeAnalyzerImages({ images: [dataUrl] });
assert.equal(normalized.valid, true);
assert.deepEqual(normalized.imageList, [dataUrl]);

const legacy = normalizeAnalyzerImages({ imageBase64: sample });
assert.equal(legacy.valid, true);
assert.deepEqual(legacy.imageList, [`data:image/jpeg;base64,${sample}`]);

const legacyEmptyArray = normalizeAnalyzerImages({ images: [], image: dataUrl });
assert.equal(legacyEmptyArray.valid, true);
assert.deepEqual(legacyEmptyArray.imageList, [dataUrl]);

assert.match(normalizeAnalyzerImages({ images: ['https://example.test/screenshot.png'] }).error, /Remote image URLs/);
assert.match(normalizeAnalyzerImages({ images: ['//example.test/screenshot.png'] }).error, /Remote image URLs/);
assert.match(normalizeAnalyzerImages({ images: ['data:image/svg+xml;base64,PHN2Zy8+'] }).error, /image format is not supported/i);
assert.match(normalizeAnalyzerImages({ images: ['data:image/png;base64,???'] }).error, /base64/i);
assert.match(normalizeAnalyzerImages({ images: ['data:image/png;base64,ab==='] }).error, /base64/i);
assert.match(normalizeAnalyzerImages({ images: Array(6).fill(dataUrl) }).error, /maximum of 5 images/i);
assert.match(normalizeAnalyzerImages({ images: [Buffer.alloc(6 * 1024 * 1024).toString('base64')] }).error, /5 MB/i);

console.log('Analyzer image normalization and validation contract passed.');
