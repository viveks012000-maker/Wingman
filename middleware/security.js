const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.rateLimit || rateLimitModule;
const { ipKeyGenerator } = rateLimitModule;
const net = require('net');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// VULN-04 FIX: Generate cryptographically strong JWT secret if not provided via .env
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

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

// Middleware: Verify JWT Bearer Token or HttpOnly Session Cookie
function authenticateToken(req, res, next) {
    const cookies = parseCookies(req);
    const authHeader = req.headers['authorization'];
    const token = (cookies && cookies.wingman_session) || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access denied. Authentication token missing.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid or expired authentication token.' });
        }
        req.user = user;
        next();
    });
}

// Optional Auth Middleware (attaches req.user if valid token provided)
function optionalAuthenticateToken(req, res, next) {
    const cookies = parseCookies(req);
    const authHeader = req.headers['authorization'];
    const token = (cookies && cookies.wingman_session) || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err && user) {
            req.user = user;
        }
        next();
    });
}

// Middleware: IDOR Ownership Checker (verifies req.user.id === requested resource owner)
function verifyOwnership(req, res, next) {
    const resourceUserId = req.params.userId || req.params.id || req.body.userId;
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized user context.' });
    }

    if (resourceUserId && String(req.user.id) !== String(resourceUserId)) {
        return res.status(403).json({ success: false, error: 'Access forbidden: You do not own this resource (IDOR Protection).' });
    }
    next();
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

// Helper: Sanitize string inputs recursively
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/onerror=/gi, '')
        .replace(/onload=/gi, '');
}

function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object' || obj === null) return;
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string') {
            obj[key] = sanitizeString(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
        }
    }
}

// Global Input Sanitizer: Strip dangerous HTML/script patterns from all string fields in request body
function sanitizeRequestBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        sanitizeObject(req.body);
    }
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
    authenticateToken,
    optionalAuthenticateToken,
    verifyOwnership,
    sanitizeUserResponse,
    blockSensitiveFiles,
    sanitizeRequestBody,
    parseCookies,
    setHttpOnlyCookie,
    clearHttpOnlyCookie,
    generateCsrfToken,
    validateCsrfToken,
    JWT_SECRET
};
