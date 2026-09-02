const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.rateLimit || rateLimitModule;
const { ipKeyGenerator } = rateLimitModule;
const net = require('net');
const crypto = require('crypto');

// Railway's edge provides X-Real-IP as the client address. Trust that header only when the
// process is actually running inside Railway, validate it as a literal IP, and otherwise fall
// back to Express/socket identity. Never trust arbitrary X-Forwarded-For chains here.
function getRateLimitClientIp(req) {
    const request = req || {};
    const fallback = (
        (typeof request.ip === 'string' && request.ip.trim()) ||
        (request.socket && typeof request.socket.remoteAddress === 'string' && request.socket.remoteAddress.trim()) ||
        '127.0.0.1'
    );

    if (!process.env.RAILWAY_ENVIRONMENT) return fallback;

    const rawRealIp = request.headers && request.headers['x-real-ip'];
    const candidate = Array.isArray(rawRealIp) ? rawRealIp[0] : rawRealIp;
    if (typeof candidate === 'string') {
        const normalized = candidate.trim();
        if (net.isIP(normalized)) return normalized;
    }
    return fallback;
}

function getRateLimitIpKey(req) {
    const ip = getRateLimitClientIp(req);
    return typeof ipKeyGenerator === 'function' ? ipKeyGenerator(ip, 56) : ip;
}

function getApiRateLimitKey(req) {
    if (req && req.user && (req.user.id || req.user.sub)) {
        return String(req.user.id || req.user.sub);
    }
    return getRateLimitIpKey(req);
}

// 0. Railway Analyzer Admission Limiter: runs BEFORE expensive auth/body parsing on only the
// large screenshot routes. It intentionally emits no rate-limit headers because the canonical
// global/API limiters inside the Wingman application still own response rate-limit metadata.
const analyzerAdmissionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    keyGenerator: getRateLimitIpKey,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, error: 'Too many requests from this IP. Please try again after 15 minutes.' },
    standardHeaders: false,
    legacyHeaders: false
});

// 1. Global Rate Limiter: Max 1000 requests per 15 minutes per IP (Skips static HTML & local testing)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    keyGenerator: getRateLimitIpKey,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, error: 'Too many requests from this IP. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const isStaticAsset = !req.path.startsWith('/api/');
        const clientIp = getRateLimitClientIp(req);
        const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
        return isStaticAsset || (process.env.NODE_ENV !== 'production' && isLocalhost);
    }
});

// 2. Auth Endpoints Rate Limiter: Max 10 requests / minute per IP
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: getRateLimitIpKey,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, error: 'Too many authentication attempts. Please try again after 1 minute.' },
    standardHeaders: true,
    legacyHeaders: false
});

// 3. Core AI Endpoints Rate Limiter: Max 30 requests / minute per User ID / IP (User-aware)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: getApiRateLimitKey,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, error: "You're sending requests too quickly. Please wait a moment and try again." },
    standardHeaders: true,
    legacyHeaders: false
});

// Helper: Parse cookies safely from request headers
function parseCookies(req) {
    const list = {};
    const cookieHeader = req.headers && req.headers.cookie;
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name ? name.trim() : '';
        if (!name) return;
        const value = rest.join('=').trim();
        if (!value) return;
        list[name] = decodeURIComponent(value);
    });
    return list;
}

// Helper: Set HttpOnly, Secure, SameSite=Lax session cookie
function setHttpOnlyCookie(res, name, value, maxAgeSeconds = 86400) {
    const isProd = process.env.NODE_ENV === 'production';
    let cookieStr = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
    if (isProd) {
        cookieStr += '; Secure';
    }
    res.setHeader('Set-Cookie', cookieStr);
}

// Helper: Clear HttpOnly session cookie
function clearHttpOnlyCookie(res, name) {
    const isProd = process.env.NODE_ENV === 'production';
    let cookieStr = `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
    if (isProd) {
        cookieStr += '; Secure';
    }
    res.setHeader('Set-Cookie', cookieStr);
}

// Response Sanitizer Helper
function sanitizeUserResponse(userObject) {
    if (!userObject) return null;
    const { password, passwordHash, hash, internal_id, __v, ...safeUser } = userObject;
    return safeUser;
}

// VULN-09 FIX: Middleware to block access to sensitive files and directories BEFORE express.static
const BLOCKED_PATHS = [
    /^\/\.env/i,
    /^\/\.git/i,
    /^\/server\.js$/i,
    /^\/database\.js$/i,
    /^\/_fix_.*\.js$/i,
    /^\/middleware\//i,
    /^\/config\//i,
    /^\/utilities\//i,
    /^\/data\//i,
    /^\/migrations\//i,
    /^\/scripts\//i,
    /^\/node_modules\//i,
    /^\/package\.json$/i,
    /^\/package-lock\.json$/i,
    /^\/netlify\.toml$/i,
    /^\/PROMPT_SYSTEM_MEMORY\.json$/i,
    /^\/\.agents\//i,
    /^\/tests\//i,
    /^\/scratch\//i,
    /^\/.*\.sqlite$/i,
    /^\/.*\.db$/i,
    /^\/.*\.sql$/i,
    /^\/.*\.ps1$/i,
    /^\/.*\.bat$/i,
    /^\/.*\.vbs$/i,
    /^\/.*\.md$/i
];

function blockSensitiveFiles(req, res, next) {
    const requestedPath = decodeURIComponent(req.path);
    for (const pattern of BLOCKED_PATHS) {
        if (pattern.test(requestedPath)) {
            return res.status(403).json({ success: false, error: 'Access denied.' });
        }
    }
    next();
}

// Request bodies contain user text, prompts, and structured feature data. They are data, not
// HTML. A global regex "sanitizer" both corrupts legitimate prompts and cannot be correct for
// every output context. Each renderer uses textContent/validated URL sinks; this middleware
// intentionally leaves the parsed request unchanged.
function sanitizeRequestBody(req, res, next) {
    next();
}

// CSRF Protection Helpers
function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

function validateCsrfToken(req, res, next) {
    // Read-only requests are safe from CSRF state changes
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Bearer token requests are API calls with custom headers, immune to ambient cookie CSRF
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return next();
    }

    const cookies = parseCookies(req);
    const csrfCookie = cookies['wingman_csrf'];
    const csrfHeader = req.headers['x-csrf-token'];

    // For cookie-based state-changing requests, require both cookie and matching header
    if (cookies['wingman_session']) {
        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
            return res.status(403).json({ success: false, error: 'CSRF token validation failed.' });
        }
    } else if (csrfCookie || csrfHeader) {
        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
            return res.status(403).json({ success: false, error: 'CSRF token validation failed.' });
        }
    }

    next();
}

module.exports = {
    globalLimiter,
    analyzerAdmissionLimiter,
    authLimiter,
    apiLimiter,
    getRateLimitClientIp,
    getRateLimitIpKey,
    getApiRateLimitKey,
    sanitizeUserResponse,
    blockSensitiveFiles,
    sanitizeRequestBody,
    parseCookies,
    setHttpOnlyCookie,
    clearHttpOnlyCookie,
    generateCsrfToken,
    validateCsrfToken
};
