const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://gstnghuhhrxtwjdafufd.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_oh5nDsBwEw56TLZFelxrvQ_A75_y-4j';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

/**
 * Middleware: Verifies the Bearer token using supabaseAdmin.auth.getUser(token).
 * Attaches req.user = { id, email } if valid, otherwise req.user = null.
 */
async function verifySupabaseToken(req, res, next) {
    function applyMockAuthIfDev() {
        if (process.env.NODE_ENV === 'development' && (req.headers['x-mock-auth'] === 'true' || process.env.ENABLE_MOCK_AUTH === 'true')) {
            req.user = { id: 'dev_user_123', email: 'dev@local' };
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
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user) {
            // Fallback check to Supabase REST endpoint
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    apikey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
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
        }

        req.user = { id: String(user.id), email: user.email || '' };
        next();
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
        return res.status(401).json({ success: false, error: 'Unauthorized: valid Supabase token required.' });
    }
    next();
}

module.exports = { supabaseAdmin, verifySupabaseToken, requireSupabaseAuth };
