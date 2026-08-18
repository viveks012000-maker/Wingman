const { createClient } = require('@supabase/supabase-js');
const { installAnalyzerTransportRetry } = require('./analyzerTransportRetry');
const { installCreditSettlementTransportRetry } = require('./creditSettlementTransportRetry');

// Install the Analyzer provider retry before other clients. It only matches the exact
// Screenshot Analyzer vision endpoint + model; all other fetches pass through untouched.
installAnalyzerTransportRetry();

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://gstnghuhhrxtwjdafufd.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_oh5nDsBwEw56TLZFelxrvQ_A75_y-4j';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Credit settlement is safe to retry only because migration 008 makes settle_credits
// idempotent. The wrapper is exact-URL scoped and leaves every other Supabase call untouched.
installCreditSettlementTransportRetry(SUPABASE_URL);

if (isProduction && !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ CRITICAL SECURITY FATAL: SUPABASE_SERVICE_ROLE_KEY must be provided in production.');
}

// Server Admin Client: Requires actual service role key; does NOT silently degrade to anon key
const supabaseAdmin = (SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY.trim().length > 0)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.trim(), {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : null;

// Supabase Auth access tokens are JWTs, whose wire format is exactly three non-empty
// dot-separated segments: <header>.<payload>.<signature>. This is only a cheap syntax gate;
// it never decodes or trusts claims. Structurally valid tokens still go through Supabase's
// authoritative verification below. Rejecting impossible JWTs locally avoids duplicate
// remote /user verification work and noisy bad_jwt logs for obvious junk bearer values.
function isStructurallyValidJwt(token) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const parts = token.split('.');
    return parts.length === 3 && parts.every(part => part.length > 0);
}

/**
 * Middleware: Verifies the Bearer token using supabaseAdmin.auth.getUser(token) or REST verification.
 * Attaches req.user = { id, email } if valid, otherwise req.user = null.
 */
async function verifySupabaseToken(req, res, next) {
    // The Railway API gateway pre-authenticates the two large Analyzer routes before their
    // 38 MB body parser. Reuse that server-created identity instead of performing a second
    // Supabase /user verification inside the mounted Wingman app. HTTP clients cannot set
    // req.user directly; it exists here only when prior trusted middleware attached it.
    if (req.user && req.user.id) {
        return next();
    }

    function applyMockAuthIfDev() {
        if (!isProduction && (process.env.ENABLE_MOCK_AUTH === 'true' || req.headers['x-mock-auth'] === 'true')) {
            const devUid = req.headers['x-test-user-id'] || '00000000-0000-0000-0000-000000000001';
            req.user = { id: devUid, email: req.headers['x-test-user-email'] || 'dev@local' };
            return true;
        }
        return false;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (!applyMockAuthIfDev()) {
            req.user = null;
        }
        return next();
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || token === 'undefined' || token === 'null' || !isStructurallyValidJwt(token)) {
        if (!applyMockAuthIfDev()) {
            req.user = null;
        }
        return next();
    }

    try {
        if (supabaseAdmin && supabaseAdmin.auth) {
            const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
            if (!error && user && user.id) {
                req.user = { id: String(user.id), email: user.email || '' };
                return next();
            }
        }

        // Standard Supabase REST user token validation fallback
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: SUPABASE_ANON_KEY
            }
        });
        if (response.ok) {
            const restUser = await response.json();
            if (restUser && restUser.id) {
                req.user = { id: String(restUser.id), email: restUser.email || '' };
                return next();
            }
        }

        if (!applyMockAuthIfDev()) {
            req.user = null;
        }
        return next();
    } catch (err) {
        if (!applyMockAuthIfDev()) {
            req.user = null;
        }
        next();
    }
}

/**
 * Middleware: Requires a valid Supabase user (req.user exists with a valid id).
 */
function requireSupabaseAuth(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized: valid Supabase authentication token required.' });
    }
    next();
}

module.exports = {
    supabaseAdmin,
    verifySupabaseToken,
    requireSupabaseAuth,
    isProduction,
    isStructurallyValidJwt
};
