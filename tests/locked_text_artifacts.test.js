'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCKS = Object.freeze({
  'fonts/main-fonts.css': [27742, '57be9a5a28a7824706517e8d6bc2c1015dc10e137020b72b485ae69254984186'],
  'fonts/licenses/geist-OFL.txt': [4387, '1781d2806a07d91c4edf4740b88449fab7d0eadad53f7c351b94cd4d4eb8c00f'],
  'fonts/licenses/inter-OFL.txt': [4377, '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57'],
  'fonts/licenses/plus-jakarta-sans-OFL.txt': [4402, '995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99'],
  'vendor/cropperjs/cropper.min.js': [37035, '615835110d07d9842d1c0a995e9fc79fb4dfa8d2c1b879ff0d648570714ee1c7'],
  'vendor/cropperjs/cropper.min.css': [3804, '055b9c1ce54007be24408e3d02e584e82c60a9a52cd1c780e5ff08318a1d787f'],
  'vendor/supabase.min.js': [212199, 'cf529fe8980cbe6f2dd3e3930ecf96352ed3d3d71233b6760e4f927f89b94b9f'],
  'output.css': [113877, 'f513634da85c3b6248efedb2a70605d10552cb251e73bfccd0b3b5dc6af87f56']
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

for (const [relative, [bytes, hash]] of Object.entries(LOCKS)) {
  const file = path.join(ROOT, relative);
  const content = fs.readFileSync(file);
  assert.strictEqual(content.includes(13), false, `${relative} must use LF-only bytes`);
  assert.strictEqual(content.length, bytes, `${relative} byte count drifted`);
  assert.strictEqual(sha256(content), hash, `${relative} SHA-256 drifted`);
}

console.log('Locked text artifacts use canonical LF bytes and exact audited hashes.');
