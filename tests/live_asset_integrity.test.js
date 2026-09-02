'use strict';

const assert = require('node:assert/strict');
const {
    compareAsset,
    classifyStaleAsset,
    normalizeCloudflareHtml,
    normalizeCloudflareRobots
} = require('./live_asset_integrity');

const analytics = `<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "0123456789abcdef0123456789abcdef"}'></script><!-- Cloudflare Pages Analytics -->`;
const expectedHtml = '<!doctype html>\n<html><body><main>Wingman</main></body></html>';

const staticMatch = compareAsset('app.js', Buffer.from('same'), Buffer.from('same'));
assert.equal(staticMatch.sourceMatch, true);
assert.equal(compareAsset('app.js', Buffer.from('expected'), Buffer.from('different')).sourceMatch, false);

const transformedHtml = compareAsset('index.html', Buffer.from(expectedHtml), Buffer.from(expectedHtml + analytics));
assert.equal(transformedHtml.sourceMatch, true, 'recognized Cloudflare Analytics injection must preserve source match');
assert.equal(transformedHtml.rawStatus, 'EXPECTED CLOUDFLARE TRANSFORMATION');
assert.equal(transformedHtml.cloudflareAnalytics, 'EXPECTED');

const expectedRobots = 'User-agent: *\nAllow: /\n';
const managedRobots = `# As a condition of accessing this website, you agree to abide by the following\n# BEGIN Cloudflare Managed content\nUser-agent: *\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: /\n# END Cloudflare Managed Content\n\n${expectedRobots}`;
const transformedRobots = compareAsset('robots.txt', Buffer.from(expectedRobots), Buffer.from(managedRobots));
assert.equal(transformedRobots.sourceMatch, true, 'recognized Cloudflare managed robots block must preserve source match');
assert.equal(transformedRobots.rawStatus, 'EXPECTED CLOUDFLARE TRANSFORMATION');
assert.equal(transformedRobots.cloudflareAnalytics, 'EXPECTED');
assert.equal(normalizeCloudflareRobots(managedRobots).recognizedCount, 1);

const unrelatedScript = compareAsset(
    'index.html',
    Buffer.from(expectedHtml),
    Buffer.from(expectedHtml + '<script src="https://example.invalid/unrelated.js"></script>')
);
assert.equal(unrelatedScript.sourceMatch, false, 'unrelated HTML must fail normalization');

const mutatedAnalytics = compareAsset(
    'index.html',
    Buffer.from(expectedHtml),
    Buffer.from(expectedHtml + analytics.replace('beacon.min.js', 'other.js'))
);
assert.equal(mutatedAnalytics.sourceMatch, false, 'mutated analytics markup must not be normalized');
assert.equal(mutatedAnalytics.cloudflareAnalytics, 'UNEXPECTED');

const duplicateAnalytics = normalizeCloudflareHtml(expectedHtml + analytics + analytics);
assert.equal(duplicateAnalytics.classification, 'UNEXPECTED', 'duplicate edge snippets must fail closed');
const duplicateManagedRobots = normalizeCloudflareRobots(managedRobots + managedRobots);
assert.equal(duplicateManagedRobots.classification, 'UNEXPECTED', 'duplicate managed robots blocks must fail closed');

assert.equal(
    classifyStaleAsset({
        expectedSha: 'a'.repeat(40),
        liveSourceCommit: 'a'.repeat(40),
        assetResults: [{ sourceMatch: true }],
        repeatedContentMatches: true,
        previewSourceCommit: 'b'.repeat(40)
    }),
    'NOT FOUND',
    'an old immutable preview must not contaminate current production classification'
);
assert.equal(
    classifyStaleAsset({
        expectedSha: 'a'.repeat(40),
        liveSourceCommit: 'b'.repeat(40),
        assetResults: [{ sourceMatch: true }],
        repeatedContentMatches: true
    }),
    'FOUND'
);
assert.equal(
    classifyStaleAsset({
        expectedSha: 'a'.repeat(40),
        liveSourceCommit: 'a'.repeat(40),
        assetResults: [{ sourceMatch: false }],
        repeatedContentMatches: true
    }),
    'FOUND'
);

console.log('✔ Live asset integrity regression guard passed: narrow Cloudflare normalization, source drift, SHA drift, preview separation, and stale detection are covered.');
