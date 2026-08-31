'use strict';

function isPrivateHostname(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.local') || host === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;

    const octets = host.split('.');
    if (octets.length !== 4 || octets.some(octet => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) return false;

    const [first, second] = octets.map(Number);
    return first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 169 && second === 254) ||
        first === 127;
}

function isPrivateDevelopmentOrigin(origin) {
    if (typeof origin !== 'string' || !origin) return false;

    let parsed;
    try {
        parsed = new URL(origin);
    } catch (_) {
        return false;
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
    return isPrivateHostname(parsed.hostname);
}

module.exports = { isPrivateDevelopmentOrigin };
