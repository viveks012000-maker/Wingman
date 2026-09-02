'use strict';

const crypto = require('node:crypto');

// This is the exact Pages Web Analytics wrapper observed in production. The
// token is intentionally constrained to the documented beacon shape so that
// unrelated scripts or markup can never be normalized away.
const CLOUDFLARE_ANALYTICS_BLOCK = /<!-- Cloudflare Pages Analytics -->\s*<script\s+defer\s+src=(['"])https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\1\s+data-cf-beacon=(['"])\{\s*"token"\s*:\s*"[A-Za-z0-9_-]{16,128}"\s*\}\2\s*><\/script>\s*<!-- Cloudflare Pages Analytics -->/g;
const CLOUDFLARE_ANALYTICS_MARKER = /<!-- Cloudflare Pages Analytics -->|https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/;

function toBuffer(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function sha256(value) {
    return crypto.createHash('sha256').update(toBuffer(value)).digest('hex');
}

function normalizeCloudflareHtml(value) {
    const html = toBuffer(value).toString('utf8');
    let recognizedCount = 0;
    const normalized = html.replace(CLOUDFLARE_ANALYTICS_BLOCK, () => {
        recognizedCount += 1;
        return '';
    });
    const hasUnrecognizedMarker = CLOUDFLARE_ANALYTICS_MARKER.test(normalized);
    const classification = recognizedCount === 1 && !hasUnrecognizedMarker
        ? 'EXPECTED'
        : recognizedCount === 0 && !hasUnrecognizedMarker
            ? 'ABSENT'
            : 'UNEXPECTED';

    return {
        buffer: Buffer.from(normalized, 'utf8'),
        classification,
        recognizedCount,
        hasUnrecognizedMarker
    };
}

function compareAsset(name, expected, live) {
    const expectedBuffer = toBuffer(expected);
    const liveBuffer = toBuffer(live);
    const rawMatch = expectedBuffer.equals(liveBuffer);

    if (!name.endsWith('.html')) {
        return {
            name,
            expectedSha256: sha256(expectedBuffer),
            liveSha256: sha256(liveBuffer),
            rawMatch,
            sourceMatch: rawMatch,
            rawStatus: rawMatch ? 'PASS' : 'FAIL',
            cloudflareAnalytics: 'ABSENT'
        };
    }

    const expectedHtml = normalizeCloudflareHtml(expectedBuffer);
    const liveHtml = normalizeCloudflareHtml(liveBuffer);
    const sourceMatch = expectedHtml.classification !== 'UNEXPECTED'
        && liveHtml.classification !== 'UNEXPECTED'
        && expectedHtml.buffer.equals(liveHtml.buffer);

    return {
        name,
        expectedSha256: sha256(expectedBuffer),
        liveSha256: sha256(liveBuffer),
        normalizedExpectedSha256: sha256(expectedHtml.buffer),
        normalizedLiveSha256: sha256(liveHtml.buffer),
        rawMatch,
        sourceMatch,
        rawStatus: rawMatch
            ? 'PASS'
            : liveHtml.classification === 'EXPECTED'
                ? 'EXPECTED CLOUDFLARE TRANSFORMATION'
                : 'FAIL',
        cloudflareAnalytics: liveHtml.classification
    };
}

function classifyStaleAsset({ expectedSha, liveSourceCommit, assetResults, repeatedContentMatches }) {
    const allAssetsMatch = assetResults.every(result => result.sourceMatch);
    return liveSourceCommit === expectedSha && allAssetsMatch && repeatedContentMatches
        ? 'NOT FOUND'
        : 'FOUND';
}

module.exports = {
    classifyStaleAsset,
    compareAsset,
    normalizeCloudflareHtml,
    sha256
};
