/**
 * =========================================================================================
 * WINGMAN SUPABASE-TO-JWT SESSION BRIDGE MIDDLEWARE
 * =========================================================================================
 * Seamlessly bridges Supabase OAuth session tokens with the Express backend custom JWT layer.
 * When a request arrives with a valid Supabase access token (via Bearer header or Cookie),
 * this middleware verifies the token with Supabase Auth API, provisions/syncs the local user
 * profile in SQLite, and issues/refreshes the local application session JWT cookie.
 * =========================================================================================
 */

const jwt = require('jsonwebtoken');
const { deriveIdentity, extractToken } = require('./auth');
const { JWT_SECRET, setHttpOnlyCookie } = require('./security');

async function sessionBridge(req, res, next) {
    try {
        const token = extractToken(req);
        if (token) {
            const identity = await deriveIdentity(token);
            if (identity && identity.id) {
                req.user = identity;

                // Issue a local application JWT if using Supabase token
                if (identity.provider === 'supabase') {
                    const localJwt = jwt.sign(
                        { userId: identity.id, email: identity.email },
                        JWT_SECRET,
                        { expiresIn: '24h' }
                    );
                    setHttpOnlyCookie(res, 'wingman_session', localJwt, 86400);
                }
            }
        }
    } catch (err) {
        console.warn('[SessionBridge] Note:', err.message);
    }
    next();
}

module.exports = { sessionBridge };
