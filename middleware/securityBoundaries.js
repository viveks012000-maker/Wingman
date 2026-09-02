'use strict';

const DEFAULT_SUPABASE_HOST = 'gstnghuhhrxtwjdafufd.supabase.co';
const AICREDITS_HOST = 'api.aicredits.in';

function isPrivateDevelopmentHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    const octets = host.split('.');
    if (octets.length !== 4 || octets.some(octet => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) return false;
    const [first, second] = octets.map(Number);
    return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) || (first === 169 && second === 254);
}

function parseConfiguredOrigin(name, rawValue, options = {}) {
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
        throw new Error(`${name} must be configured.`);
    }

    let parsed;
    try {
        parsed = new URL(rawValue.trim());
    } catch (_) {
        throw new Error(`${name} must be an absolute URL.`);
    }

    const production = options.production === true;
    const allowedHost = options.allowedHost || null;
    const allowedPath = options.allowedPath || null;
    const authority = rawValue.trim().match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] || '';
    const hostMatches = allowedHost
        ? parsed.hostname.toLowerCase() === allowedHost.toLowerCase()
        : false;
    const supabaseHostMatches = options.supabase === true &&
        (production
            ? parsed.hostname.toLowerCase() === DEFAULT_SUPABASE_HOST
            : (parsed.hostname.toLowerCase() === DEFAULT_SUPABASE_HOST || parsed.hostname.toLowerCase().endsWith('.supabase.co')));
    const privateDev = !production && isPrivateDevelopmentHost(parsed.hostname);
    const authorityWithoutCredentials = authority.replace(/^.*@/, '');
    // WHATWG URL normalizes an explicit default port (for example :443) to an empty
    // parsed.port. Inspect the authority as well so production cannot smuggle a port
    // through that normalization; local development may use its ordinary test port.
    const explicitPort = parsed.port !== '' || /:\d+$/.test(authorityWithoutCredentials);

    if (parsed.protocol !== 'https:' && !(privateDev && parsed.protocol === 'http:')) {
        throw new Error(`${name} must use HTTPS outside narrowly-scoped local development.`);
    }
    if (parsed.username || parsed.password || (explicitPort && !privateDev) || parsed.hash || parsed.search) {
        throw new Error(`${name} must not contain credentials, a port, query, or fragment.`);
    }
    if (!hostMatches && !supabaseHostMatches && !privateDev) {
        throw new Error(`${name} points to an unapproved host.`);
    }
    if (allowedPath && parsed.pathname.replace(/\/+$/, '') !== allowedPath) {
        throw new Error(`${name} must use the ${allowedPath} path.`);
    }
    return parsed;
}

function configuredOrigin(name, rawValue, options = {}) {
    const parsed = parseConfiguredOrigin(name, rawValue, options);
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
}

function appendConfiguredPath(baseOrigin, relativePath) {
    const base = new URL(baseOrigin);
    const basePath = base.pathname.replace(/\/+$/, '');
    const suffix = String(relativePath || '').replace(/^\/+/, '');
    base.pathname = `${basePath}/${suffix}`;
    base.search = '';
    base.hash = '';
    return base.toString();
}

function safeLogValue(value, maxLength = 160) {
    const text = value === null || value === undefined ? '' : String(value);
    if (/\r|\n|[\u0000-\u001f\u007f]/.test(text)) return '[invalid-log-value]';
    return text.slice(0, maxLength);
}

module.exports = {
    DEFAULT_SUPABASE_HOST,
    AICREDITS_HOST,
    isPrivateDevelopmentHost,
    parseConfiguredOrigin,
    configuredOrigin,
    appendConfiguredPath,
    safeLogValue
};
