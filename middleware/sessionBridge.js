// Retired compatibility entry point. Authentication is performed once by supabaseAuth.js;
// this module intentionally cannot mint a second local session or accept legacy credentials.
function sessionBridge(req, res, next) { next(); }

module.exports = { sessionBridge };
