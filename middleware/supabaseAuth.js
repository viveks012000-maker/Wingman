const { createClient } = require('@supabase/supabase-js');

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://gstnghuhhrxtwjdafufd.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_oh5nDsBwEw56TLZFelxrvQ_A75_y-4j';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (isProduction && !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ CRITICAL SECURITY FATAL: SUPABASE_SERVICE_ROLE_KEY must be provided in production.');
}

// Server Admin Client: Requires actual service role key in production; does NOT silently degrade to anon key
const supabaseAdmin = (SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : (isProduction ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }));

/**
 * Middleware: Verifies the Bearer token using supabaseAdmin.auth.getUser(token) or REST verification.
 * Attaches req.user = { id, email } if valid, otherwise req.user = null.
 */
async function verifySupabaseToken(req, res, next) {
    function applyMockAuthIfDev() {
        if (!isProduction && (process.env.ENABLE_MOCK_AUTH === 'true' || req.headers['x-mock-auth'] === 'true')) {
            req.user = { id: '00000000-0000-0000-0000-000000000001', email: 'dev@local' };
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
    const token = authHeader.split(' ')[1];
    if (!token || token === 'undefined' || token === 'null') {
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

module.exports = { supabaseAdmin, verifySupabaseToken, requireSupabaseAuth, isProduction };
