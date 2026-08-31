/**
 * =========================================================================================
 * WINGMAN SERVER-SIDE AUTHENTICATION & IDENTITY TRUST LAYER
 * =========================================================================================
 * MASTER ARCHITECTURAL DIRECTIVE — COMPLETE PER-USER DATA ISOLATION & RLS ENGINE
 * -----------------------------------------------------------------------------------------
 * MANDATORY LAW (ROOT CAUSE 1):
 *   NEVER trust req.body.userId, req.query.userId, x-user-id, x-user-email, or any
 *   client-supplied parameter for identity. ALL identity is derived SERVER-SIDE from a
 *   validated token:
 *     (1) The application's own JWT (signed with JWT_SECRET) — issued by
 *         /api/auth/register and /api/auth/login.
 *     (2) A Supabase access token — validated against the Supabase Auth REST API using only
 *         the server environment keys. The validated token's `user.id` is the ONLY accepted
 *         account identifier.
 * -----------------------------------------------------------------------------------------
 */

const jwt = require('jsonwebtoken');
const { JWT_SECRET, parseCookies } = require('./security');

// Server-only Supabase configuration (never exposed as identity source).
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://gstnghuhhrxtwjdafufd.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_oh5nDsBwEw56TLZFelxrvQ_A75_y-4j';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || null;

/**
 * Validate a Supabase access token server-side via the Supabase Auth REST endpoint.
 * GET {SUPABASE_URL}/auth/v1/user returns the authenticated user's record for a valid
 * token, or a 401 for an invalid/expired one. Returns { id, email, provider } or null.
 */
async function validateSupabaseToken(token) {
    if (!token) return null;
    try {
        const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: 'GET',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${token}`
            }
        });
        if (!resp.ok) return null;
        const user = await resp.json();
        if (!user || !user.id) return null;
        return { id: String(user.id), email: user.email || '', provider: 'supabase' };
    } catch (e) {
        return null;
    }
}

/**
 * Derive identity purely from a raw token string. Returns an identity object or null.
 * This is the single trusted identity resolution path. It never inspects request
 * body/query/header identity parameters.
 */
async function deriveIdentity(token) {
    if (!token) return null;

    // 1) Direct Supabase JWT verification via SUPABASE_JWT_SECRET if configured
    if (SUPABASE_JWT_SECRET) {
        try {
            const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);
            const id = decoded.sub || decoded.userId || decoded.id || null;
            if (id) {
                return { id: String(id), email: decoded.email || '', provider: 'supabase' };
            }
        } catch (e) {}
    }

    // 2) Local application JWT — cryptographically signed with our JWT_SECRET (DEV ONLY).
    const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
    if (!isProduction) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const id = decoded.userId || decoded.id || decoded.sub || null;
            if (id) {
                return { id: String(id), email: decoded.email || '', provider: 'app' };
            }
        } catch (e) {}
    }

    // 3) Supabase access token — validated against the Supabase Auth server.
    return validateSupabaseToken(token);
}

/**
 * Extract the raw token from the Authorization header or the HttpOnly session cookie.
 * Deliberately does NOT read x-user-id / x-user-email / body / query identity.
 */
function extractToken(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        const t = authHeader.slice(7).trim();
        if (t && t !== 'undefined' && t !== 'null') return t;
    }
    const customHeader = req.headers['x-supabase-auth'] || req.headers['x-access-token'] || '';
    if (customHeader) return customHeader;

    const cookies = parseCookies(req);
    if (cookies && cookies.wingman_session) {
        return cookies.wingman_session;
    }
    return null;
}

async function resolveRequestIdentity(req) {
    // 1. Try Authorization header if present
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken && bearerToken !== 'undefined' && bearerToken !== 'null') {
            const identity = await deriveIdentity(bearerToken);
            if (identity) return identity;
        }
    }

    // 2. Try custom auth headers
    const customHeader = req.headers['x-supabase-auth'] || req.headers['x-access-token'] || '';
    if (customHeader) {
        const identity = await deriveIdentity(customHeader);
        if (identity) return identity;
    }

    // 3. Try HttpOnly session cookie
    const cookies = parseCookies(req);
    if (cookies && cookies.wingman_session) {
        const identity = await deriveIdentity(cookies.wingman_session);
        if (identity) return identity;
    }

    return null;
}

/**
 * STRICT middleware: identity is REQUIRED. A missing or unverifiable token yields 401.
 * Only a server-validated token can establish req.user.
 */
async function requireAuth(req, res, next) {
    if (!req.user) {
        req.user = await resolveRequestIdentity(req);
    }
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized: a valid authentication token is required.' });
    }
    next();
}

/**
 * OPTIONAL middleware: sets req.user to the server-validated identity when a valid token
 * is present, otherwise req.user = null (guest/anon). NEVER fabricates identity from
 * client-supplied parameters.
 */
async function optionalAuth(req, res, next) {
    if (!req.user) {
        req.user = await resolveRequestIdentity(req);
    }
    next();
}

/**
 * Canonical server-side user key. Returns the validated account id or null.
 * Clients can never influence this value.
 */
function getAuthenticatedUid(req) {
    return req.user && req.user.id ? String(req.user.id) : null;
}

module.exports = {
    requireAuth,
    optionalAuth,
    verifySupabaseToken: optionalAuth,
    requireSupabaseAuth: requireAuth,
    deriveIdentity,
    extractToken,
    resolveRequestIdentity,
    getAuthenticatedUid
};
