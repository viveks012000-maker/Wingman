'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const SOURCE_LOGO = path.join(ROOT, 'logo.png');
const OPTIMIZED_LOGO = path.join(ROOT, 'logo-384.webp');
const EXPECTED_SOURCE_SHA256 = 'ea363415d7aaf1f5405ff9782757a567e0d73e630f6e3dd560c3a06de80e45fa';
const EXPECTED_OPTIMIZED_SHA256 = '14316f420346ec38bc2746820200c9ece64cbd7da32f285ce687940c11995e96';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildArtifact() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const script of [
    'scripts/build-netlify-dist.js',
    'scripts/postprocess-lazy-heic.js',
    'scripts/postprocess-deferred-media.js',
    'scripts/postprocess-vendor-allowlist.js',
    'scripts/postprocess-deferred-runtime.js',
    'scripts/postprocess-material-symbols-subset.js',
    'scripts/postprocess-logo-delivery.js'
  ]) {
    execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
  }
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readWebpInfo(file) {
  const buffer = fs.readFileSync(file);
  assert(buffer.length >= 20, 'optimized logo must contain a valid WebP container');
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'RIFF', 'optimized logo must use RIFF WebP');
  assert.strictEqual(buffer.toString('ascii', 8, 12), 'WEBP', 'optimized logo must identify as WebP');

  let width = null;
  let height = null;
  let hasAlpha = false;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) break;

    if (chunk === 'VP8X' && size >= 10) {
      hasAlpha ||= Boolean(buffer[data] & 0x10);
      width = readUInt24LE(buffer, data + 4) + 1;
      height = readUInt24LE(buffer, data + 7) + 1;
    } else if (chunk === 'ALPH') {
      hasAlpha = true;
    } else if (chunk === 'VP8L' && size >= 5 && buffer[data] === 0x2f && width === null) {
      const bits = buffer.readUInt32LE(data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasAlpha = true;
    } else if (chunk === 'VP8 ' && size >= 10 && width === null) {
      width = buffer.readUInt16LE(data + 6) & 0x3fff;
      height = buffer.readUInt16LE(data + 8) & 0x3fff;
    }

    offset = data + size + (size % 2);
  }

  assert(width && height, 'optimized logo dimensions must be discoverable from its WebP container');
  return { width, height, hasAlpha };
}

function directLogoTags(html) {
  return html.match(/<img\b[^>]*\ssrc=(["'])\/?logo-384\.webp\1[^>]*>/gi) || [];
}

try {
  assert(fs.existsSync(SOURCE_LOGO), 'original logo.png must remain in the repository');
  assert.strictEqual(fs.statSync(SOURCE_LOGO).size, 450642, 'original source logo byte size must remain unchanged');
  assert.strictEqual(sha256(SOURCE_LOGO), EXPECTED_SOURCE_SHA256, 'original source logo must not be overwritten or recompressed');

  assert(fs.existsSync(OPTIMIZED_LOGO), 'validated optimized logo asset must exist');
  const optimizedSize = fs.statSync(OPTIMIZED_LOGO).size;
  assert(optimizedSize < 40000, `optimized logo must remain below 40 KB; got ${optimizedSize} bytes`);
  assert(optimizedSize < fs.statSync(SOURCE_LOGO).size * 0.1, 'optimized logo must remain at least 90% smaller than the source');
  assert.strictEqual(sha256(OPTIMIZED_LOGO), EXPECTED_OPTIMIZED_SHA256, 'optimized logo bytes must match the visually validated candidate');

  const webp = readWebpInfo(OPTIMIZED_LOGO);
  assert.deepStrictEqual({ width: webp.width, height: webp.height }, { width: 384, height: 384 }, 'optimized logo must remain 384×384');
  assert.strictEqual(webp.hasAlpha, true, 'optimized logo must preserve transparency');

  const buildScript = fs.readFileSync(path.join(ROOT, 'scripts', 'build-netlify-dist.js'), 'utf8');
  assert(buildScript.includes("'logo-384.webp'"), 'optimized logo must be explicitly included in the strict public artifact allowlist');

  buildArtifact();

  const artifactOptimized = path.join(OUT, 'logo-384.webp');
  const artifactSource = path.join(OUT, 'logo.png');
  assert(fs.existsSync(artifactOptimized), 'strict production artifact must contain optimized logo');
  assert(fs.existsSync(artifactSource), 'strict production artifact must preserve original logo source');
  assert.strictEqual(sha256(artifactOptimized), EXPECTED_OPTIMIZED_SHA256, 'artifact optimized logo must exactly match validated repository asset');
  assert.strictEqual(sha256(artifactSource), EXPECTED_SOURCE_SHA256, 'artifact source logo must remain unchanged');

  const expectedDirect = {
    'index.html': 2,
    'app.html': 3,
    'terms.html': 1,
    'privacy.html': 1,
    'refund.html': 1,
    '404.html': 1
  };

  let totalDirect = 0;
  for (const [file, expected] of Object.entries(expectedDirect)) {
    const html = fs.readFileSync(path.join(OUT, file), 'utf8');
    assert(!/(\s)src=(["'])\/?logo\.png\2/.test(html), `${file} must not directly request oversized logo.png`);
    assert(!/this\.src=(["'])logo\.png\1/.test(html), `${file} must not retain the old logo.png fallback`);
    assert(!html.includes('logo.png'), `${file} must not contain any unexpected logo.png production reference`);

    const tags = directLogoTags(html);
    assert.strictEqual(tags.length, expected, `${file} must contain exactly ${expected} optimized direct logo request(s)`);
    for (const tag of tags) {
      assert(/\bwidth=(["'])384\1/i.test(tag), `${file} optimized logo must declare intrinsic width=384`);
      assert(/\bheight=(["'])384\1/i.test(tag), `${file} optimized logo must declare intrinsic height=384`);
    }
    totalDirect += tags.length;
  }
  assert.strictEqual(totalDirect, 9, 'production artifact must rewrite all nine direct logo requests');

  const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  assert(index.includes("this.src='logo-384.webp'") || index.includes('this.src="logo-384.webp"'), 'Maeve image fallback must use optimized logo');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  assert.strictEqual(release.files['logo-384.webp'], sha256(artifactOptimized), 'release manifest must hash optimized logo asset');
  for (const file of Object.keys(expectedDirect)) {
    assert.strictEqual(release.files[file], sha256(path.join(OUT, file)), `release manifest must hash final rewritten ${file}`);
  }

  console.log(`✅ Optimized logo delivery guard passed (${optimizedSize} bytes, ${webp.width}×${webp.height}, alpha preserved).`);
  console.log('✅ Production HTML no longer requests the 450,642-byte logo.png asset.');
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
