'use strict';

// Compatibility entry point for older local imports only. Authentication is canonicalized in
// supabaseAuth.js. This module deliberately has no JWT, cookie, custom-header, or local-session
// fallback; production is detected by NODE_ENV=production or RAILWAY_ENVIRONMENT there.
const { requireSupabaseAuth, verifySupabaseToken } = require('./supabaseAuth');

function getAuthenticatedUid(req) {
    return req && req.user && req.user.id ? String(req.user.id) : null;
}

function requireAuth(req, res, next) {
    return requireSupabaseAuth(req, res, next);
}

function optionalAuth(req, res, next) {
    return verifySupabaseToken(req, res, next);
}

module.exports = {
    requireAuth,
    optionalAuth,
    verifySupabaseToken,
    requireSupabaseAuth,
    // Explicit fail-closed shims for retired imports.
    deriveIdentity: async () => null,
    extractToken: () => null,
    resolveRequestIdentity: async () => null,
    getAuthenticatedUid
};
