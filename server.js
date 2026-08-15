// server.js
require('dotenv').config();

const { supabaseAdmin, verifySupabaseToken, requireSupabaseAuth, isProduction } = require('./middleware/supabaseAuth');

// Startup Environment Variables Validation
const requiredEnvVars = ['AICREDITS_API_KEY', 'AICREDITS_API_KEY_VISION', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = requiredEnvVars.filter(key => !process.env[key]);
if (missingEnv.length > 0 && isProduction) {
    console.error(`❌ CRITICAL SECURITY FATAL: Missing required production environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
} else if (missingEnv.length > 0) {
    console.warn(`[SECURITY WARN] Missing environment variables: ${missingEnv.join(', ')}. Using secure default fallbacks for local development.`);
}

/**
 * =========================================================================================
 * WINGMAN MASTER BACKEND ARCHITECTURE DIRECTIVES (DO NOT REGRESS OR OVERWRITE)
 * =========================================================================================
 * 1. SCREENSHOT ANALYZER (/api/analyze): 10 Reply Cards | Vision: qwen3.5-flash-02-23 (max: 120) | Text: qwen3-235b-a22b-2507 (max: 450)
 * 2. ICEBREAKER GENERATOR (/api/icebreaker): 10 Openers | Text: qwen3-235b-a22b-2507
 * 3. PROFILE BIO OPTIMIZER (/api/optimize): 10 Multiline Bios (\n line breaks) | Text: qwen3-235b-a22b-2507
 * 4. MAEVE PRACTICE PARTNER & COACH CHAT (/api/chat): 1 Turn Persona Chat | Avatar: maeve.jpg | Text: qwen3-235b-a22b-2507
 * =========================================================================================
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const CREDITS_PER_INR = 10;
const helmet = require('helmet');
let db = null; // Global SQLite database instance (disabled in production, optional dev cache)

const { TARGET_MARKET_LOCK, BIO_MODE_PROMPTS, MAEVE_SYSTEM_PROMPT } = require('./config/promptSystem');

const {
    globalLimiter,
    authLimiter,
    apiLimiter,
    verifyOwnership,
    sanitizeUserResponse,
    blockSensitiveFiles,
    sanitizeRequestBody,
    generateCsrfToken,
    validateCsrfToken,
    setHttpOnlyCookie
} = require('./middleware/security');

// =========================================================================================
// SERVER-SIDE IDENTITY TRUST LAYER & RLS ENGINE (MASTER ARCHITECTURAL DIRECTIVE)
// Identity is derived ONLY from server-validated tokens. Client-supplied identity parameters
// (x-user-id, x-user-email, body/query userId) are NEVER trusted for account resolution.
// =========================================================================================
const { createUserProvisioningMiddleware } = require('./middleware/userProvisioning');
const autoProvisionUser = createUserProvisioningMiddleware(() => db);
const { validateImagePayload } = require('./middleware/imageValidator');
const { forRequest } = require('./middleware/rls');


const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = isProduction;

// 1. Security Headers Middleware (Helmet + Explicit Production Headers)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'", "https://*.supabase.co", "http://localhost:*", "ws://localhost:*"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://*.supabase.co"],
            scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://*.supabase.co"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co", "http://localhost:*", "ws://localhost:*", "https://aicredits.in"],
            workerSrc: ["'self'", "blob:"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.removeHeader('X-Powered-By');
    next();
});

// 2. Configure Locked CORS Policy
const productionAllowedOrigins = [
    'https://mywingman.com',
    'https://chimerical-granita-c68c5a.netlify.app'
];
const developmentAllowedOrigins = [
    'http://localhost:3000',
    'http://localhost:10000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:10000'
];
const defaultAllowedOrigins = IS_PROD
    ? productionAllowedOrigins
    : [...productionAllowedOrigins, ...developmentAllowedOrigins];

const rawConfiguredAllowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)
    : [];

// Production must use explicit HTTPS origins. Ignore wildcard/null/localhost values even if
// an old environment variable still contains them; this prevents stale deployment settings
// from silently reopening browser access to arbitrary preview or local origins.
const configuredAllowedOrigins = rawConfiguredAllowedOrigins.filter(origin => {
    if (!IS_PROD) return true;
    if (origin === '*' || origin === 'null' || origin.includes('*')) return false;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return false;
    return /^https:\/\//i.test(origin);
});
const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins]));

function isOriginAllowed(origin, allowedList) {
    // Requests without an Origin header (health checks, server-to-server clients) are not
    // browser CORS requests and remain allowed. Opaque browser origins are denied in prod.
    if (!origin) return true;
    if (origin === 'null') return !IS_PROD;
    if (allowedList.includes(origin)) return true;

    // Development may use arbitrary localhost ports for local tooling, but production may not.
    if (!IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
    return false;
}

app.use(cors({
    origin: function (origin, callback) {
        if (!IS_PROD && (origin === 'null' || origin === 'file://')) {
            return callback(null, true);
        }
        if (isOriginAllowed(origin, allowedOrigins)) {
            return callback(null, true);
        }
        console.warn(`[SECURITY WARN] Blocked request from unauthorized origin: ${origin}`);
        // CORS is a browser response policy, not an authentication boundary. Returning false
        // omits ACAO without turning a blocked preflight into an internal-server-error response.
        return callback(null, false);
    },
    credentials: true
}));

// 3. Global Rate Limiter (API Scoped) & Scoped Express Payload Limits
app.use('/api/', globalLimiter);
app.use('/api/analyze', express.json({ limit: '38mb' }));
app.use('/api/analyze-chat-screenshot', express.json({ limit: '38mb' }));
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
        return res.status(400).json({
            success: false,
            error: "These images are too large. Maximum total upload size: 25 MB."
        });
    }
    next(err);
});
app.use('/api/', verifySupabaseToken);
app.use('/api/', autoProvisionUser);
app.use(validateImagePayload);

// 4. Block access to sensitive files, sanitize request bodies & enforce CSRF
app.use(blockSensitiveFiles);
app.use(sanitizeRequestBody);
app.use('/api/', validateCsrfToken);

// Endpoint: Generate & Retrieve CSRF Token
app.get('/api/csrf-token', (req, res) => {
    const { parseCookies } = require('./middleware/security');
    const cookies = parseCookies(req);
    let csrfToken = cookies['wingman_csrf'];
    if (!csrfToken) {
        csrfToken = generateCsrfToken();
        setHttpOnlyCookie(res, 'wingman_csrf', csrfToken);
    }
    res.json({ success: true, csrfToken: csrfToken });
});

app.use(express.static(path.join(__dirname), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
        const relPath = path.relative(__dirname, filePath).replace(/\\/g, '/');
        if (
            relPath.startsWith('.env') ||
            relPath.endsWith('.sqlite') ||
            relPath.endsWith('.db') ||
            relPath.endsWith('.ps1') ||
            relPath.endsWith('.vbs') ||
            relPath.endsWith('.bat') ||
            relPath === 'server.js' ||
            relPath === 'database.js' ||
            relPath.startsWith('middleware/') ||
            relPath.startsWith('config/') ||
            relPath.startsWith('utilities/') ||
            relPath.startsWith('data/')
        ) {
            res.status(403).send('Forbidden');
        }
    }
}));

// Explicit Root Routes for Landing & App Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

// =========================================================================================
// SERVER-SIDE IDENTITY TRUST LAYER & PERSISTENT SQLITE CREDIT LEDGER
// =========================================================================================
// MANDATORY LAW: The authenticated account id comes EXCLUSIVELY from the server-validated
// token (req.user.id). Client-supplied parameters — x-user-id, x-user-email, req.body.userId,
// req.query.userId, req.body.userEmail — are IGNORED for identity so that cross-account
// impersonation is impossible. Unauthenticated callers resolve to null (guest), never to an
// arbitrary or spoofable account id. All credits are stored strictly in SQLite (user_profiles).
function getUserIdFromReq(req) {
    return req.user ? req.user.id : null;
}

// Auto-provision a local profile (and FK-safe auth stub for Supabase users) under the exact
// server-validated account id, so credits and history persist per real account. Returns the
// canonical user id that was provisioned.
async function ensureUserProfile(uid, email) {
    if (!db || !uid || uid === 'guest_user' || uid === null) return uid;

    try {
        let profileRow = await db.get('SELECT user_id FROM user_profiles WHERE user_id = ?', [uid]);
        if (profileRow) return uid;

        let authRow = await db.get('SELECT id FROM users_auth WHERE id = ?', [uid]);

        if (!authRow) {
            const targetEmail = (email && email.includes('@')) ? email : `${uid}@user.local`;
            const existingEmailRow = await db.get('SELECT id FROM users_auth WHERE email = ?', [targetEmail]);
            if (existingEmailRow) {
                try {
                    await db.run('UPDATE users_auth SET id = ? WHERE email = ?', [uid, targetEmail]);
                } catch (updateErr) {
                    const fallbackEmail = `${uid}@user.local`;
                    await db.run(
                        'INSERT OR IGNORE INTO users_auth (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)',
                        [uid, fallbackEmail, 'supabase_auth', 1, new Date().toISOString()]
                    );
                }
            } else {
                try {
                    await db.run(
                        'INSERT INTO users_auth (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)',
                        [uid, targetEmail, 'supabase_auth', 1, new Date().toISOString()]
                    );
                } catch (authInsertErr) {
                    const fallbackEmail = `${uid}@user.local`;
                    await db.run(
                        'INSERT OR IGNORE INTO users_auth (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)',
                        [uid, fallbackEmail, 'supabase_auth', 1, new Date().toISOString()]
                    );
                }
            }
        }

        await db.run(
            'INSERT OR IGNORE INTO user_profiles (user_id, display_name, credits_balance, tier) VALUES (?, ?, ?, ?)',
            [uid, (email && email.includes('@')) ? email.split('@')[0] : 'MyWingman User', 5.00, 'free']
        );
        return uid;
    } catch (err) {
        console.error(`[ensureUserProfile ERROR] Profile provisioning failed for ${uid}:`, err.message);
        return uid;
    }
}

// Canonical Initial Free Credits for all newly provisioned accounts
const INITIAL_FREE_CREDITS = 50;

// Read credits from Supabase Postgres 'profiles' table (Authoritative Source of Truth)
async function getUserCreditsDB(req) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user') {
        const err = new Error("Authentication required to access credits.");
        err.statusCode = 401;
        throw err;
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('credits')
            .eq('id', uid)
            .maybeSingle();

        if (error) {
            console.error(`[getUserCreditsDB Error] Failed to fetch profile for ${uid}:`, error.message);
            const err = new Error("Failed to fetch user profile credits.");
            err.statusCode = 503;
            throw err;
        }

        if (data && typeof data.credits === 'number') {
            // Return existing stored credit balance without modifying it
            return Number(data.credits) / CREDITS_PER_INR;
        }

        // Profile does NOT exist in Supabase: Explicit PROFILE_MISSING condition (Do NOT auto-grant 50 credits)
        const missingErr = new Error("PROFILE_MISSING");
        missingErr.statusCode = 404;
        missingErr.code = "PROFILE_MISSING";
        throw missingErr;
    } catch (e) {
        if (e.statusCode) throw e;
        console.warn(`[getUserCreditsDB Notice] Supabase query notice for ${uid}:`, e.message);
        const err = new Error("Failed to fetch user profile credits.");
        err.statusCode = 503;
        throw err;
    }
}

async function withTransactionRetry(db, callback, retries = 5) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            await db.exec('BEGIN IMMEDIATE');
            const result = await callback(db);
            await db.exec('COMMIT');
            return result;
        } catch (err) {
            await db.exec('ROLLBACK').catch(() => {});
            if (err.message && err.message.includes('SQLITE_BUSY') && attempt < retries - 1) {
                attempt++;
                await new Promise(resolve => setTimeout(resolve, 50 * attempt));
                continue;
            }
            throw err;
        }
    }
}

// Helper: Robust Word Counter for exact word limits
function countWords(str) {
    if (!str || typeof str !== 'string') return 0;
    const trimmed = str.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
}

// In-flight request concurrency lock per authenticated user (Prevents parallel overlapping AI costs)
const activeUserAiRequests = new Set();
function acquireUserConcurrencyLock(userId) {
    if (!userId || userId === 'guest_user') return true;
    if (activeUserAiRequests.has(userId)) {
        return false;
    }
    activeUserAiRequests.add(userId);
    return true;
}
// =========================================================================================
// SERVER-AUTHORITATIVE CONSENT & 18+ AGE VERIFICATION
// =========================================================================================
const CURRENT_TERMS_VERSION = '2026.1';
const CURRENT_PRIVACY_VERSION = '2026.1';

async function checkUserActiveConsent(uid) {
    if (!uid || uid === 'guest_user') return { status: 'unauthenticated', hasConsent: false };
    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
        if (!IS_PROD && db && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
            return { status: 'active', hasConsent: true };
        }
        return { status: 'service_unavailable', hasConsent: false, error: 'Database service unavailable' };
    }
    try {
        const { data, error } = await supabaseAdmin
            .from('user_consents')
            .select('id, terms_version, privacy_version, age_18_plus, ai_processing_consent, withdrawn_at')
            .eq('user_id', uid)
            .eq('terms_version', CURRENT_TERMS_VERSION)
            .eq('privacy_version', CURRENT_PRIVACY_VERSION)
            .eq('age_18_plus', true)
            .eq('ai_processing_consent', true)
            .is('withdrawn_at', null)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[checkUserActiveConsent DB Error]:', error.message);
            return { status: 'service_unavailable', hasConsent: false, error: error.message };
        }
        if (data) {
            return { status: 'active', hasConsent: true };
        }
        return { status: 'consent_required', hasConsent: false };
    } catch (e) {
        console.error('[checkUserActiveConsent Exception]:', e.message);
        return { status: 'service_unavailable', hasConsent: false, error: e.message };
    }
}

async function requireActiveConsent(req, res, next) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user') {
        return res.status(401).json({
            success: false,
            error: "Authentication required to access AI features.",
            code: "AUTH_REQUIRED"
        });
    }

    const consentCheck = await checkUserActiveConsent(uid);
    if (consentCheck.status === 'service_unavailable') {
        return res.status(503).json({
            success: false,
            error: "Consent verification service is temporarily unavailable. Please try again shortly.",
            code: "CONSENT_SERVICE_UNAVAILABLE"
        });
    }
    if (consentCheck.status !== 'active' || !consentCheck.hasConsent) {
        return res.status(403).json({
            success: false,
            error: "Active 18+ age verification and Terms of Service consent are required to process AI requests.",
            code: "CONSENT_REQUIRED",
            termsVersion: CURRENT_TERMS_VERSION,
            privacyVersion: CURRENT_PRIVACY_VERSION
        });
    }
    next();
}

// =========================================================================================
// UNIFIED ATOMIC SUPABASE POSTGRES CREDIT DEDUCTION & RESERVATION (Zero-Charge Law)
// =========================================================================================
async function verifyAndDeductCreditsDB(req, costParam, featureName = 'ai_feature', idempotencyKey = null) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user') {
        return {
            success: false,
            currentCredits: 0,
            unauthenticated: true,
            error: 'Authentication required. Please sign in to use this feature.'
        };
    }

    const costCredits = (typeof costParam === 'number' && costParam >= 1 && Number.isInteger(costParam))
        ? costParam
        : Math.round((costParam || 0) * CREDITS_PER_INR);

    if (costCredits <= 0) {
        return { success: false, currentCredits: 0, error: 'Invalid deduction amount.' };
    }

    const reqId = idempotencyKey || ('req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

    // Priority 1: Authoritative Atomic Postgres RPC function 'reserve_credits'
    try {
        if (!supabaseAdmin || !supabaseAdmin.rpc) {
            if (!IS_PROD && db && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
                return await verifyAndDeductCreditsSQLite(req, costCredits / CREDITS_PER_INR, featureName, reqId);
            }
            return {
                success: false,
                currentCredits: 0,
                serviceUnavailable: true,
                error: 'Credit database connection unavailable.'
            };
        }

        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('reserve_credits', {
            p_user_id: uid,
            p_amount: costCredits,
            p_feature: featureName,
            p_request_id: reqId
        });

        if (rpcErr) {
            console.error('[verifyAndDeductCreditsDB RPC Error]:', rpcErr.message);
            if (!IS_PROD && db && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
                return await verifyAndDeductCreditsSQLite(req, costCredits / CREDITS_PER_INR, featureName, reqId);
            }
            // Production FAIL-CLOSED: Refuse un-locked non-atomic execution
            return {
                success: false,
                currentCredits: 0,
                serviceUnavailable: true,
                error: 'Credit service temporarily unavailable. Balance unchanged. Please try again.'
            };
        }

        if (rpcRes) {
            const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
            if (row && typeof row === 'object') {
                if (row.success === false) {
                    const currentBal = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.currentCredits === 'number' ? row.currentCredits : 0);
                    const rowErrorCode = typeof row.error === 'string' ? row.error.trim() : '';
                    const rowErrorMessage = typeof row.error_message === 'string' ? row.error_message.trim() : '';

                    if (rowErrorCode === 'PROFILE_MISSING' || rowErrorMessage === 'PROFILE_MISSING') {
                        return {
                            success: false,
                            currentCredits: currentBal,
                            profileMissing: true,
                            code: 'PROFILE_MISSING',
                            error: 'PROFILE_MISSING'
                        };
                    }

                    if (rowErrorCode === 'INSUFFICIENT_CREDITS' || rowErrorMessage === 'Insufficient credit balance.') {
                        return {
                            success: false,
                            currentCredits: currentBal,
                            insufficient: true,
                            error: 'Insufficient credit balance.'
                        };
                    }

                    return {
                        success: false,
                        currentCredits: currentBal,
                        serviceUnavailable: true,
                        error: rowErrorMessage || 'Credit service rejected the reservation. Balance unchanged. Please try again.'
                    };
                }
                if (row.success === true) {
                    const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : 0);
                    return {
                        success: true,
                        remainingCredits: rem,
                        remainingInr: rem / CREDITS_PER_INR,
                        reqId: reqId,
                        duplicate: Boolean(row.duplicate)
                    };
                }
            }
        }

        return {
            success: false,
            currentCredits: 0,
            serviceUnavailable: true,
            error: 'Credit service returned unexpected response. Balance unchanged.'
        };
    } catch (rpcEx) {
        console.error('[verifyAndDeductCreditsDB Exception]:', rpcEx.message);
        if (!IS_PROD && db && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
            return await verifyAndDeductCreditsSQLite(req, costCredits / CREDITS_PER_INR, featureName, reqId);
        }
        return {
            success: false,
            currentCredits: 0,
            serviceUnavailable: true,
            error: 'Credit verification failed. Your credits have not been deducted. Please try again.'
        };
    }
}

// Settle Credit Reservation in Supabase Postgres on successful AI completion
async function settleCreditsDB(req, reqId) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user' || !reqId) return { success: true };
    try {
        if (supabaseAdmin && supabaseAdmin.rpc) {
            const { data, error } = await supabaseAdmin.rpc('settle_credits', {
                p_user_id: uid,
                p_request_id: reqId
            });
            if (error) {
                console.error('[settleCreditsDB RPC Error]:', error.message);
                return { success: false, error: error.message };
            }
            const row = Array.isArray(data) ? data[0] : data;
            if (!row || row.success !== true || row.settled !== true) {
                return { success: false, error: (row && row.error_message) || 'Credit settlement did not complete a pending transaction.' };
            }
            return { success: true, data: row };
        }
    } catch (e) {
        console.warn('[settleCreditsDB Exception]:', e.message);
        return { success: false, error: e.message };
    }
    return { success: true };
}

// Release / Cancel Credit Reservation on AI failure (Failed generation costs user ZERO credits)
async function releaseCreditsDB(req, reqId, reason = 'ai_failure') {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user' || !reqId) return { success: false, remainingCredits: 0 };
    try {
        if (supabaseAdmin && supabaseAdmin.rpc) {
            const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('release_credits', {
                p_user_id: uid,
                p_request_id: reqId,
                p_reason: reason || 'ai_failure'
            });
            if (rpcErr) {
                console.error('[releaseCreditsDB RPC Error]:', rpcErr.message);
                return { success: false, remainingCredits: 0, error: rpcErr.message };
            }
            if (rpcRes) {
                const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
                if (!row || row.success !== true) {
                    return { success: false, remainingCredits: 0, error: (row && row.error_message) || 'Credit release was rejected.' };
                }
                const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : 0);
                return { success: true, remainingCredits: rem };
            }
        }
    } catch (e) {
        console.error('[releaseCreditsDB Exception]:', e.message);
        return { success: false, remainingCredits: 0, error: e.message };
    }
    return { success: false, remainingCredits: 0, error: 'Credit release service returned no response.' };
}

// Fallback SQLite Deduction Helper
async function verifyAndDeductCreditsSQLite(req, costInr, featureName, idempotencyKey) {
    const uid = getUserIdFromReq(req);
    await ensureUserProfile(uid, (req.user && req.user.email) || null);

    return await withTransactionRetry(db, async (db) => {
        const row = await db.get('SELECT credits_balance FROM user_profiles WHERE user_id = ?', [uid]);
        const currentInr = row ? Number(row.credits_balance || 0.00) : 0.00;

        if (currentInr < costInr) {
            throw { insufficient: true, currentCredits: Math.round(currentInr * CREDITS_PER_INR) };
        }

        await db.run(
            'UPDATE user_profiles SET credits_balance = ROUND(credits_balance - ?, 2) WHERE user_id = ? AND credits_balance >= ?',
            [costInr, uid, costInr]
        );

        const deductionId = 'ded_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
        await db.run(
            'INSERT INTO credit_deductions (id, user_id, amount_inr, feature, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [deductionId, uid, costInr, featureName, idempotencyKey || ('req_' + Date.now()), new Date().toISOString()]
        );

        const updatedRow = await db.get('SELECT credits_balance FROM user_profiles WHERE user_id = ?', [uid]);
        const remainingInr = updatedRow ? Number(updatedRow.credits_balance) : Number((currentInr - costInr).toFixed(2));
        return {
            success: true,
            remainingCredits: Math.round(remainingInr * CREDITS_PER_INR),
            remainingInr: remainingInr
        };
    }).catch(err => {
        if (err.insufficient) {
            return { success: false, currentCredits: err.currentCredits };
        }
        throw err;
    });
}

// Persistent Credit Top-Up in Supabase Postgres ('profiles', 'payments' & 'credit_transactions')
async function addUserCreditsDB(req, amountCreditsOrInr, tierName = 'purchase', paymentId = null, orderId = null, amountInr = 0, signature = null) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user') {
        const err = new Error('Authentication required to top up credits.');
        err.statusCode = 401;
        throw err;
    }

    const addCredits = (typeof amountCreditsOrInr === 'number' && amountCreditsOrInr >= 1 && Number.isInteger(amountCreditsOrInr))
        ? amountCreditsOrInr
        : Math.round((amountCreditsOrInr || 0) * CREDITS_PER_INR);

    // Priority 1: Atomic Postgres RPC function 'add_credits'
    try {
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('add_credits', {
            p_user_id: uid,
            p_amount: addCredits,
            p_tier: tierName || 'purchase',
            p_payment_id: paymentId,
            p_order_id: orderId,
            p_amount_inr: amountInr || 0,
            p_signature: signature
        });

        if (!rpcErr && rpcRes) {
            const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
            if (row && typeof row === 'object') {
                if (row.success !== true) {
                    const rowCode = typeof row.error === 'string' ? row.error.trim() : '';
                    const rowMessage = typeof row.error_message === 'string' ? row.error_message.trim() : '';
                    if (rowCode === 'PROFILE_MISSING' || rowMessage === 'PROFILE_MISSING') {
                        const profileErr = new Error('PROFILE_MISSING');
                        profileErr.code = 'PROFILE_MISSING';
                        profileErr.statusCode = 404;
                        throw profileErr;
                    }
                    const rejected = new Error(rowMessage || 'Credit minting request was rejected. No credits were added.');
                    rejected.statusCode = 503;
                    throw rejected;
                }
                const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : null);
                if (typeof rem !== 'number') {
                    const malformed = new Error('Credit minting service returned an invalid balance. No success was accepted.');
                    malformed.statusCode = 503;
                    throw malformed;
                }
                return rem / CREDITS_PER_INR;
            }
        }
    } catch (rpcEx) {
        if (rpcEx && (rpcEx.code === 'PROFILE_MISSING' || rpcEx.statusCode === 404)) throw rpcEx;
        console.warn('[addUserCreditsDB RPC notice]:', rpcEx.message);
    }

    // Fail closed: privileged credit minting may only succeed through a semantically successful add_credits RPC.
    const mintErr = new Error('Credit minting service unavailable. No credits were added.');
    mintErr.statusCode = 503;
    throw mintErr;
}

function sanitizeResponseText(text) {
    if (!text) return "";
    return text
        .replace(/[ \t]+([,.?!])/g, '$1')   // Remove spaces before punctuation ("coffee , though" -> "coffee, though")
        .replace(/[ \t]+/g, ' ')             // Collapse multiple spaces/tabs (preserve newlines!)
        .replace(/ *\n */g, '\n')            // Trim whitespace around line breaks
        .replace(/\n{3,}/g, '\n\n')          // Limit consecutive newlines to max 2 (\n\n)
        .trim();
}

function fixMidSentenceCapitalization(str) {
    if (!str || typeof str !== 'string') return str;
    const commonMidWords = [
        "It", "Its", "In", "On", "At", "With", "For", "To", "From", "By", "About", "As",
        "Into", "Through", "After", "Over", "Between", "Out", "Against", "During", "Without",
        "Before", "Under", "Around", "Among", "And", "But", "Or", "Nor", "So", "Yet",
        "The", "A", "An", "Is", "Are", "Was", "Were", "Be", "Been", "Being",
        "Have", "Has", "Had", "Do", "Does", "Did", "Will", "Would", "Shall", "Should",
        "May", "Might", "Must", "Can", "Could", "That", "Which", "Who", "Whom", "This", "These", "Those",
        "When", "Where", "Why", "How", "What", "All", "Any", "Both", "Each", "Few", "More", "Most", "Other", "Some", "Someone"
    ];

    return str.replace(/([a-z0-9,;:]\s+)([A-Z][a-z]+)\b/g, (match, prefix, word) => {
        if (commonMidWords.includes(word)) {
            return prefix + word.toLowerCase();
        }
        return match;
    });
}

function enforceStructuralBatchDiversity(optionsList, featureType = "generic") {
    if (!Array.isArray(optionsList) || optionsList.length === 0) return optionsList;

    const seenFirstTwoWords = new Set();
    const anchorCounts = {};

    const BANNED_ANCHORS = {
        bio: ["settle this", "ask me about", "usually found", "when i'm not", "grew up in"],
        icebreaker: ["so uh", "noted", "wait you", "good thing", "i have to ask"],
        analyze: ["kinda feel like", "not gonna lie", "you into", "what's been the", "honestly"]
    };

    const targetBans = BANNED_ANCHORS[featureType] || [];

    return optionsList.map((option, idx) => {
        if (!option || typeof option !== 'string') return option;
        let cleaned = fixGrammarAndTypoLeaks(option.trim());

        // 1. Check for repetitive anchor phrases & ABSOLUTE PURGE of "settle this"
        if (/settle this/i.test(cleaned)) {
            const dynamicRepls = ["real question: ", "this or that: ", "pick a side: ", "honest debate: ", "quick question: "];
            const repl = dynamicRepls[idx % dynamicRepls.length];
            cleaned = cleaned.replace(/settle this[\:\,\s]*/gi, repl);
        }

        targetBans.forEach(anchor => {
            if (anchor === "settle this") return; // Handled unconditionally above
            const regex = new RegExp(`^${anchor}[\\:\\,\\s]*`, 'i');
            if (regex.test(cleaned)) {
                anchorCounts[anchor] = (anchorCounts[anchor] || 0) + 1;
                if (anchorCounts[anchor] > 1) {
                    const alternatives = {
                        "ask me about": "curious about ",
                        "usually found": "mostly ",
                        "when i'm not": "outside of that, ",
                        "grew up in": "raised in ",
                        "so uh": "quick question: ",
                        "noted": "fair point — ",
                        "wait you": "hold on, ",
                        "good thing": "lucky for you, ",
                        "i have to ask": "random question: ",
                        "kinda feel like": "seems like ",
                        "not gonna lie": "real talk: ",
                        "you into": "are you a fan of ",
                        "what's been the": "tell me about the ",
                        "honestly": "truth is, "
                    };
                    const repl = alternatives[anchor.toLowerCase()] || "";
                    cleaned = cleaned.replace(regex, repl);
                }
            }
        });

        // 2. Ensure first two words are not identical across options in the same batch
        const words = cleaned.split(/\s+/);
        if (words.length >= 2) {
            const firstTwo = `${words[0].toLowerCase().replace(/[^a-z]/g, '')} ${words[1].toLowerCase().replace(/[^a-z]/g, '')}`;
            if (seenFirstTwoWords.has(firstTwo) && idx > 0) {
                const prefixes = ["so, ", "well, ", "honestly, ", "curious, ", "real talk, "];
                const altPrefix = prefixes[idx % prefixes.length];
                if (!prefixes.some(p => cleaned.toLowerCase().startsWith(p.trim()))) {
                    cleaned = `${altPrefix}${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
                }
            } else {
                seenFirstTwoWords.add(firstTwo);
            }
        }

        return cleaned;
    });
}

// Programmatic deduplication safety net
function enforceUniqueQuestionAnchors(biosArray) {
    if (!Array.isArray(biosArray)) return biosArray;
    
    // List of dynamic replacement prefixes for closing questions
    const dynamicPrefixes = [
        "real question:",
        "this or that:",
        "pick a side:",
        "honest debate:",
        "quick question:"
    ];
    
    let prefixIndex = 0;
    const seenAnchors = new Set();
    
    return biosArray.map((bio, idx) => {
        if (typeof bio !== 'string') return bio;
        
        let cleaned = bio;
        
        // UNCONDITIONAL PERMANENT BAN & REPLACEMENT OF "settle this" / "settle this:" ANYWHERE
        if (/settle this/i.test(cleaned)) {
            const replacement = dynamicPrefixes[idx % dynamicPrefixes.length] + " ";
            cleaned = cleaned.replace(/settle this[\:\,\s]*/gi, replacement);
        }

        // Detect other common anchor phrases
        const anchorMatch = cleaned.match(/(ask me about|usually found|not gonna lie):?/i);
        
        if (anchorMatch) {
            const anchor = anchorMatch[0].toLowerCase();
            
            // If this anchor has ALREADY been used in this batch, replace it dynamically!
            if (seenAnchors.has(anchor)) {
                const replacement = dynamicPrefixes[prefixIndex % dynamicPrefixes.length];
                prefixIndex++;
                cleaned = cleaned.replace(new RegExp(anchorMatch[0], 'i'), replacement);
            } else {
                seenAnchors.add(anchor);
            }
        }
        
        return cleaned;
    });
}

function applyFormattingRules(text, shorthandOption, emojiOption) {
    if (!text || typeof text !== "string") return text;
    let result = text;

    const useShorthand = shorthandOption !== false;
    const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;

    // Apply Casing: If Linguistic Shorthand is ON (default/true), force lowercase.
    // If Linguistic Shorthand is OFF (false), fix mid-sentence capitalization bugs.
    if (useShorthand) {
        result = result.toLowerCase();
    } else {
        result = fixMidSentenceCapitalization(result);
    }

    // Apply Emoji Density:
    // If emojiLevel === 0 (Minimal/None), strip all emojis programmatically.
    if (emojiLevel === 0) {
        try {
            result = result.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), '').trim();
        } catch(e) {
            result = result.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();
        }
    } else if (emojiLevel === 2) {
        // If Expressive (maxed out slider), programmatically ensure at least 2 expressive emojis exist!
        const expressivePool = ["😏", "😉", "👀", "🔥", "✨", "💅", "☕", "💯", "🥂", "⚡"];
        let matchCount = 0;
        try {
            const matches = result.match(new RegExp('\\p{Extended_Pictographic}', 'gu'));
            matchCount = matches ? matches.length : 0;
        } catch(e) {
            const matches2 = result.match(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g);
            matchCount = matches2 ? matches2.length : 0;
        }
        if (matchCount < 2) {
            const needed = 2 - matchCount;
            for (let i = 0; i < needed; i++) {
                const randEmoji = expressivePool[Math.floor(Math.random() * expressivePool.length)];
                result += " " + randEmoji;
            }
        }
    }

    return result;
}

async function executeSingleOpenRouterCall(apiKey, modelIdentifier, messagesArray, temperature, maxTokens, timeoutMs, topP) {
    const rawBaseUrl = process.env.AICREDITS_BASE_URL || "https://api.aicredits.in/v1";
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');

    // Support both prefixed model identifier and raw model identifier (prefer prefixed for AICREDITS)
    let candidateModels = [];
    if (modelIdentifier.startsWith("qwen/")) {
        candidateModels = [modelIdentifier, modelIdentifier.replace(/^qwen\//, '')];
    } else {
        candidateModels = ["qwen/" + modelIdentifier, modelIdentifier];
    }
    candidateModels = [...new Set(candidateModels)];

    let lastErr = null;
    for (const targetModel of candidateModels) {
        const payload = {
            model: targetModel,
            messages: messagesArray,
            temperature: temperature
        };
        if (maxTokens) {
            payload.max_tokens = maxTokens;
        }
        if (topP !== null && topP !== undefined) {
            payload.top_p = topP;
        }

        const fetchOptions = {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "My Wingman App"
            },
            body: JSON.stringify(payload)
        };

        let timer = null;
        if (timeoutMs) {
            const controller = new AbortController();
            fetchOptions.signal = controller.signal;
            timer = setTimeout(() => controller.abort(), timeoutMs);
        }

        try {
            const response = await fetch(baseUrl + "/chat/completions", fetchOptions);
            if (timer) clearTimeout(timer);

            if (!response.ok) {
                const errText = await response.text();
                const err = new Error(`AI API Failure [${targetModel}]: ${response.status} - ${errText}`);
                err.statusCode = response.status;
                lastErr = err;
                if (response.status === 400 || response.status === 404) {
                    continue;
                }
                throw err;
            }
            const data = await response.json();
            if (data.error) {
                throw new Error(`AI API Error: ${data.error.message || JSON.stringify(data.error)}`);
            }
            if (!data.choices || data.choices.length === 0) {
                throw new Error(`AI API returned no choices. Response: ${JSON.stringify(data)}`);
            }
            const msg = data.choices[0].message;
            const outputContent = typeof msg === 'string' ? msg : (msg ? (msg.content || msg.reasoning || '') : '');
            return outputContent;
        } catch (err) {
            if (timer) clearTimeout(timer);
            if (err.name === 'AbortError') {
                const timeoutErr = new Error("Analysis timed out. Please try again.");
                timeoutErr.isTimeout = true;
                throw timeoutErr;
            }
            lastErr = err;
            if (err.statusCode === 400 || err.statusCode === 404) {
                continue;
            }
            throw err;
        }
    }
    throw lastErr || new Error(`AI API call failed for model ${modelIdentifier}`);
}

// Strict Screenshot Analyzer provider call: exact AICREDITS endpoint/model/key, no model or key fallback.
async function queryAnalyzerProvider(stage, messagesArray, temperature = 0.7, maxTokens = null, timeoutMs = 25000, topP = null) {
    const isVisionStage = stage === 'vision';
    const isMainStage = stage === 'main';
    if (!isVisionStage && !isMainStage) {
        throw new Error(`Invalid Screenshot Analyzer stage: ${stage}`);
    }

    const apiKey = isVisionStage ? process.env.AICREDITS_API_KEY_VISION : process.env.AICREDITS_API_KEY;
    const model = isVisionStage ? 'qwen/qwen3.5-flash-02-23' : 'qwen/qwen3-235b-a22b-2507';
    const baseUrl = 'https://api.aicredits.in/v1';

    if (!apiKey) {
        throw new Error(`Missing required Screenshot Analyzer API key for ${stage} stage.`);
    }

    const payload = { model, messages: messagesArray, temperature };
    if (maxTokens) payload.max_tokens = maxTokens;
    if (topP !== null && topP !== undefined) payload.top_p = topP;

    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'My Wingman App'
            },
            body: JSON.stringify(payload),
            ...(controller ? { signal: controller.signal } : {})
        });

        if (!response.ok) {
            const errText = await response.text();
            const err = new Error(`Screenshot Analyzer AI API Failure [${model}]: ${response.status} - ${errText}`);
            err.statusCode = response.status;
            throw err;
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(`Screenshot Analyzer AI API Error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        if (!data.choices || data.choices.length === 0) {
            throw new Error(`Screenshot Analyzer AI API returned no choices for ${model}.`);
        }

        const msg = data.choices[0].message;
        const outputContent = typeof msg === 'string' ? msg : (msg ? (msg.content || msg.reasoning || '') : '');
        if (!outputContent) {
            throw new Error(`Screenshot Analyzer AI API returned empty content for ${model}.`);
        }
        return outputContent;
    } catch (err) {
        if (err.name === 'AbortError') {
            const timeoutErr = new Error('Analysis timed out. Please try again.');
            timeoutErr.isTimeout = true;
            throw timeoutErr;
        }
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// Helper function to query OpenRouter dynamically with automatic key failover
async function queryOpenRouter(modelIdentifier, messagesArray, temperature = 0.7, maxTokens = null, timeoutMs = 25000, topP = null) {
    const isVisionModel = (typeof modelIdentifier === 'string') && (modelIdentifier.includes('vl') || modelIdentifier.includes('vision') || modelIdentifier.includes('flash'));

    const rawKeys = isVisionModel ? [
        process.env.AICREDITS_API_KEY_VISION,
        process.env.AICREDITS_API_KEY_GENERAL,
        process.env.AICREDITS_API_KEY,
        process.env.OPENROUTER_API_KEY
    ].filter(Boolean) : [
        process.env.AICREDITS_API_KEY_GENERAL,
        process.env.AICREDITS_API_KEY,
        process.env.AICREDITS_API_KEY_VISION,
        process.env.OPENROUTER_API_KEY
    ].filter(Boolean);

    // Remove duplicates
    const keysToTry = [...new Set(rawKeys)];

    if (keysToTry.length === 0) {
        throw new Error("Missing API Key in environment configuration.");
    }

    let lastError = null;
    for (const apiKey of keysToTry) {
        try {
            const result = await executeSingleOpenRouterCall(apiKey, modelIdentifier, messagesArray, temperature, maxTokens, timeoutMs, topP);
            return result;
        } catch (err) {
            lastError = err;
            console.warn(`API key attempt failed for model ${modelIdentifier} (${err.message}). Trying fallback API key...`);
        }
    }

    // Model Failover Retry Logic (strictly forbidden for Screenshot Analyzer models as per Rule 5 & 6)
    const isAnalyzerModel = typeof modelIdentifier === 'string' && (modelIdentifier.includes('flash-02-23') || modelIdentifier.includes('235b-a22b-2507'));
    if (!isAnalyzerModel) {
        const FALLBACK_MODELS = {
            'qwen/qwen2.5-vl-72b-instruct': 'google/gemini-2.5-flash'
        };
        const fallbackModel = FALLBACK_MODELS[modelIdentifier];
        if (fallbackModel && fallbackModel !== modelIdentifier) {
            console.warn(`[AI Failover] Model ${modelIdentifier} failed on all keys. Attempting failover to ${fallbackModel}...`);
            for (const apiKey of keysToTry) {
                try {
                    const result = await executeSingleOpenRouterCall(apiKey, fallbackModel, messagesArray, temperature, maxTokens, timeoutMs, topP);
                    return result;
                } catch (err) {
                    lastError = err;
                }
            }
        }
    }

    throw lastError || new Error("AI provider temporarily unavailable. All key and model fallbacks failed.");
}

// ==================== AUTHENTICATION & DATA SEPARATION ARCHITECTURE ====================

// Domain 1: Strict Dual-Table Storage (Isolated Auth vs Profile Data - SQLite DB Integration)
// In-memory maps removed. Handled via global 'db' instance.

// =========================================================================================
// LEGACY AUTH ENDPOINTS REMOVED
// Authentication is now fully delegated to Supabase. The following endpoints have been
// removed: /api/auth/register, /api/auth/login, /api/auth/verify-email, /api/auth/logout.
// The frontend uses Supabase's signUp, signInWithPassword, signInWithOAuth, and signOut
// methods directly. The server validates Supabase access tokens via verifySupabaseToken
// middleware (calling Supabase's /auth/v1/user endpoint).
// =========================================================================================




// Helper utility: Enforce a strict 500-word limit per single request input
function enforceWordLimit(text, maxWords = 500) {
    if (!text || typeof text !== "string") return text;
    const words = text.trim().split(/\s+/);
    if (words.length > maxWords) {
        return words.slice(0, maxWords).join(" ");
    }
    return text;
}

// Prompt Injection Sanitizer Helper
function sanitizePromptInput(input) {
    if (!input || typeof input !== 'string') return '';
    let clean = input.trim();
    clean = clean.replace(/ignore\s+(all\s+)?(previous|above)\s+instructions/gi, '[filtered directive]');
    clean = clean.replace(/system\s*:\s*/gi, '');
    return clean;
}

// ==================== THE 4 CORE FEATURE API // 1. CHAT SCREENSHOT ANALYZER (/api/analyze & /api/analyze-chat-screenshot)
app.post(['/api/analyze', '/api/analyze-chat-screenshot'], requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {
    const uid = getUserIdFromReq(req);
    if (!acquireUserConcurrencyLock(uid)) {
        return res.status(429).json({ success: false, error: "A generation is already in progress for your account. Please wait for it to complete." });
    }
    const reqId = req.headers['x-idempotency-key'] || (req.body && req.body.idempotencyKey) || ('anl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    let deduction = null;

    try {
        let { text, messages, tone, image, images, imageBase64, shorthandOption, emojiOption } = req.body || {};
        const textCheck = text || (messages && messages[0] ? messages[0].content : "");
        if (typeof textCheck === 'string' && textCheck.length > 5000) {
            return res.status(400).json({
                success: false,
                error: "Your message is too long. Maximum: 5,000 characters."
            });
        }

        // Validate image array bounds before deduction
        if (Array.isArray(images) && images.length > 5) {
            return res.status(400).json({
                success: false,
                error: "You can analyze a maximum of 5 images at a time."
            });
        }

        // 1. Image Normalization into a single canonical array
        let rawImages = [];
        if (Array.isArray(images)) {
            rawImages = images;
        } else if (image || imageBase64) {
            rawImages = [image || imageBase64];
        }

        // 2. Strict Backend Image Validation (Occurs BEFORE credit reservation)
        if (rawImages.length > 5) {
            return res.status(400).json({
                success: false,
                error: "You can analyze a maximum of 5 images at a time."
            });
        }

        let imageList = [];
        let totalDecodedBytes = 0;
        const MAX_SINGLE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
        const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
        const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/bmp'];

        for (let i = 0; i < rawImages.length; i++) {
            const item = rawImages[i];
            if (!item || typeof item !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: `Screenshot #${i + 1} payload is invalid.`
                });
            }
            const trimmed = item.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
                return res.status(400).json({
                    success: false,
                    error: "Remote image URLs are not supported. Please upload screenshot files directly."
                });
            }

            let mime = 'image/jpeg';
            let base64Data = '';
            if (trimmed.startsWith('data:')) {
                const match = trimmed.match(/^data:([^;]+);base64,(.+)$/s);
                if (!match) {
                    return res.status(400).json({
                        success: false,
                        error: `Screenshot #${i + 1} contains an invalid data URL or unsupported encoding.`
                    });
                }
                mime = match[1].toLowerCase();
                base64Data = match[2].replace(/[\r\n\s]+/g, '');
            } else {
                base64Data = trimmed.replace(/[\r\n\s]+/g, '');
            }

            if (!ALLOWED_MIMES.includes(mime)) {
                return res.status(400).json({
                    success: false,
                    error: `Screenshot #${i + 1} has an unsupported format (${mime}). Supported: JPG, PNG, WEBP, HEIC, BMP.`
                });
            }

            if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
                return res.status(400).json({
                    success: false,
                    error: `Screenshot #${i + 1} is corrupted or not valid base64 data.`
                });
            }

            const decodedBytes = Math.floor((base64Data.length * 3) / 4) - ((base64Data.endsWith('==')) ? 2 : (base64Data.endsWith('=') ? 1 : 0));
            if (decodedBytes <= 0) {
                return res.status(400).json({
                    success: false,
                    error: `Screenshot #${i + 1} is empty or unreadable.`
                });
            }

            if (decodedBytes > MAX_SINGLE_IMAGE_BYTES) {
                return res.status(400).json({
                    success: false,
                    error: `Screenshot #${i + 1} exceeds the 5 MB per-image limit.`
                });
            }

            totalDecodedBytes += decodedBytes;
            if (totalDecodedBytes > MAX_TOTAL_IMAGE_BYTES) {
                return res.status(400).json({
                    success: false,
                    error: "Total upload size exceeds the 25 MB maximum batch limit."
                });
            }

            imageList.push(`data:${mime};base64,${base64Data}`);
        }

        if (imageList.length === 0 && (!messages || messages.length === 0)) {
            return res.status(400).json({ success: false, error: "Please upload at least 1 chat screenshot to analyze." });
        }

        deduction = await verifyAndDeductCreditsDB(req, 10, 'analyze', reqId);
        if (!deduction.success) {
            if (deduction.profileMissing) {
                return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
            }
            if (deduction.unauthenticated) {
                return res.status(401).json({
                    success: false,
                    error: deduction.error || "Authentication required to use this feature."
                });
            }
            if (deduction.serviceUnavailable) {
                return res.status(503).json({
                    success: false,
                    error: deduction.error || "Credit service temporarily unavailable. Please try again."
                });
            }
            return res.status(402).json({
                success: false,
                error: "Insufficient credits. Please purchase credits to use this feature.",
                credits: deduction.currentCredits
            });
        }

        if (deduction.duplicate === true) {
            return res.status(409).json({
                success: false,
                error: "This request ID has already been processed or is already in progress. No additional credits were deducted.",
                code: "DUPLICATE_REQUEST",
                duplicate: true,
                credits: deduction.remainingCredits
            });
        }

        // =========================================================================
        // DUAL-MODEL VISION & CHAT STATE PIPELINE
        // STAGE 1: Vision Extraction & Spatial Parsing via qwen3.5-flash-02-23
        // STAGE 2: State-Aware Strategy & Reply Generation via qwen3-235b-a22b-2507
        // =========================================================================

        let extractedTextContext = "";
        if (imageList.length === 0) {
            if (messages && messages.length > 0) {
                const userMsg = messages.find(m => m.role === 'user');
                extractedTextContext = userMsg ? enforceWordLimit(userMsg.content, 500) : "";
            } else {
                return res.status(400).json({ success: false, error: "Base64 image payload or chat history is missing." });
            }
        } else {
            const visionSystemPrompt = `You are an expert Chat Interface Optical Parser. Analyze the screenshot image(s) and output a clean JSON state object.

RULES:
1. SPATIAL ALIGNMENT LAW:
   - RIGHT-ALIGNED BUBBLES/MEDIA (X > 50% screen width) = SENT_BY_USER (The Guy).
   - LEFT-ALIGNED BUBBLES/MEDIA (X <= 50% screen width) = SENT_BY_MATCH (The Girl).
   - If the bottom-most element is SENT_BY_MATCH, set active_status = "MATCH_REPLIED".
   - If the bottom-most element is SENT_BY_USER, set active_status = "USER_LEFT_ON_READ".

2. STRICT REEL OCR ISOLATION LAW (CRITICAL):
   - ABSOLUTE BAN ON REEL THUMBNAIL OCR: Shared Reels/Videos are visual media cards. You are STRICTLY FORBIDDEN from reading, OCR-ing, transcribing, or extracting text overlay, captions, creator handles, or video title text inside video reel frames or thumbnail cards (FORBIDDEN: "Nvidia", "Nemotron", "Ultra", video titles, creator overlays).
   - Shared Reels MUST ONLY be represented in JSON as type: "SHARED_REEL" and text: "[Video Reel]".
   - ONLY extract text from actual chat text speech bubbles.

JSON SCHEMA OUTPUT (OUTPUT ONLY VALID JSON, NO MARKDOWN):
{
  "chat_history": [
    { "sender": "SENT_BY_USER", "type": "SHARED_REEL", "text": "[Video Reel]" },
    { "sender": "SENT_BY_USER", "type": "TEXT", "text": "Hiii" }
  ],
  "latest_sender": "SENT_BY_USER",
  "active_status": "USER_LEFT_ON_READ",
  "match_has_replied": false
}`;

            console.log(`Executing Stage 1: Optical Vision & Spatial Parsing for ${imageList.length} screenshot(s) using qwen3.5-flash-02-23...`);
            const transcriptionPromises = imageList.map(async (imgUrl, i) => {
                const positionTag = (i === imageList.length - 1)
                    ? `SCREENSHOT ${i + 1} OF ${imageList.length} (LATEST SCREENSHOT - CONTAINS FINAL MESSAGE)`
                    : `SCREENSHOT ${i + 1} OF ${imageList.length} (EARLIER CONVERSATION HISTORY)`;

                const visionMessages = [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: `${visionSystemPrompt}\n\n[SCREENSHOT SEQUENCE TAG: ${positionTag}]` },
                            { type: "image_url", image_url: { url: imgUrl } }
                        ]
                    }
                ];
                const singleTranscript = await queryAnalyzerProvider('vision', visionMessages, 0.2, 800, 25000);
                if (!singleTranscript || typeof singleTranscript !== 'string' || singleTranscript.trim().length === 0) {
                    throw new Error(`Optical parsing failed for screenshot ${i + 1}.`);
                }
                return `--- ${positionTag} ---\n${singleTranscript}`;
            });

            const transcriptions = await Promise.all(transcriptionPromises);
            extractedTextContext = transcriptions.join("\n\n");
            
            if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {
                console.log("\n================ [STAGE 1 VISION JSON OUTPUT] ================");
                console.log(extractedTextContext);
                console.log("==============================================================\n");
            }
        }

        extractedTextContext = enforceWordLimit(extractedTextContext, 600);

        const useShorthand = shorthandOption !== false;
        const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;

        let formattingRule = "FORMAT: Fully lowercase text, max 15-22 words per option.";
        if (!useShorthand) {
            formattingRule = "FORMAT: Standard capitalization, max 15-22 words per option.";
        }
        if (emojiLevel === 0) {
            formattingRule += " Zero emojis.";
        } else if (emojiLevel === 2) {
            formattingRule += " Include 2 to 3 expressive emojis per option (e.g., 😏, 🔥, 👀, ✨).";
        } else {
            formattingRule += " Max 1 confident emoji at the end (e.g., 😏, 😉, 👀).";
        }

        let requestedTone = (req.body.tone || req.body.vibe || "Witty").trim();
        const cleanToneKey = requestedTone.split(' ')[0].toLowerCase();

        let modeConfig = {
            name: "WITTY",
            description: "Sharp observations, dry humor, sarcastic banter, and self-aware, high-status banter.",
            buckets: [
                "Option 1 reply text [Sharp Observation]",
                "Option 2 reply text [Sharp Observation]",
                "Option 3 reply text [Dry Banter]",
                "Option 4 reply text [Dry Banter]",
                "Option 5 reply text [Clever Question]",
                "Option 6 reply text [Clever Question]",
                "Option 7 reply text [Witty Topic Pivot]",
                "Option 8 reply text [Witty Topic Pivot]",
                "Option 9 reply text [Snappy Minimalist]",
                "Option 10 reply text [Snappy Minimalist]"
            ],
            bucketDefinitions: `• Options 1-2 [Sharp Observation]: Clever, dry commentary on something specific in her text/bio.
• Options 3-4 [Dry Banter]: Playful tease that holds frame and doesn't over-explain.
• Options 5-6 [Clever Question]: Intriguing open question that makes answering effortless and fun.
• Options 7-8 [Witty Topic Pivot]: Smooth, unforced shift into an engaging fresh conversation angle.
• Options 9-10 [Snappy Minimalist]: Ultra-short (2-4 words), effortless high-status punchline.`
        };

        if (cleanToneKey === "flirty" || cleanToneKey === "flirt") {
            modeConfig = {
                name: "FLIRTY",
                description: "Playful tension, charming banter, subtle romantic teasing, and mutual chemistry.",
                buckets: [
                    "Option 1 reply text [Playful Charm]",
                    "Option 2 reply text [Playful Charm]",
                    "Option 3 reply text [Flirty Tease]",
                    "Option 4 reply text [Flirty Tease]",
                    "Option 5 reply text [Intriguing Spark]",
                    "Option 6 reply text [Intriguing Spark]",
                    "Option 7 reply text [Smooth Vibe Setup]",
                    "Option 8 reply text [Smooth Vibe Setup]",
                    "Option 9 reply text [Cheeky Minimalist]",
                    "Option 10 reply text [Cheeky Minimalist]"
                ],
                bucketDefinitions: `• Options 1-2 [Playful Charm]: Lighthearted charm that creates immediate spark without being crude.
• Options 3-4 [Flirty Tease]: Playful romantic tease that builds mutual chemistry and tension.
• Options 5-6 [Intriguing Spark]: Playful qualification challenge (e.g. testing if she can keep up).
• Options 7-8 [Smooth Vibe Setup]: Seamless redirect to a more fun, intriguing romantic vibe.
• Options 9-10 [Cheeky Minimalist]: 2-to-4 word magnetic, confident reply.`
            };
        } else if (cleanToneKey === "casual" || cleanToneKey === "chill") {
            modeConfig = {
                name: "CASUAL",
                description: "Chill, relaxed, low-pressure, friend-vibe continuity and grounded human texting flow.",
                buckets: [
                    "Option 1 reply text [Easygoing Reaction]",
                    "Option 2 reply text [Easygoing Reaction]",
                    "Option 3 reply text [Low-Key Question]",
                    "Option 4 reply text [Low-Key Question]",
                    "Option 5 reply text [Relatable Take]",
                    "Option 6 reply text [Relatable Take]",
                    "Option 7 reply text [Casual Topic Shift]",
                    "Option 8 reply text [Casual Topic Shift]",
                    "Option 9 reply text [Short Chill Text]",
                    "Option 10 reply text [Short Chill Text]"
                ],
                bucketDefinitions: `• Options 1-2 [Easygoing Reaction]: Grounded, low-pressure reaction to her text with zero urgency.
• Options 3-4 [Low-Key Question]: Casual, effortless conversation starter with zero pressure.
• Options 5-6 [Relatable Take]: Funny, relatable observation about everyday life or habits.
• Options 7-8 [Casual Topic Shift]: Organic transition to weekend plans, food, music, or stories.
• Options 9-10 [Short Chill Text]: Short, ultra-natural 2-4 word relaxed response.`
            };
        } else if (cleanToneKey === "bold" || cleanToneKey === "closer" || cleanToneKey === "direct") {
            modeConfig = {
                name: "BOLD / CLOSER",
                description: "High energy, direct, confident, making direct moves/plans with unapologetic charm.",
                buckets: [
                    "Option 1 reply text [Direct Callout]",
                    "Option 2 reply text [Direct Callout]",
                    "Option 3 reply text [Bold Challenge]",
                    "Option 4 reply text [Bold Challenge]",
                    "Option 5 reply text [Direct Plan Move]",
                    "Option 6 reply text [Direct Plan Move]",
                    "Option 7 reply text [High-Energy Hook]",
                    "Option 8 reply text [High-Energy Hook]",
                    "Option 9 reply text [Power Minimalist]",
                    "Option 10 reply text [Power Minimalist]"
                ],
                bucketDefinitions: `• Options 1-2 [Direct Callout]: Unapologetic clarity about what you find attractive or want to do.
• Options 3-4 [Bold Challenge]: Playful challenge or direct callout that commands respect.
• Options 5-6 [Direct Plan Move]: Bold suggestion to grab drinks, coffee, or switch to IG/WhatsApp.
• Options 7-8 [High-Energy Hook]: Intriguing, confident question with strong presence.
• Options 9-10 [Power Minimalist]: 2-to-4 word direct, ultra-confident statement.`
            };
        }

        const screenshotTextSystemPrompt = `You are an elite AI Wingman and Social Attraction Strategist.
Generate 10 strategic text reply options based on the provided conversation JSON state.

CHRONOLOGICAL RECENCY HIERARCHY:
- Read chat strictly from BOTTOM to TOP.
- Bottom-most message bubble is the ONLY active conversation state.
- Stale media (reels sent hours prior above latest text) is EXPIRED and MUST BE IGNORED. Focus on active text smoothly.

STATE-AWARE STRATEGY DIRECTIVES:
1. IF active_status === "USER_LEFT_ON_READ" (or latest_sender === "SENT_BY_USER"):
   - The User sent the last message(s) and is waiting for a reply.
   - DO NOT generate responses acting as if the match just sent a message.
   - DO NOT ask her about a reel/media item that THE USER sent as if SHE shared it.
   - GENERATE: Smooth, low-pressure topic resets, playful double-text pivots, or high-status banter that re-opens the thread naturally without sounding needy or acknowledging the read status.
   - DIVERSIFY ALL 10 OPTIONS: Each of the 10 options MUST cover completely distinct, engaging lifestyle topics (e.g. weekend plans, food/coffee debates, spontaneous trips, funny observations, low-key check-ins). NEVER repeat the same topic across options.

2. IF active_status === "MATCH_REPLIED" (or latest_sender === "SENT_BY_MATCH"):
   - The Match sent the last message. Generate direct, engaging, high-status responses responding to her text.

--------------------------------------------------------------------------------
ANTI-CLICHÉ & META-NARRATION GUARDRAILS:
--------------------------------------------------------------------------------
1. META-NARRATION BAN: NEVER comment on message sequence or texting patterns (BANNED: "switching from... to...", "switching from X to Y", "saying hiii like nothing happened", "saying hi like nothing happened", "sending reels then saying", "after that reel").
2. PASSIVE-AGGRESSIVE BAN: NEVER sound insecure or passive-aggressive (BANNED: "upgrade your attention span", "got ghosted", "ignoring me", "why no reply", "too good to reply", "guess you're busy", "sorry for double texting").

--------------------------------------------------------------------------------
MODE FIREWALL & TONE RULES:
--------------------------------------------------------------------------------
[MODE: CASUAL]
- Vibe: Chill, relaxed, low-pressure, friend-vibe continuity.
- BANNED: Flirting, pickup lines, smirks (😜), or romantic references ('shy smile', 'someone you like', 'date', 'cute').
- Example for USER_LEFT_ON_READ: "random question but are you a spontaneous trip person or full planner?"

[MODE: WITTY]
- Vibe: Sharp observations, dry humor, clever callouts, sarcastic banter, self-aware.
- BANNED: Generic compliments, cheesy pickup lines, or over-explaining.

[MODE: FLIRTY]
- Vibe: Playful tension, charming banter, subtle romantic teasing.
- MANDATE: Builds romantic chemistry and warm tension without being crude or overly intense.

[MODE: BOLD / CLOSER]
- Vibe: High energy, direct, confident, making direct moves/plans.
- MANDATE: Unapologetic charm and clear plan proposal (drinks, coffee, date, switching to IG/WhatsApp).

--------------------------------------------------------------------------------
UNIVERSAL BATCH DIVERSITY LAW
--------------------------------------------------------------------------------
When generating an array/batch of output options for a single user request:
1. EVERY option in the batch MUST use a strictly distinct:
   - Sentence length & rhythm (e.g., Options 9-10: 2-4 word minimalists, Options 1-4: 6-12 words, Options 5-8: 12-20 words).
   - Opening hook & lead-in prefix (NO TWO options may share the same first 2 words).
   - Ending format (e.g., Open question, Statement/No question, This-or-That debate).

2. ABSOLUTE REPETITION BAN:
   - Maximum ONE option per batch can start with "kinda feel like...", "not gonna lie...", "you into...", or "what's been the...".

--------------------------------------------------------------------------------
ACTIVE MODE RUNNING NOW: ${modeConfig.name}
MODE DIRECTIVE: ${modeConfig.description}
--------------------------------------------------------------------------------

You MUST return valid JSON strictly matching this schema with EXACTLY 10 distinct options:
{
  "options": ${JSON.stringify(modeConfig.buckets, null, 2)}
}

Map the 10 options strictly across these 5 categories (2 options each):
${modeConfig.bucketDefinitions}

${formattingRule}`;

        const generationMessages = [
            { role: "system", content: screenshotTextSystemPrompt },
            { role: "user", content: `Here is the parsed conversation JSON state from Stage 1:\n"${extractedTextContext}"\n\nActive Response Mode: ${modeConfig.name}. Return the JSON object with 10 state-aware options matching this mode now.` }
        ];

        console.log(`Executing Stage 2: Generating 10 strategic response cards for mode ${modeConfig.name} using qwen3-235b-a22b-2507...`);
        let finalCardsOutput = "";
        finalCardsOutput = await queryAnalyzerProvider('main', generationMessages, 0.20, 800, 25000);

        let optionsList = [];
        try {
            const jsonMatch = (finalCardsOutput || "").match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed && Array.isArray(parsed.options) && parsed.options.length > 0) {
                    optionsList = parsed.options;
                }
            }
        } catch(e) {
            console.warn("JSON parse fallback in Analyze Chat:", e.message);
        }

        if (!optionsList || optionsList.length === 0) {
            optionsList = (finalCardsOutput || "").split(/(?:^|\n)\d+[\.\)\:]\s*/).filter(s => s.trim().length > 0);
        }

        // GENERALIZED SANITIZER (NO HARDCODED TERM PURGES, NO SPECIFIC PHRASE SUBSTITUTIONS)
        optionsList = optionsList.map(optionText => {
            let cleaned = optionText.trim().replace(/^Option\s*\d+[\:\.\-]?\s*/i, "").replace(/\s+/g, ' ');

            // Strict Emoji Cap (Max 1 per string or based on level)
            if (emojiLevel === 0) {
                try {
                    cleaned = cleaned.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), '').trim();
                } catch(e) {
                    cleaned = cleaned.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();
                }
            } else if (emojiLevel === 1) {
                const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu;
                let count = 0;
                cleaned = cleaned.replace(emojiRegex, (match) => {
                    count++;
                    return count === 1 ? match : '';
                });
            }

            return applyFormattingRules(cleaned.trim(), useShorthand, emojiLevel);
        });

        optionsList = enforceUniqueQuestionAnchors(enforceStructuralBatchDiversity(optionsList, "analyze"));
        const formattedText = optionsList.map((opt, i) => `${i + 1}. ${opt}`).join("\n");

        try {
            const currentUserId = getUserIdFromReq(req);
            if (db && currentUserId) {
                const analysisId = 'anl_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
                const dbImagePayload = targetImage ? (targetImage.length > 100 ? 'base64_data' : targetImage) : 'chat_history';
                // RLS Engine: user_id is forced to the server-validated uid (client cannot set owner).
                const rls = forRequest(req, db);
                await rls.create('saved_chat_analyses', ['id', 'image_url', 'tone', 'generated_options'], [analysisId, dbImagePayload, requestedTone, JSON.stringify(optionsList)]);
            }
        } catch (dbErr) {
            console.error("Database insert error (Analysis):", dbErr);
        }

        if (!optionsList || !Array.isArray(optionsList) || optionsList.length === 0) {
            throw new Error("Analysis failed: AI provider generated empty or malformed output.");
        }

        const settleResult = await settleCreditsDB(req, reqId);
        if (!settleResult || !settleResult.success) {
            console.error(`[Ledger Error] Failed to settle credits for analyzer reqId ${reqId}:`, settleResult ? settleResult.error : "Unknown");
            return res.status(503).json({
                success: false,
                error: `Transaction completion error (Ref: ${reqId}). Your credit balance may need reconciliation. Please refresh or contact support.mywingman@gmail.com.`,
                reqId: reqId
            });
        }

        res.json({
            success: true,
            options: optionsList,
            text: formattedText,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Pipeline breakdown:", error.message);
        let currentBal = deduction ? deduction.remainingCredits : 0;
        let releaseSucceeded = false;
        if (deduction && deduction.success && !deduction.duplicate) {
            const relRes = await releaseCreditsDB(req, reqId, error.message);
            if (relRes && relRes.success) {
                releaseSucceeded = true;
                if (typeof relRes.remainingCredits === 'number') {
                    currentBal = relRes.remainingCredits;
                }
            }
        }
        if (deduction && deduction.success && !deduction.duplicate && !releaseSucceeded) {
            return res.status(500).json({
                success: false,
                error: `Analysis failed and credit release could not be confirmed (Ref: ${reqId}). Please refresh your balance or contact support.mywingman@gmail.com.`,
                reqId: reqId,
                credits: deduction.currentCredits
            });
        }
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({
                success: false,
                error: "Analysis timed out. Your credits were restored.",
                credits: currentBal
            });
        }
        res.status(500).json({
            success: false,
            error: "AI analysis failed. Your credits were restored.",
            credits: currentBal
        });
    } finally {
        releaseUserConcurrencyLock(uid);
    }
});

// 2. ICEBREAKER GENERATOR (Direct qwen3-235b-a22b-2507)
app.post('/api/icebreaker', requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {
    const uid = getUserIdFromReq(req);
    if (!acquireUserConcurrencyLock(uid)) {
        return res.status(429).json({ success: false, error: "A generation is already in progress for your account. Please wait for it to complete." });
    }
    const reqId = req.headers['x-idempotency-key'] || (req.body && req.body.idempotencyKey) || ('ice_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    let deduction = null;

    try {
        let { text, bioText, messages } = req.body || {};
        const textCheck = String(bioText || text || (messages && messages[0] ? messages[0].content : "") || "");
        if (textCheck.length > 5000) {
            return res.status(400).json({
                success: false,
                error: "Your message is too long. Maximum: 5,000 characters."
            });
        }

        deduction = await verifyAndDeductCreditsDB(req, 10, 'icebreaker', reqId);
        if (!deduction.success) {
            if (deduction.profileMissing) {
                return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
            }
            if (deduction.serviceUnavailable) {
                return res.status(503).json({
                    success: false,
                    error: deduction.error || "Credit service temporarily unavailable. Please try again."
                });
            }
            if (deduction.unauthenticated) {
                return res.status(401).json({
                    success: false,
                    error: deduction.error || "Authentication required to use this feature."
                });
            }
            return res.status(402).json({
                success: false,
                error: "Insufficient credits. Please purchase credits to use this feature.",
                credits: deduction.currentCredits
            });
        }

        if (deduction.duplicate === true) {
            return res.status(409).json({
                success: false,
                error: "This request ID has already been processed or is already in progress. No additional credits were deducted.",
                code: "DUPLICATE_REQUEST",
                duplicate: true,
                credits: deduction.remainingCredits
            });
        }

        const bodyData = req.body || {};
        let tone = bodyData.tone;
        let shorthandOption = bodyData.shorthandOption;
        let emojiOption = bodyData.emojiOption;
        let textVal = text || bioText || "";
        if (typeof text === 'string' && text.includes('FORCE_REFUND_TEST')) {
            throw new Error('Simulated AI Provider Network Failure');
        }
        const useShorthand = shorthandOption !== false;
        const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;

        if (!text && messages && messages.length > 0) {
            const userMsg = messages.find(m => m.role === 'user');
            text = userMsg ? userMsg.content : "";

            const systemMsg = messages.find(m => m.role === 'system');
            if (systemMsg && systemMsg.content) {
                const match = systemMsg.content.match(/vibe:\s*([^\.]+)/i);
                tone = match ? match[1].trim() : "Direct";
            }
        }

        text = enforceWordLimit(text, 500);

        let formattingRule = useShorthand 
            ? "FORMAT: Fully lowercase text, max 12 words per option, zero formal punctuation." 
            : "FORMAT: Standard sentence capitalization and punctuation, max 12 words per option.";

        if (emojiLevel === 0) {
            formattingRule += " Zero emojis.";
        } else if (emojiLevel === 2) {
            formattingRule += " Include 2 to 3 expressive emojis per option.";
        } else {
            formattingRule += " Max 1 emoji per option at the very end.";
        }

        const icebreakerSystemPrompt = `You are an Elite Social Attraction Strategist and High-Status Dating Coach.
Analyze the provided match details (bio, interests, or profile info) and generate EXACTLY 10 distinct opening lines matching the requested tone (Witty, Flirty, Casual, Direct / Bold, Closer).

--------------------------------------------------------------------------------
MODE: DIRECT / BOLD — HIGH-STATUS FRAME CONTROL
--------------------------------------------------------------------------------
- CORE VIBE: High-status confidence, playful challenge, direct frame control, zero validation-seeking.
- REQUIRED MECHANICS:
  • Turn hostile or cynical bio statements (e.g. "i hate men", "i hate mens", "no guys allowed", "don't waste my time") into direct personal challenges or fun qualifications.
  • Maintain an unbothered, high-value tone (as if YOU are evaluating HER, not begging for her approval).

- ABSOLUTE NEGATIVE CONSTRAINTS (HARD BANNED PATTERNS):
  1. NEVER ask for permission, approval, or validation (FORBIDDEN: "do I stand a chance?", "would you give me a shot?", "can I get a chance?", "am I your type?").
  2. NEVER use cliché "Nice Guy" tropes (FORBIDDEN: "I'm not like other guys", "good thing I'm different", "I'm one of the good ones", "let me change your mind").
  3. NEVER apologize or act defensive about being a guy.
  4. NEVER append trailing index numbers, zero flags, or technical metadata.

- HIGH-STATUS DIRECT EXAMPLES FOR HOSTILE/CYNICAL BIOS:
  • Bio: "i hate men" / "i hate mens"
  • ✅ Good Direct Lines:
    - "interesting take — care to test me?"
    - "all men or just the ones who say 'i'm not like other guys'?"
    - "you hate men but what about me specifically?"
    - "bold claim. let's see if you can hold that standard in person."

--------------------------------------------------------------------------------
UNIVERSAL BATCH DIVERSITY LAW
--------------------------------------------------------------------------------
When generating an array/batch of output options for a single user request:
1. EVERY option in the batch MUST use a strictly distinct:
   - Sentence length & rhythm (e.g., Option 1: 4-6 words, Option 2: 8-12 words, Option 3: 14+ words).
   - Opening hook & lead-in prefix (NO TWO options may share the same first 2 words).
   - Ending format (e.g., Option 1: Open question, Option 2: Statement/No question, Option 3: This-or-That debate).

2. ABSOLUTE REPETITION BAN:
   - Maximum ONE option per batch can start with "so uh...", "noted...", "wait you...", or "good thing...".

--------------------------------------------------------------------------------
GENERAL ICEBREAKER LAWS:
--------------------------------------------------------------------------------
1. NO BORING OPENERS: Banned: "hey how are you", "how's your week", "nice profile", "what brings you here".
2. NO CREEPY / POETIC PHRASING: Avoid romantic poetry, Wattpad villain tropes, or intense lines ("stolen glances", "destiny", "pushing boundaries").
3. TONE EXECUTIONS:
   - Witty: Playful observational banter or light teasing based on their details.
   - Flirty: Smooth, witty charm with a subtle spark.
   - Casual: Low-pressure, easy conversation starter.
   - Direct / Bold: High-status confidence, direct callout, or playful challenge.
   - Closer: Smooth line designed to transition into planning a quick coffee/drink date.
4. ${formattingRule}`;

        const responseText = await queryOpenRouter("qwen3-235b-a22b-2507", [
            { role: "system", content: icebreakerSystemPrompt },
            { role: "user", content: `Match Details: "${text}". Requested Tone: ${tone || "Direct"}. Output the 10 numbered options now.` }
        ], 0.8, 650, 25000);

        let rawOptions = (responseText || "").split(/(?:^|\n)\d+[\.\)\:]\s*/).filter(s => s.trim().length > 0);
        if (rawOptions.length === 0) {
            rawOptions = (responseText || "").split(/\n+/).filter(s => s.trim().length > 0);
        }

        let cleanedOptions = rawOptions.map(opt => {
            let cleaned = opt.replace(/^\[?ICEBREAKER_OPTION_\d+\]?\s*/i, '')
                             .replace(/^Option\s*\d+[\:\.\-]?\s*/i, '')
                             .replace(/[\s0-9]+$/, '') // ROOT PURGE OF TRAILING '0' / NUMBERS
                             .trim();

            // Negative constraint checks
            cleaned = cleaned.replace(/\b(?:do i stand a chance|give me a shot|can i get a chance)\b/gi, 'let\'s see if you can handle this');
            cleaned = cleaned.replace(/\b(?:i'm not like other guys|good thing i'm different|one of the good ones)\b/gi, 'care to test that theory');

            if (emojiLevel === 0) {
                try {
                    cleaned = cleaned.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), '').trim();
                } catch(e) {
                    cleaned = cleaned.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();
                }
            } else if (emojiLevel === 1) {
                const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu;
                let count = 0;
                cleaned = cleaned.replace(emojiRegex, (match) => {
                    count++;
                    return count === 1 ? match : '';
                });
            }

            return applyFormattingRules(cleaned, useShorthand, emojiLevel);
        });

        cleanedOptions = enforceUniqueQuestionAnchors(enforceStructuralBatchDiversity(cleanedOptions, "icebreaker"));
        if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {
            console.log("[ICEBREAKER CLEAN OUTPUT]:", cleanedOptions);
        }

        try {
            const currentUserId = getUserIdFromReq(req);
            if (db && currentUserId) {
                const iceId = 'ice_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
                const rls = forRequest(req, db);
                await rls.create('saved_icebreakers', ['id', 'bio_text', 'vibe', 'generated_options'], [iceId, String(text).substring(0, 1000), tone || "Direct", JSON.stringify(cleanedOptions)]);
            }
        } catch (dbErr) {
            console.error("Database insert error (Icebreaker):", dbErr);
        }

        if (!cleanedOptions || !Array.isArray(cleanedOptions) || cleanedOptions.length === 0) {
            throw new Error("Icebreaker generation failed: AI provider returned empty options.");
        }

        const formattedText = cleanedOptions.map((opt, i) => `${i + 1}. ${opt}`).join("\n");

        const settleResult = await settleCreditsDB(req, reqId);
        if (!settleResult || !settleResult.success) {
            console.error(`[Ledger Error] Failed to settle credits for icebreaker reqId ${reqId}:`, settleResult ? settleResult.error : "Unknown");
            return res.status(503).json({
                success: false,
                error: `Transaction completion error (Ref: ${reqId}). Your credit balance may need reconciliation. Please refresh or contact support.mywingman@gmail.com.`,
                reqId: reqId
            });
        }

        res.json({
            success: true,
            text: formattedText,
            options: cleanedOptions,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Icebreaker breakdown:", error.message);
        let currentBal = deduction ? deduction.remainingCredits : 0;
        let releaseSucceeded = false;
        if (deduction && deduction.success && !deduction.duplicate) {
            const relRes = await releaseCreditsDB(req, reqId, error.message);
            if (relRes && relRes.success) {
                releaseSucceeded = true;
                if (typeof relRes.remainingCredits === 'number') {
                    currentBal = relRes.remainingCredits;
                }
            }
        }
        if (deduction && deduction.success && !deduction.duplicate && !releaseSucceeded) {
            return res.status(500).json({
                success: false,
                error: `Icebreaker generation failed and credit release could not be confirmed (Ref: ${reqId}). Please refresh your balance or contact support.mywingman@gmail.com.`,
                reqId: reqId,
                credits: deduction.currentCredits
            });
        }
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({
                success: false,
                error: "Icebreaker generation timed out. Your credits were restored.",
                credits: currentBal
            });
        }
        res.status(500).json({
            success: false,
            error: "Icebreaker generation failed. Your credits were restored.",
            credits: currentBal
        });
    } finally {
        releaseUserConcurrencyLock(uid);
    }
});

function sanitizeBioInput(rawInput) {
    if (!rawInput || typeof rawInput !== "string") {
        return "Loves late-night drives, gym sessions, finding 24-hour diners, and good coffee.";
    }

    let cleaned = rawInput.trim();

    // 1. Strip names, greetings, and intro fluff
    cleaned = cleaned.replace(/^(hello|hi|hey|greetings)?\s*(my\s+name\s+is|i\s+am|i'm)\s+[a-z0-9_-]+\s*(,|and|\.)?\s*/gi, '');
    cleaned = cleaned.replace(/^(hello|hi|hey)\s+(my\s+name\s+is)\s*/gi, '');
    cleaned = cleaned.replace(/^(just\s+)?downloaded\s+(hinge|tinder|bumble)\s*(and)?\s*/gi, '');
    cleaned = cleaned.replace(/i am a playboy/gi, 'confident and outgoing');

    // 2. Grammar Cleanup (Fix broken verb forms & user typos)
    cleaned = cleaned.replace(/\bi\s+rides\b/gi, 'riding');
    cleaned = cleaned.replace(/\bi\s+goes\b/gi, 'going');
    cleaned = cleaned.replace(/\bi\s+plays\b/gi, 'playing');
    cleaned = cleaned.replace(/\bi\s+likes\b/gi, 'likes');
    cleaned = cleaned.replace(/\bme\s+likes\b/gi, 'likes');
    cleaned = cleaned.replace(/\bi\s+loves\b/gi, 'loves');

    // 3. Demographic & Cultural Isolation Law (US / Western Lock)
    cleaned = cleaned.replace(/\bdhaba(s)?\b/gi, '24-hour diner');
    cleaned = cleaned.replace(/\b(pani puri|vada pav|samosa(s)?|dosa(s)?|paratha(s)?)\b/gi, 'taco truck snacks');
    cleaned = cleaned.replace(/\bchai tapri\b/gi, 'local coffee spot');
    cleaned = cleaned.replace(/\bauto(s)?\b/gi, 'rideshare');
    cleaned = cleaned.replace(/\broorkee\b/gi, 'hometown');
    cleaned = cleaned.replace(/\bmonsoon(s)?\b/gi, 'rainy days');

    // 4. Spelling & Typo Corrections
    cleaned = cleaned.replace(/threaters|threatre|theaters/gi, 'theater');
    cleaned = cleaned.replace(/\bbikes\b/gi, 'biking and motorcycle road trips');
    cleaned = cleaned.replace(/apple is my (favaortae|favorite) fruit/gi, 'fan of late-night snacks and good food');
    cleaned = cleaned.replace(/favaortae/gi, 'favorite');

    if (cleaned.length < 2) {
        return "Loves late-night drives, gym sessions, finding 24-hour diners, and good coffee.";
    }
    return cleaned;
}

function fixGrammarAndTypoLeaks(text) {
    if (!text || typeof text !== 'string') return text;
    let cleaned = text;
    cleaned = cleaned.replace(/\bme\s+likes\b/gi, 'i like');
    cleaned = cleaned.replace(/\bi\s+is\b/gi, 'i am');
    cleaned = cleaned.replace(/^(hello|hi|hey|greetings)?\s*(my\s+name\s+is|i\s+am|i'm)\s+[a-z0-9_-]+\s*(,|and|\.)?\s*/gi, '');
    cleaned = cleaned.replace(/settle this[\:\,\s]*/gi, 'real question: ');
    return cleaned;
}

function formatBioLineBreaks(biosArray) {
    if (!Array.isArray(biosArray)) return biosArray;
    
    const questionRegex = /(real question:|would you rather|what's your move|this or that|settle this|honest debate|pick a side|tell me:|yes or no:|what's your pick:|where do you stand:)/i;
    
    return biosArray.map((bio) => {
        if (typeof bio !== 'string') return bio;
        
        let formatted = bio.trim();

        // Fact Anchoring Safety Net: Purge banned hallucinated topics
        formatted = formatted.replace(/\b(synthwave|traffic cones|balling|sunrise laps)\b/gi, '');
        
        // 1. If an em-dash (—) precedes a question lead-in, convert it to a new line
        formatted = formatted.replace(/\s*—\s*(real question:|would you rather|what's your move|this or that|settle this|honest debate|pick a side|tell me:|yes or no:|what's your pick:|where do you stand:)/gi, '\n\n$1');
        
        // 2. Ensure any question lead-in or closing question starts on a fresh line if not already
        if (!formatted.includes('\n')) {
            formatted = formatted.replace(/\s+(real question:|would you rather|what's your move|this or that|settle this|honest debate|pick a side|tell me:|yes or no:|what's your pick:|where do you stand:)/gi, '\n\n$1');
        }

        // 3. Guarantee Question is LAST: If lifestyle text was appended AFTER the question, re-order
        if (formatted.includes('\n\n')) {
            const parts = formatted.split(/\n\n+/);
            if (parts.length >= 2) {
                if (questionRegex.test(parts[0]) && !questionRegex.test(parts[parts.length - 1])) {
                    const qPart = parts.shift();
                    parts.push(qPart);
                    formatted = parts.join('\n\n');
                }
            }
        }
        
        return formatted;
    });
}

// 3. PROFILE BIO OPTIMIZER (/api/optimize & /api/bio-optimizer)
app.post(['/api/optimize', '/api/bio-optimizer'], requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {
    const uid = getUserIdFromReq(req);
    if (!acquireUserConcurrencyLock(uid)) {
        return res.status(429).json({ success: false, error: "A generation is already in progress for your account. Please wait for it to complete." });
    }
    const reqId = req.headers['x-idempotency-key'] || (req.body && req.body.idempotencyKey) || ('opt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    let deduction = null;

    try {
        let { text, bioText, messages } = req.body || {};
        const rawText = String(text || bioText || (messages && messages[0] ? messages[0].content : "") || "");
        
        if (rawText.trim().length < 5) {
            return res.status(400).json({
                success: false,
                error: "Bio text is required (minimum 5 characters)."
            });
        }

        const wordCount = countWords(rawText);
        if (wordCount > 500) {
            return res.status(400).json({
                success: false,
                error: `Your bio exceeds the 500-word limit (${wordCount} words entered). Maximum allowed: 500 words.`
            });
        }

        deduction = await verifyAndDeductCreditsDB(req, 10, 'optimize', reqId);
        if (!deduction.success) {
            if (deduction.profileMissing) {
                return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
            }
            if (deduction.serviceUnavailable) {
                return res.status(503).json({
                    success: false,
                    error: deduction.error || "Credit service temporarily unavailable. Please try again."
                });
            }
            if (deduction.unauthenticated) {
                return res.status(401).json({
                    success: false,
                    error: deduction.error || "Authentication required to use this feature."
                });
            }
            return res.status(402).json({
                success: false,
                error: "Insufficient credits. Please purchase credits to use this feature.",
                credits: deduction.currentCredits
            });
        }

        if (deduction.duplicate === true) {
            return res.status(409).json({
                success: false,
                error: "This request ID has already been processed or is already in progress. No additional credits were deducted.",
                code: "DUPLICATE_REQUEST",
                duplicate: true,
                credits: deduction.remainingCredits
            });
        }

        let tone = req.body.tone;
        let style = req.body.style;
        let shorthandOption = req.body.shorthandOption;
        let emojiOption = req.body.emojiOption;
        const requestedStyle = tone || style || "Punchy";
        const useShorthand = shorthandOption !== false;
        const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;

        if (!text && messages && messages.length > 0) {
            const userMsg = messages.find(m => m.role === 'user');
            text = userMsg ? userMsg.content : "";

            const systemMsg = messages.find(m => m.role === 'system');
            if (systemMsg && systemMsg.content) {
                const match = systemMsg.content.match(/style:\s*([^\.]+)/i);
                tone = match ? match[1].trim() : requestedStyle;
            }
        }

        const sanitizedText = sanitizeBioInput(text || rawText);
        const textPayload = sanitizedText;

        let casingInstruction = useShorthand ? "natural, lowercase-heavy casing" : "standard sentence capitalization";
        let emojiInstruction = emojiLevel === 0 ? "ZERO emojis under any circumstances." : (emojiLevel === 2 ? "2 to 3 expressive emojis" : "1-2 tasteful emojis");

        let modeKey = 'Green Flag';
        const styleLower = (requestedStyle || "").toLowerCase();
        if (styleLower.includes('punchy')) modeKey = 'Punchy';
        else if (styleLower.includes('playful')) modeKey = 'Playful';
        else if (styleLower.includes('mysterious')) modeKey = 'Mysterious';
        else if (styleLower.includes('green')) modeKey = 'Green Flag';

        const MODE_PROMPTS = BIO_MODE_PROMPTS;
        const selectedModeRules = MODE_PROMPTS[modeKey] || MODE_PROMPTS['Green Flag'];

        const bioOptimizerSystemPrompt = `You are an elite US/Western dating profile strategist for Tinder, Hinge, and Bumble.

${TARGET_MARKET_LOCK}

--------------------------------------------------------------------------------
2. OUTPUT FORMAT & SLOT MATRIX
--------------------------------------------------------------------------------
You MUST respond with valid JSON strictly matching this schema with EXACTLY 10 options:
{
  "options": [
    "Full bio option 1 string matching Slot 1 Choice Debate format",
    "Full bio option 2 string matching Slot 2 Observational format",
    "Full bio option 3 string matching Slot 3 Story Scenario format",
    "Full bio option 4 string matching Slot 1 Choice Debate format",
    "Full bio option 5 string matching Slot 2 Observational format",
    "Full bio option 6 string matching Slot 3 Story Scenario format",
    "Full bio option 7 string matching Slot 1 Choice Debate format",
    "Full bio option 8 string matching Slot 2 Observational format",
    "Full bio option 9 string matching Slot 3 Story Scenario format",
    "Full bio option 10 string matching Slot 1 Choice Debate format"
  ]
}

ACTIVE MODE FIREWALL RULES:
${selectedModeRules}

GLOBAL TONE & SYNTAX RULES:
1. RESULT COUNT LAW: You MUST generate EXACTLY 10 distinct options in the "options" JSON array.
2. FACT ANCHORING LAW: Stay STRICTLY rooted in the user's provided input facts. NEVER invent unrelated hobbies, music genres, sports, or random objects (BANNED: synthwave, traffic cones, balling, sunrise laps).
3. 70/30 RATIO & STRUCTURAL ORDER LAW:
   - Bio Body = 70% of total length (cool, high-status 2-line lifestyle statement).
   - Closing Question = 30% of total length (short, punchy 1-liner, max 6-8 words).
   - ALWAYS format as: Bio Body on Line 1-2 -> \n\n -> Closing Question on Line 3.
   - NEVER place the question at the top or append lifestyle text after the question!
4. ABSOLUTE BAN ON "SETTLE THIS": The phrase "settle this" or "settle this:" is STRICTLY BANNED FOREVER. NEVER output the words "settle this" under any circumstances.
5. SYNTAX VARIETY LAW (CRITICAL): NEVER use the exact same lead-in phrase (e.g., "real question:", "ask me about", "would you rather") across more than ONE option in a batch. Vary the opening structure for EVERY option.
6. UNIVERSAL BATCH DIVERSITY LAW:
   - EVERY option in the batch MUST use a strictly distinct sentence length & rhythm, opening hook & lead-in prefix (NO TWO options may share the same first 2 words), and ending format.
   - Maximum ONE option per batch can start with anchor phrases like "ask me about...", "usually found...", or "when i'm not...".
7. NATURAL HUMAN FLOW: Connect user hobbies using organic transitions ("usually", "when I'm not", "along with", "split between").
8. ABSOLUTE BAN ON TEMPLATE COUPLETS (STRICTLY BANNED):
   • BANNED: "football field by habit, motorcycle trails by obsession"
   • BANNED: "X by day, Y by night"
   • BANNED: "X for the [noun], Y for the [noun]"
9. ABSOLUTE BAN ON GATEKEEPING & ELITISM: Never use negative parentheticals or elitist exclusions.
10. SILENT TYPO & GREETING STRIPPING: Strip out all generic greetings ("hi my name is", "hello i am") and fix user typos silently.
11. EMOJI CONSTRAINT: Include at most ONE single emoji per option string. NEVER stack emojis. ${emojiInstruction}

FORMATTING: Use ${casingInstruction}.`;

        let responseText = await queryOpenRouter("qwen3-235b-a22b-2507", [
            { role: "system", content: bioOptimizerSystemPrompt },
            { role: "user", content: `[SELECTED MODE: ${modeKey.toUpperCase()}]\n[USER INPUT: "${textPayload}"]` }
        ], 0.25, 1200, 25000, 0.80);

        let optionsList = [];
        try {
            const jsonMatch = (responseText || "").match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed && Array.isArray(parsed.options) && parsed.options.length > 0) {
                    optionsList = parsed.options;
                }
            }
        } catch(e) {
            console.warn("JSON parse fallback in Bio Optimizer:", e.message);
        }

        if (!optionsList || optionsList.length === 0) {
            optionsList = (responseText || "").split(/(?:^|\n)\d+[\.\)\:]\s*/).filter(s => s.trim().length > 0);
        }

        // DETERMINISTIC BACKEND SANITIZER & ANCHOR DE-DUPLICATION LAYER
        let settleThisCount = 0;
        let askMeAboutCount = 0;

        optionsList = optionsList.map(optionText => {
            let cleaned = optionText.trim().replace(/^Option\s*\d+[\:\.\-]?\s*/i, "");
            
            // Clean template couplets and negative parentheticals deterministically
            cleaned = cleaned.replace(/([^\,\.\n]+)\s+by habit[,\s]*([^\,\.\n]+)\s+by obsession/gi, '$1 and $2');
            cleaned = cleaned.replace(/([^\,\.\n]+)\s+by day[,\s]*([^\,\.\n]+)\s+by night/gi, '$1 and $2');
            cleaned = cleaned.replace(/\([^\)]*no\s+pop\s+playlists[^\)]*\)/gi, '');
            cleaned = cleaned.replace(/\([^\)]*no\s+fast\s+food[^\)]*\)/gi, '');
            cleaned = cleaned.replace(/don't swipe if[^\.\,\n]*/gi, '');

            // Demographic & Cultural Isolation Law Safety Net (US / Western Lock)
            cleaned = cleaned.replace(/\bdhaba(s)?\b/gi, '24-hour diner');
            cleaned = cleaned.replace(/\b(pani puri|vada pav|samosa(s)?|dosa(s)?|paratha(s)?)\s*(roll|run)?\b/gi, 'taco truck run');
            cleaned = cleaned.replace(/\bchai tapri\b/gi, 'coffee spot');
            cleaned = cleaned.replace(/\bchai\b/gi, 'coffee');
            cleaned = cleaned.replace(/\bauto(s)?\b/gi, 'rideshare');
            cleaned = cleaned.replace(/\broorkee\b/gi, 'hometown');
            cleaned = cleaned.replace(/\bmonsoon(s)?\b/gi, 'rainy days');

            // ABSOLUTE UNCONDITIONAL PURGE OF "settle this" FOREVER
            if (/settle this/i.test(cleaned)) {
                const dynamicRepls = ['real question: ', 'this or that: ', 'pick a side: ', 'honest debate: ', 'quick question: '];
                const repl = dynamicRepls[settleThisCount % dynamicRepls.length];
                settleThisCount++;
                cleaned = cleaned.replace(/settle this[\:\,\s]*/gi, repl);
            }

            if (/ask me about/i.test(cleaned)) {
                askMeAboutCount++;
                if (askMeAboutCount > 1) {
                    const replacements = ['curious about ', 'remind me to tell you about ', 'ever heard about ', 'the story behind '];
                    const randRepl = replacements[(askMeAboutCount - 2) % replacements.length];
                    cleaned = cleaned.replace(/ask me about\s*/gi, randRepl);
                }
            }

            // Post-generation Grammar & Typo Safety Net: Fix any surviving raw grammar leaks
            cleaned = cleaned.replace(/\bi\s+rides\s+bike(s)?\b/gi, 'i ride my bike');
            cleaned = cleaned.replace(/\bi\s+rides\b/gi, 'i ride');
            cleaned = cleaned.replace(/\bi\s+goes\b/gi, 'i go');
            cleaned = cleaned.replace(/\bi\s+plays\b/gi, 'i play');
            cleaned = cleaned.replace(/\bme\s+likes\b/gi, 'i like');

            // Fix random mid-sentence capitalizations
            cleaned = fixMidSentenceCapitalization(cleaned);

            // Strict Deterministic Emoji Sanitizer
            if (emojiLevel === 0) {
                try {
                    cleaned = cleaned.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), '').trim();
                } catch(e) {
                    cleaned = cleaned.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();
                }
            } else if (emojiLevel === 1) {
                const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])/gu;
                const matches = cleaned.match(emojiRegex);
                if (matches && matches.length > 1) {
                    let emojiCount = 0;
                    cleaned = cleaned.replace(emojiRegex, (match) => {
                        emojiCount++;
                        return emojiCount === 1 ? match : '';
                    });
                }
            }

            cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
            cleaned = cleaned.replace(/\n+/g, '\n\n');
            return applyFormattingRules(cleaned, useShorthand, emojiLevel);
        });

        optionsList = enforceUniqueQuestionAnchors(enforceStructuralBatchDiversity(optionsList, "bio"));
        optionsList = optionsList.map(opt => fixGrammarAndTypoLeaks(opt));
        optionsList = formatBioLineBreaks(optionsList);
        const formattedText = optionsList.map((opt, i) => `${i + 1}. ${opt}`).join("\n\n");

        try {
            const currentUserId = getUserIdFromReq(req);
            if (db && currentUserId) {
                const bioId = 'bio_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
                // RLS Engine: user_id is forced to the server-validated uid (client cannot set owner).
                const rls = forRequest(req, db);
                await rls.create('saved_bios', ['id', 'original_bio', 'mode', 'generated_options'], [bioId, String(req.body.bioText).substring(0, 1000), req.body.style || "Punchy", JSON.stringify(optionsList)]);
            }
        } catch (dbErr) {
            console.error("Database insert error (Bio):", dbErr);
        }

        if (!optionsList || !Array.isArray(optionsList) || optionsList.length === 0) {
            throw new Error("Bio optimization failed: AI provider returned empty options.");
        }

        const settleResult = await settleCreditsDB(req, reqId);
        if (!settleResult || !settleResult.success) {
            console.error(`[Ledger Error] Failed to settle credits for bio reqId ${reqId}:`, settleResult ? settleResult.error : "Unknown");
            return res.status(503).json({
                success: false,
                error: `Transaction completion error (Ref: ${reqId}). Your credit balance may need reconciliation. Please refresh or contact support.mywingman@gmail.com.`,
                reqId: reqId
            });
        }

        res.json({
            success: true,
            options: optionsList,
            text: formattedText,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Bio optimizer breakdown:", error.message);
        let currentBal = deduction ? deduction.remainingCredits : 0;
        let releaseSucceeded = false;
        if (deduction && deduction.success && !deduction.duplicate) {
            const relRes = await releaseCreditsDB(req, reqId, error.message);
            if (relRes && relRes.success) {
                releaseSucceeded = true;
                if (typeof relRes.remainingCredits === 'number') {
                    currentBal = relRes.remainingCredits;
                }
            }
        }
        if (deduction && deduction.success && !deduction.duplicate && !releaseSucceeded) {
            return res.status(500).json({
                success: false,
                error: `Bio optimization failed and credit release could not be confirmed (Ref: ${reqId}). Please refresh your balance or contact support.mywingman@gmail.com.`,
                reqId: reqId,
                credits: deduction.currentCredits
            });
        }
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({
                success: false,
                error: "Bio optimization timed out. Your credits were restored.",
                credits: currentBal
            });
        }
        res.status(500).json({
            success: false,
            error: "Bio optimization failed. Your credits were restored.",
            credits: currentBal
        });
    } finally {
        releaseUserConcurrencyLock(uid);
    }
});

// 4. MAEVE AI DATING COACH & EVALUATOR CHAT (/api/chat & /api/simulator/chat)
app.post(['/api/chat', '/api/simulator/chat'], requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {
    const reqId = req.headers['x-idempotency-key'] || (req.body && req.body.idempotencyKey) || ('chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    let deduction = null;

    try {
        let { message, userMessage, messages, conversationHistory, sessionHistory } = req.body || {};
        const rawUserMsg = message || userMessage || (messages && messages.length > 0 ? messages[messages.length - 1].content : "");

        if (typeof rawUserMsg === 'string' && rawUserMsg.length > 5000) {
            return res.status(400).json({
                success: false,
                error: "Your message is too long. Maximum: 5,000 characters."
            });
        }

        let historyArr = Array.isArray(conversationHistory) ? conversationHistory : (Array.isArray(sessionHistory) ? sessionHistory : (Array.isArray(messages) ? messages : []));
        
        // Cap message history to latest 50 messages max
        if (historyArr.length > 50) {
            historyArr = historyArr.slice(-50);
        }

        // Validate individual message structure and allowed roles
        const ALLOWED_ROLES = ['user', 'assistant', 'system'];
        for (let i = 0; i < historyArr.length; i++) {
            const m = historyArr[i];
            if (!m || typeof m !== 'object') {
                return res.status(400).json({ success: false, error: "Invalid message format in conversation history." });
            }
            if (m.role && !ALLOWED_ROLES.includes(m.role)) {
                return res.status(400).json({ success: false, error: `Invalid message role '${m.role}' in conversation history.` });
            }
            const msgContent = m.content || m.text;
            if (typeof msgContent === 'string' && msgContent.length > 5000) {
                return res.status(400).json({ success: false, error: "Individual history message exceeds 5,000 character limit." });
            }
        }

        const totalContextLength = historyArr.reduce((acc, m) => acc + (typeof (m.content || m.text) === 'string' ? (m.content || m.text).length : 0), 0) + (typeof rawUserMsg === 'string' ? rawUserMsg.length : 0);

        if (totalContextLength > 50000) {
            return res.status(400).json({
                success: false,
                error: "Your conversation has reached the maximum context size."
            });
        }

        deduction = await verifyAndDeductCreditsDB(req, 2, 'chat', reqId);
        if (!deduction.success) {
            if (deduction.profileMissing) {
                return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
            }
            if (deduction.serviceUnavailable) {
                return res.status(503).json({
                    success: false,
                    error: deduction.error || "Credit service temporarily unavailable. Please try again."
                });
            }
            if (deduction.unauthenticated) {
                return res.status(401).json({
                    success: false,
                    error: deduction.error || "Authentication required to use this feature."
                });
            }
            return res.status(402).json({
                success: false,
                error: "Insufficient credits. Please purchase credits to use this feature.",
                credits: deduction.currentCredits
            });
        }

        if (deduction.duplicate === true) {
            return res.status(409).json({
                success: false,
                error: "This request ID has already been processed or is already in progress. No additional credits were deducted.",
                code: "DUPLICATE_REQUEST",
                duplicate: true,
                credits: deduction.remainingCredits
            });
        }

        const { mode, scenario, shorthandOption, emojiOption } = req.body || {};
        const currentScenario = scenario || "Flirting & Teasing";
        const useShorthand = shorthandOption !== false;
        const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;
        const isHotline = mode === "hotline" || currentScenario === "Coach Hotline";

        const userTextRaw = message || userMessage || (messages && messages.length > 0 ? messages[messages.length - 1].content : "");
        const userText = (userTextRaw || "").toLowerCase().trim();

        if (isHotline) {
            const hotlineSystemPrompt = `You are Maeve—an elite, direct, and supportive Dating & Communication Coach.
The user is in Coach Hotline (Ask Anything) mode to freely discuss texting, dating strategy, message drafts, or relationship advice.

CONVERSATIONAL FREEDOM & LAWS:
1. FREE-FORM SUPPORTIVE COACHING: Converse freely, openly, and supportively about any texting question, situation, message draft, or dating advice.
2. NEVER DEMAND AN OPENER OR SCENARIO: Do NOT tell the user "pick a scenario" or "what's your opener".
3. STRICT TEXT-ONLY MEDIA BOUNDARY (NEVER ASK FOR MEDIA): You CANNOT receive, read, view, or process images, screenshots, audio, or video files in this chat interface. You are STRICTLY FORBIDDEN from ever asking or requesting users to upload, send, or share screenshots, photos, images, audio files, or video clips. If a user asks about a chat, screenshot, or draft, instruct them to type out or paste the text directly into the chat box.
4. GREETINGS & SHORT INPUTS ("hi", "?", "hello", "hey"):
   - Respond warmly and conversationally: "Hey! I'm here in Coach Mode. What's on your mind today? You can ask me for texting advice, help drafting a reply, analyzing a text, or dating strategy."
5. ABSOLUTE ZERO FLIRTING IN COACH MODE: Speak directly as a world-class coach. Do NOT roleplay as a dating match, do NOT call the user "cutie" or "babe", and do NOT use flirty emojis (😏, 😉, 😘).
6. HIGH-STATUS, GRAMMATICALLY FLAWLESS TEXT GENERATION (NO TEMPLATE PLACEHOLDERS):
   - ABSOLUTE BAN ON PLACEHOLDER SYNTAX: NEVER output raw meta-text or bracketed instructions inside options (FORBIDDEN: "specific detail: e.g.", "coffee / ramen / live music", "photo/outfit/smile", "[insert name]").
   - Every single generated line MUST be a 100% finished, ready-to-send, grammatically flawless, natural text message.
   - BAN DATED DATING CLICHÉS: Banned: "pineapple on pizza", "we breaking up already", "hey beautiful", "what brings you here".
7. PROPER CAPITALIZATION, CASING & FORMATTING:
   - Use natural sentence-case capitalization.
   - When listing options, advice points, or topics, ALWAYS use clear line breaks (\n\n) and numbered/bulleted lists (\n1. ..., \n2. ...). Never lump multiple points into a single dense wall of text.
   - NEVER output markdown divider lines ("---" or "===").
8. COMPLETE ALL SENTENCES & THOUGHTS: Never cut off mid-sentence or leave questions/points incomplete. Always finish every single sentence cleanly.`;

            let historyArr = req.body.messages || conversationHistory || sessionHistory || [];
            const nonSystemHistory = (historyArr || []).filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.content || m.text || ''
            }));

            const hotlinePayload = [
                { role: "system", content: hotlineSystemPrompt },
                ...nonSystemHistory
            ];
            if (userTextRaw && (!nonSystemHistory.length || nonSystemHistory[nonSystemHistory.length - 1].content !== userTextRaw)) {
                hotlinePayload.push({ role: "user", content: userTextRaw });
            }

            let hotlineAdvice = await queryOpenRouter("qwen3-235b-a22b-2507", hotlinePayload, 0.7, 1500);
            if (!hotlineAdvice) {
                throw new Error("AI Coach endpoint returned empty response.");
            }
            hotlineAdvice = sanitizeResponseText(hotlineAdvice.trim());

            const settleResult = await settleCreditsDB(req, reqId);
            if (!settleResult || !settleResult.success) {
                console.error(`[Ledger Error] Failed to settle credits for hotline reqId ${reqId}:`, settleResult ? settleResult.error : "Unknown");
                return res.status(503).json({
                    success: false,
                    error: `Transaction completion error (Ref: ${reqId}). Your credit balance may need reconciliation. Please refresh or contact support.mywingman@gmail.com.`,
                    reqId: reqId
                });
            }

            return res.json({
                success: true,
                mode: "hotline",
                reply: hotlineAdvice,
                roleplay_response: hotlineAdvice,
                attraction_score: 80,
                attraction_change: 0,
                character_mood: "Coach",
                credits: deduction.remainingCredits
            });
        }

        // Roleplay Drill Scenarios
        const isNonsense = /27|99|clock|alien|asdf|qwerty|blah|xyz|1234|lololol/i.test(userText);
        const isDryResponse = /^(i\s*don'?t\s*know|nothing|idk|ok|k|whatever|dunno|nevermind|nm)$/i.test(userText);
        const isDemandWithoutDetail = /^(i\s*want\s*to\s*meet\s*u|meet\s*me|let'?s\s*meet)$/i.test(userText);

        function getScenarioDirective(scenarioName) {
            const s = (scenarioName || "").toLowerCase();
            if (s.includes("awkward") || s.includes("recovery")) {
                return `ACTIVE DRILL: AWKWARD RECOVERY (THREAD REVIVAL DRILL)
SCENARIO CONTEXT: Maeve previously sent a dry text ('k cool'). The goal is for the user to revive the chat with confidence, storytelling, or playful teasing.
- If user sends dry/low-effort text ("hi", "hm", "ok", "?"): Call out the dry text with playful pushback.
- If user shares a real story or witty tease: React with authentic humor!`;
            }
            if (s.includes("date") || s.includes("setup")) {
                return `ACTIVE DRILL: FIRST DATE SETUP (LEADERSHIP & DECISIVENESS DRILL)
SCENARIO CONTEXT: Practice transitioning casual texting into taking charge and locking in a specific date plan.

STRICT FIRST DATE SETUP LAWS:
1. DEMAND DECISIVENESS & LEADERSHIP:
   - Maeve is roleplaying as a high-value, attractive dating app match who values confidence and initiative.
   - She MUST NOT flatter or reward passive/indecisive answers (e.g. "idk", "u tell me", "you pick", "whatever u want", "i don't care"). NEVER call passive replies "smooth" or plan the date for him.
2. CALL OUT PASSIVITY WITH PLAYFUL TEASING:
   - If the user refuses to choose or make a plan, Maeve MUST call out the lack of initiative (e.g., "wait, point deduction for making me pick the spot!", or "come on, zero favorite spots? u gotta give me at least one option!").
   - If the user continues to be completely passive after being challenged, lower your enthusiasm or challenge him to step up, reflecting how a real high-value match would lose interest in someone who won't lead.
3. REWARD CONFIDENCE & SPECIFIC PLANS:
   - Reward the user ONLY when he takes charge, picks a specific spot/vibe, or proposes a clear day and time (e.g., "Thursday at 8 PM at the espresso bar"). Respond with high energy, witty banter, and enthusiastic engagement!`;
            }

            if (s.includes("deep") || s.includes("connection")) {
                return `ACTIVE DRILL: DEEP CONNECTION (WARM CONCISE MOMENTUM DRILL)
SCENARIO CONTEXT: Practice moving past surface small-talk into meaningful storytelling, passions, 2 AM playlists, hot takes, and intriguing personal topics.

STRICT DEEP CONNECTION LAWS:
1. STRICT TOPIC CONTINUITY (NEVER SWITCH TOPICS ABRUPTLY):
   - You MUST strictly match the active conversation topic from the previous opener/message!
   - If the opener was about a 2 AM playlist / music, STAY ON MUSIC! NEVER jump to food or hot sauce on eggs.
   - If the opener was about food hot takes, stay on food!
2. WARM, CHARMING & MAGNETIC PERSONA (ABSOLUTELY NO RUDENESS OR INSULTS):
   - You MUST be warm, friendly, inviting, and magnetic.
   - NEVER insult the user or call them names (ABSOLUTELY BANNED: "are you too basic to have one", "broken soul", "boring", or insulting their taste).
3. STRICT SHORT WORD LIMIT (MAX 15 TO 20 WORDS / 1 TO 2 SHORT LINES MAX):
   - Keep EVERY response super snappy, concise, and lightweight (max 15-20 words total, 1 to 2 short lines max).
4. MAEVE LEADS EFFORTLESSLY ON SHORT/SIMPLE INPUTS:
   - When the user gives a short or simple reply (e.g., "hi", "hey", "idk", "ok"):
     Say hi back warmly, share a quick 1-line answer matching the ACTIVE thread topic first, and ask an inviting follow-up on that SAME topic.
   - Example (Music Topic):
     User: "hi"
     Maeve: "hey! since u kept me guessing, mine is Midnight City by M83 🎧 what's your go-to late night track?"
5. STRICT EMOJI BAN & FREQUENCY:
   - Completely BANNED from using the 😜 emoji.
   - Use at most ONE emoji per response.
6. STRICT ISOLATION: Maintain this warm, concise, magnetic posture ONLY in Deep Connection mode.`;
            }
            return `ACTIVE DRILL: FLIRTING & TEASING (HIGH-STATUS BANTER & SUBJECT CONSISTENCY DRILL)
SCENARIO CONTEXT: Practice building playful tension, high-status confidence, and witty banter.

STRICT FLIRTING & TEASING LAWS:
1. SUBJECT CONSISTENCY RULE:
   - Maintain absolute consistency regarding who owns what trait or habit during banter!
   - If you establish that an attribute belongs to YOU (e.g., YOUR coffee addiction, YOUR sleep schedule), NEVER mistakenly attribute it to the user in follow-up messages unless they explicitly state they share it.
2. NO EMOJI STACKING:
   - Never place two or more emojis next to each other (e.g., BANNED: 😜💥, 🤩🔥). Use at most ONE single emoji per message.
3. WIDE EMOJI VARIETY:
   - Choose naturally from a diverse pool of playful, flirty, and expressive emojis (e.g., 😏, 👀, ☕, ✨, 💅, 😇, 🤫, 🎯, 🙈, 🌙, 😈, 🥂, 💭, 😼). Do NOT repeat the same emoji across consecutive turns.
4. EMOJI FREQUENCY:
   - Limit emoji usage to 1 emoji every 2-3 messages to keep the texting rhythm natural and human. Most messages should contain zero or one emoji.
5. COMPLETE SENTENCE INTEGRITY:
   - Output complete, natural sentences with clean endings. Never leave thoughts truncated or cut off mid-phrase.`;
        }

        if (!historyArr || historyArr.length === 0) {
            historyArr = (req.body && req.body.messages) || conversationHistory || sessionHistory || [];
        }
        const nonSystemHistory = (historyArr || []).filter(m => m.role !== 'system').map(m => {
            let textVal = m.content || m.text || "";
            textVal = textVal.replace(/(showtunes|alien time|27 o'clock|spill the tea|spill tea)/gi, "tease me for my dry text");
            if (m.role === 'user') {
                textVal = enforceWordLimit(textVal, 500);
            }
            return { role: m.role === 'assistant' ? 'assistant' : 'user', content: textVal };
        });

        const hasHistory = nonSystemHistory && nonSystemHistory.length > 0;

        const scenarioDirective = getScenarioDirective(currentScenario);
        const datingCoachSystemPrompt = `${MAEVE_SYSTEM_PROMPT}

Active Scenario: ${currentScenario}

${scenarioDirective}

CRITICAL MAEVE PERSONA & DIALOGUE LAWS:
1. ROLEPLAY DRILL OUTPUT LENGTH LAW: Maximum 1 to 2 short sentences MAX (Strict limit: 15–25 words total). Never write long paragraphs or double-barreled questions.
2. GREETING PURGE: ${hasHistory ? "THERE IS EXISTING CONVERSATION HISTORY. YOU ARE STRICTLY FORBIDDEN FROM SAYING 'HEY', 'HI', OR 'HEY THERE'. Jump straight into your response!" : "This is turn 1. You may use a short warm greeting."}
3. BANNED CLICHÉS: NEVER mention pizza toppings, pineapple on pizza, cereal with a fork, fries with a knife, or food trivia.
4. REALISTIC STANDARDS & WARM LEADERSHIP: Apply the Dry-Input Warm Leadership Protocol whenever user input is dry/short.
5. DATE PACING & REWARD: Require 3 to 5 turns of genuine banter before agreeing to a date.
6. NATURAL MODERN TEXTING: Snappy, concise Gen Z text (1 to 2 short lines max, lowercase-heavy, natural emojis).
7. STRICT CONVERSATIONAL CONTINUITY: Read conversation history and build on the active topic.
8. STRICT TEXT-ONLY MEDIA BOUNDARY: You CANNOT receive or process images/videos.
9. NEVER refer to yourself as an AI or coach in roleplay mode.`;

        const openRouterMessages = [
            { role: 'system', content: datingCoachSystemPrompt },
            ...nonSystemHistory
        ];
        if (userTextRaw && (!nonSystemHistory.length || nonSystemHistory[nonSystemHistory.length - 1].content !== userTextRaw)) {
            openRouterMessages.push({ role: "user", content: enforceWordLimit(userTextRaw, 500) });
        }

        let replyText = await queryOpenRouter("qwen3-235b-a22b-2507", openRouterMessages, 0.6, 120);

        if (!replyText) {
            throw new Error("AI provider returned empty response.");
        }

        replyText = replyText.replace(/\*.*?\*/g, '').replace(/\(.*?\)/g, '').trim();
        
        // Backend Truncation & Syntax Sanitizer (Roleplay Drill Modes Only)
        replyText = replyText.replace(/\s+(or|and|to|but|with|for|at|on|the|a|so|if|when|because|which|that)\s*([\:\;\,\-]?)\s*([😏😉😜👀🙈💅🔥☕✨🌙🥛]?)$/i, '$3').trim();

        if (!/[\.\!\?\:\;]$/.test(replyText) && !/([\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])$/.test(replyText)) {
            const lastMatch = replyText.match(/^.*[\.\!\?]/s);
            if (lastMatch && lastMatch[0].trim().length > 10) {
                replyText = lastMatch[0].trim();
            } else {
                replyText += ".";
            }
        }
        
        // Enforce Greeting Purge on subsequent turns
        if (hasHistory) {
            replyText = replyText.replace(/^(hey|hi|hey there|hello)[\!\,\.]?\s*/gi, '');
        }

        replyText = sanitizeResponseText(replyText);
        replyText = applyFormattingRules(replyText, useShorthand, emojiLevel);

        let score = 80;
        let status = "PASSED";
        let critique = "Good natural pacing! Preserved playful tension while keeping the conversation moving.";
        let alternative = "";

        const isApology = /sorry|apologize|my\s*bad|forgive\s*me/i.test(userText);
        const hasSpecificDateOffer = /(coffee|drinks?|rooftop|dinner|lunch|bar)\b.*(this|on|at|around)?\s*(thursday|friday|saturday|sunday|weekend|8\s*pm|7\s*pm|6\s*pm|4\s*pm)/i.test(userText) || /(let'?s|shall\s*we)\s*(grab|get|go)\s*(coffee|drinks?|dinner)/i.test(userText);

        if (isNonsense) {
            score = 15;
            status = "FAILED";
            critique = "Nonsense or trolling input kills match interest immediately. Real matches drop off when effort drops.";
            alternative = "how about drinks at the rooftop lounge this Thursday at 8 PM?";
        } else if (isDryResponse) {
            score = 30;
            status = "NEEDS_IMPROVEMENT";
            critique = "Dry 1-word answers shift 100% of the burden onto your match. Always add a detail or open question!";
            alternative = "i don't know the city well yet—what's your favorite rooftop spot?";
        } else if (isDemandWithoutDetail) {
            score = 45;
            status = "NEEDS_IMPROVEMENT";
            critique = "Vague date demands ('i want to meet') lack specific venue & time momentum. Propose a concrete plan!";
            alternative = "let's grab a coffee at the espresso bar on Thursday around 8 PM?";
        } else if (isApology) {
            score = 50;
            status = "NEEDS_IMPROVEMENT";
            critique = "Avoid unnecessary apologies ('my bad', 'sorry'). Over-apologizing projects insecurity. Own your interest with confident humor!";
            alternative = "sounds like I'm keeping things spicy then 😏 what are you up to tonight?";
        } else if (hasSpecificDateOffer) {
            score = 95;
            status = "PASSED";
            critique = "High-status date proposal! Proposing a specific venue + time removes decision friction and projects confidence.";
            alternative = "let me take you to the best rooftop spot in town this Thursday at 8 PM.";
        }

        const isDryOrNonsense = isNonsense || isDryResponse;
        const attractionScore = Math.max(10, Math.min(100, score));
        const attractionChange = isDryOrNonsense ? -15 : (score >= 80 ? 5 : (score < 45 ? -10 : -2));
        replyText = sanitizeTrailingConjunctions(replyText);

        const settleResult = await settleCreditsDB(req, reqId);
        if (!settleResult || !settleResult.success) {
            console.error(`[Ledger Error] Failed to settle credits for roleplay reqId ${reqId}:`, settleResult ? settleResult.error : "Unknown");
            return res.status(503).json({
                success: false,
                error: `Transaction completion error (Ref: ${reqId}). Your credit balance may need reconciliation. Please refresh or contact support.mywingman@gmail.com.`,
                reqId: reqId
            });
        }

        res.json({
            success: true,
            reply: replyText,
            roleplay_response: replyText,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Maeve AI Chat Pipeline Error:", error.stack || error.message || error);
        let currentBal = deduction ? deduction.remainingCredits : 0;
        let releaseSucceeded = false;
        if (deduction && deduction.success && !deduction.duplicate) {
            const relRes = await releaseCreditsDB(req, reqId, error.message);
            if (relRes && relRes.success) {
                releaseSucceeded = true;
                if (typeof relRes.remainingCredits === 'number') {
                    currentBal = relRes.remainingCredits;
                }
            }
        }
        if (deduction && deduction.success && !deduction.duplicate && !releaseSucceeded) {
            return res.status(500).json({
                success: false,
                error: `Maeve AI Coach failed to respond and credit release could not be confirmed (Ref: ${reqId}). Please refresh your balance or contact support.mywingman@gmail.com.`,
                reqId: reqId,
                credits: deduction.currentCredits
            });
        }
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({
                success: false,
                error: "Maeve AI Coach timed out. Your credits were restored.",
                credits: currentBal
            });
        }
        res.status(500).json({
            success: false,
            error: "Maeve AI Coach failed to respond. Your credits were restored.",
            credits: currentBal
        });
    } finally {
        releaseUserConcurrencyLock(uid);
    }
});

// 4C. DATING FLIGHT SIMULATOR REVIEW API ENGINE (`/api/simulator/review`)
app.post('/api/simulator/review', requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {
    const uid = getUserIdFromReq(req);
    if (!acquireUserConcurrencyLock(uid)) {
        return res.status(429).json({ success: false, error: "A generation is already in progress for your account. Please wait for it to complete." });
    }
    const reqId = req.headers['x-idempotency-key'] || (req.body && req.body.idempotencyKey) || ('rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    let deduction = null;

    try {
        const { sessionHistory } = req.body || {};
        let historyArray = Array.isArray(sessionHistory) ? sessionHistory.filter(h => h && h.role !== 'system') : [];

        if (historyArray.length > 50) {
            historyArray = historyArray.slice(-50);
        }

        for (const m of historyArray) {
            if (!m || typeof m !== 'object') {
                return res.status(400).json({ success: false, error: "Invalid message format in session history." });
            }
            if (typeof (m.text || m.content) === 'string' && (m.text || m.content).length > 5000) {
                return res.status(400).json({ success: false, error: "Message exceeds 5,000 character limit." });
            }
        }

        if (!sessionHistory || historyArray.length < 2) {
            return res.status(400).json({
                success: false,
                error: "At least 2 messages are required to evaluate your conversation."
            });
        }

        deduction = await verifyAndDeductCreditsDB(req, 2, 'simulator_review', reqId);
        if (!deduction.success) {
            if (deduction.profileMissing) {
                return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
            }
            if (deduction.serviceUnavailable) {
                return res.status(503).json({
                    success: false,
                    error: deduction.error || "Credit service temporarily unavailable. Please try again."
                });
            }
            if (deduction.unauthenticated) {
                return res.status(401).json({ success: false, error: deduction.error || "Authentication required to use this feature." });
            }
            return res.status(402).json({ success: false, error: "Insufficient credits for simulation review.", credits: deduction.currentCredits });
        }

        if (deduction.duplicate === true) {
            return res.status(409).json({
                success: false,
                error: "This request ID has already been processed or is already in progress. No additional credits were deducted.",
                code: "DUPLICATE_REQUEST",
                duplicate: true,
                credits: deduction.remainingCredits
            });
        }

        const formattedTranscript = historyArray
            .map(m => `${(m.role || 'user').toUpperCase()}: "${m.text || m.content || ''}"`)
            .join('\n');

        const systemPrompt = `You are an elite communication analyst and dating coach. Analyze the provided chat transcript and evaluate the user's performance.

CRITICAL EVALUATION & SCORING LAWS:
1. SPELLING & TYPOS DO NOT PENALIZE SCORES: Never list typos, spelling mistakes, or fast-typing slips (e.g. "membes", "againt", "tomorow") as a "biggest_mistake" or negative factor. Do NOT lower any score for typos or casual abbreviations.
2. TEXT ECONOMY MEASURES CONCISENESS: "text_economy" evaluates conciseness, punchiness, and text density (avoiding overly long walls of text). Casual shorthand and abbreviations like "u", "rn", "fr", "bc" INCREASE text economy score, they do NOT decrease it.
3. EVALUATE SOCIAL INTENT & EMOTIONAL INTELLIGENCE: Evaluate the user strictly on:
   - Frame Control & Confidence (Did they stand their ground or act needy/over-apologetic?)
   - Banter & Playfulness (Did they tease/subvert or send dry one-word replies?)
   - Forward Momentum (Did they build intrigue or pitch a concrete date venue/time?)

You MUST reply with ONLY a single valid JSON object strictly adhering to this structure:
{
  "overall_score": <integer from 0 to 100 based strictly on performance>,
  "status_text": "<short uppercase rating, e.g. NEEDS WORK, DECENT, GOOD, STRONG, ELITE>",
  "wit_score": "<percentage string between 0% and 100%>",
  "text_economy": "<percentage string between 0% and 100%>",
  "confidence_score": "<percentage string between 0% and 100%>",
  "performance_summary": "<detailed 2-sentence summary of how the user performed>",
  "biggest_strength": "<specific line or action the user did well and why>",
  "biggest_mistake": "<specific mistake the user made and why it hurt momentum>",
  "priority_focus": "<actionable 1-sentence tactical rule for their next attempt>"
}`;

        const payload = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Here is the conversation transcript to analyze:\n\n${formattedTranscript}` }
        ];

        let rawContent = await queryOpenRouter("qwen3-235b-a22b-2507", payload, 0.3, 400);

        const cleanedContent = (rawContent || "")
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        let reviewJson;
        try {
            reviewJson = JSON.parse(cleanedContent);
        } catch (parseError) {
            console.error("JSON Parsing Error from Review LLM:", parseError);
            throw new Error("Failed to parse simulation review output from AI model.");
        }

        if (!reviewJson || typeof reviewJson !== 'object') {
            throw new Error("Simulation review output is not a valid JSON object.");
        }

        function validatePercentage(val) {
            if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100) {
                return `${Math.round(val)}%`;
            }
            if (typeof val === 'string') {
                const trimmed = val.replace('%', '').trim();
                const num = parseFloat(trimmed);
                if (Number.isFinite(num) && num >= 0 && num <= 100) {
                    return `${Math.round(num)}%`;
                }
            }
            return null;
        }

        // 1. overall_score: finite number in 0..100 (0 must remain 0)
        const rawOverallScore = Number(reviewJson.overall_score);
        if (!Number.isFinite(rawOverallScore) || rawOverallScore < 0 || rawOverallScore > 100) {
            throw new Error("Simulation review output is missing a valid overall_score (0-100).");
        }
        const overallScore = Math.round(rawOverallScore);

        // 2. status_text: non-empty string
        const statusText = typeof reviewJson.status_text === 'string' ? reviewJson.status_text.trim() : '';
        if (!statusText) {
            throw new Error("Simulation review output is missing a valid status_text.");
        }

        // 3. wit_score: valid percentage 0..100
        const witScore = validatePercentage(reviewJson.wit_score);
        if (!witScore) {
            throw new Error("Simulation review output is missing a valid wit_score percentage.");
        }

        // 4. text_economy: valid percentage 0..100
        const textEconomy = validatePercentage(reviewJson.text_economy);
        if (!textEconomy) {
            throw new Error("Simulation review output is missing a valid text_economy percentage.");
        }

        // 5. confidence_score: valid percentage 0..100
        const confidenceScore = validatePercentage(reviewJson.confidence_score);
        if (!confidenceScore) {
            throw new Error("Simulation review output is missing a valid confidence_score percentage.");
        }

        // 6. performance_summary: non-empty string
        const performanceSummary = typeof reviewJson.performance_summary === 'string' ? reviewJson.performance_summary.trim() : '';
        if (!performanceSummary) {
            throw new Error("Simulation review output is missing a valid performance_summary.");
        }

        // 7. biggest_strength: non-empty string
        const biggestStrength = typeof reviewJson.biggest_strength === 'string' ? reviewJson.biggest_strength.trim() : '';
        if (!biggestStrength) {
            throw new Error("Simulation review output is missing a valid biggest_strength.");
        }

        // 8. biggest_mistake: non-empty string
        const biggestMistake = typeof reviewJson.biggest_mistake === 'string' ? reviewJson.biggest_mistake.trim() : '';
        if (!biggestMistake) {
            throw new Error("Simulation review output is missing a valid biggest_mistake.");
        }

        // 9. priority_focus: non-empty string
        const rawPriority = reviewJson.priority_focus || reviewJson.priority_tip;
        const priorityFocus = typeof rawPriority === 'string' ? rawPriority.trim() : '';
        if (!priorityFocus) {
            throw new Error("Simulation review output is missing a valid priority_focus.");
        }

        const settleResult = await settleCreditsDB(req, reqId);
        if (!settleResult || !settleResult.success) {
            console.error(`[Ledger Error] Failed to settle credits for review reqId ${reqId}:`, settleResult ? settleResult.error : "Unknown");
            return res.status(503).json({
                success: false,
                error: `Transaction completion error (Ref: ${reqId}). Your credit balance may need reconciliation. Please refresh or contact support.mywingman@gmail.com.`,
                reqId: reqId
            });
        }

        res.json({
            success: true,
            overall_score: overallScore,
            status_text: statusText,
            wit_score: witScore,
            text_economy: textEconomy,
            confidence_score: confidenceScore,
            performance_summary: performanceSummary,
            biggest_strength: biggestStrength,
            biggest_mistake: biggestMistake,
            priority_focus: priorityFocus,
            priority_tip: priorityFocus,
            credits: deduction.remainingCredits
        });

    } catch (error) {
        console.error("Qwen Review API Error:", error.message);
        let currentBal = deduction ? deduction.remainingCredits : 0;
        let releaseSucceeded = false;
        if (deduction && deduction.success && !deduction.duplicate) {
            const relRes = await releaseCreditsDB(req, reqId, error.message);
            if (relRes && relRes.success) {
                releaseSucceeded = true;
                if (typeof relRes.remainingCredits === 'number') {
                    currentBal = relRes.remainingCredits;
                }
            }
        }
        if (deduction && deduction.success && !deduction.duplicate && !releaseSucceeded) {
            return res.status(500).json({
                success: false,
                error: `Simulation review failed and credit release could not be confirmed (Ref: ${reqId}). Please refresh your balance or contact support.mywingman@gmail.com.`,
                reqId: reqId,
                credits: deduction.currentCredits
            });
        }
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({
                success: false,
                error: "Simulation review timed out. Your credits were restored.",
                credits: currentBal
            });
        }
        res.status(500).json({
            success: false,
            error: "Simulation review failed. Your credits were restored.",
            credits: currentBal
        });
    } finally {
        releaseUserConcurrencyLock(uid);
    }
});

// 4D. USER CONSENT & 18+ VERIFICATION ENDPOINT (`/api/consent`)
app.post('/api/consent', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: "Authentication required to record persistent consent." });
        }

        const { age18Plus, aiProcessingConsent } = req.body || {};

        if (age18Plus !== true) {
            return res.status(400).json({ success: false, error: "Confirmation of age 18 or older is mandatory." });
        }
        if (aiProcessingConsent !== true) {
            return res.status(400).json({ success: false, error: "AI data processing consent is mandatory." });
        }

        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
        const userAgent = req.headers['user-agent'] || null;

        if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
            if (!IS_PROD && db && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
                return res.json({
                    success: true,
                    consentRecorded: true,
                    consentId: 'dev_consent_' + Date.now(),
                    termsVersion: CURRENT_TERMS_VERSION,
                    privacyVersion: CURRENT_PRIVACY_VERSION,
                    message: "Dev local consent recorded."
                });
            }
            return res.status(503).json({
                success: false,
                consentRecorded: false,
                error: "Consent persistence service unavailable. Consent not recorded."
            });
        }

        const { data, error } = await supabaseAdmin
            .from('user_consents')
            .upsert({
                user_id: uid,
                terms_version: CURRENT_TERMS_VERSION,
                privacy_version: CURRENT_PRIVACY_VERSION,
                age_18_plus: true,
                ai_processing_consent: true,
                accepted_at: new Date().toISOString(),
                withdrawn_at: null,
                ip_address: ip,
                user_agent: userAgent
            }, { onConflict: 'user_id, terms_version, privacy_version' })
            .select('id, accepted_at')
            .single();

        if (error || !data) {
            console.error("[Consent DB Error]:", error ? error.message : "No data returned");
            return res.status(503).json({
                success: false,
                consentRecorded: false,
                error: "Failed to persist legal consent to database. Please try again."
            });
        }

        return res.json({
            success: true,
            consentRecorded: true,
            consentId: data.id,
            termsVersion: CURRENT_TERMS_VERSION,
            privacyVersion: CURRENT_PRIVACY_VERSION,
            message: "Legal consent and 18+ verification successfully recorded."
        });
    } catch (err) {
        console.error("[Consent Error]:", err);
        return res.status(503).json({
            success: false,
            consentRecorded: false,
            error: "Consent service error: " + err.message
        });
    }
});

// Check current server-side active consent status
app.get('/api/consent/status', requireSupabaseAuth, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: "Authentication required." });
        }
        const consentCheck = await checkUserActiveConsent(uid);
        if (consentCheck.status === 'service_unavailable') {
            return res.status(503).json({
                success: false,
                hasActiveConsent: false,
                code: "CONSENT_SERVICE_UNAVAILABLE",
                error: "Consent verification service is temporarily unavailable."
            });
        }
        return res.json({
            success: true,
            hasActiveConsent: consentCheck.status === 'active' && consentCheck.hasConsent === true,
            termsVersion: CURRENT_TERMS_VERSION,
            privacyVersion: CURRENT_PRIVACY_VERSION
        });
    } catch (err) {
        return res.status(503).json({ success: false, code: "CONSENT_SERVICE_UNAVAILABLE", error: err.message });
    }
});

// Withdraw AI processing consent
app.post('/api/consent/withdraw', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: "Authentication required to withdraw consent." });
        }
        if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
            return res.status(503).json({ success: false, error: "Consent service unavailable." });
        }
        const { error } = await supabaseAdmin
            .from('user_consents')
            .update({ withdrawn_at: new Date().toISOString() })
            .eq('user_id', uid)
            .is('withdrawn_at', null);

        if (error) {
            return res.status(503).json({ success: false, error: "Failed to record consent withdrawal." });
        }
        return res.json({ success: true, message: "Consent successfully withdrawn. AI processing locked." });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== USER HISTORY FETCH ENDPOINTS (STRICT RLS) ====================
// These endpoints require a server-validated token and return ONLY the authenticated
// caller's own rows via the RLS engine. Client-supplied identity is never accepted.
app.get('/api/user/bios', requireSupabaseAuth, async (req, res) => {
    try {
        const rls = forRequest(req, db);
        if (!rls.isAuthenticated) {
            return res.status(401).json({ success: false, error: 'Unauthorized: valid authentication token required.' });
        }
        const bios = await rls.list('saved_bios');
        res.json({ success: true, data: bios });
    } catch (err) {
        console.error("Fetch User Bios Error:", err);
        res.status(500).json({ success: false, error: "Internal server error fetching bios." });
    }
});

app.get('/api/user/chat-analyses', requireSupabaseAuth, async (req, res) => {
    try {
        const rls = forRequest(req, db);
        if (!rls.isAuthenticated) {
            return res.status(401).json({ success: false, error: 'Unauthorized: valid authentication token required.' });
        }
        const analyses = await rls.list('saved_chat_analyses');
        res.json({ success: true, data: analyses });
    } catch (err) {
        console.error("Fetch User Chat Analyses Error:", err);
        res.status(500).json({ success: false, error: "Internal server error fetching chat analyses." });
    }
});

// Credit Endpoints (Server-Validated Per-User Data Isolation & Real-Time Sync)
app.get(['/api/credits', '/api/user/credits', '/api/credits/sync'], requireSupabaseAuth, async (req, res) => {
    try {
        const credInr = await getUserCreditsDB(req);
        const creditCount = Math.round(credInr * 10);
        res.json({ success: true, credits: creditCount, data: { credits_inr: credInr } });
    } catch (err) {
        if (err.statusCode === 401) {
            return res.status(401).json({ success: false, error: err.message || "Authentication required." });
        }
        if (err.statusCode === 404 || err.code === 'PROFILE_MISSING' || err.message === 'PROFILE_MISSING') {
            return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
        }
        if (err.statusCode === 503) {
            return res.status(503).json({ success: false, error: "Credit service temporarily unavailable." });
        }
        res.status(500).json({ success: false, error: "Failed to fetch credit balance." });
    }
});

app.all('/api/credits/verify', requireSupabaseAuth, async (req, res) => {
    try {
        const credInr = await getUserCreditsDB(req);
        const creditCount = Math.round(credInr * 10);
        res.json({
            success: true,
            credits: creditCount,
            data: {
                credits_inr: credInr
            }
        });
    } catch (err) {
        if (err.statusCode === 401) {
            return res.status(401).json({ success: false, error: err.message || "Authentication required." });
        }
        if (err.statusCode === 404 || err.code === 'PROFILE_MISSING' || err.message === 'PROFILE_MISSING') {
            return res.status(404).json({ success: false, error: "PROFILE_MISSING", code: "PROFILE_MISSING" });
        }
        if (err.statusCode === 503) {
            return res.status(503).json({ success: false, error: "Credit service temporarily unavailable." });
        }
        res.status(500).json({ success: false, error: "Failed to verify credit balance." });
    }
});

// System Health Check Endpoint
app.get('/api/health', async (req, res) => {
    try {
        let userCount = 0;
        let dbStatus = 'disconnected';
        if (db) {
            dbStatus = 'sqlite_active';
            const countRow = await db.get('SELECT COUNT(*) as count FROM user_profiles');
            userCount = countRow ? countRow.count : 0;
        } else if (supabaseAdmin) {
            dbStatus = 'supabase_active';
            try {
                const { count } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true });
                userCount = count || 0;
            } catch (sErr) {}
        }
        res.json({
            status: 'ok',
            database: dbStatus,
            userCount: userCount,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', database: 'error', error: err.message });
    }
});

// Payment verification endpoint (sandbox & production gateway)
app.post('/api/payments/verify', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: "Please sign in to verify payments." });
        }
        // Strict Security: In production, payment verification is unavailable until Razorpay is integrated
        if (IS_PROD || process.env.ENABLE_MOCK_PAYMENTS !== 'true') {
            return res.status(503).json({
                success: false,
                error: 'Production payment gateway integration pending. Real payment gateway required.'
            });
        }
        const { tier, paymentId, sandbox, credits, amountInr } = req.body;
        if (!tier && !credits && !amountInr) {
            return res.status(400).json({ success: false, error: 'Tier or credit amount required.' });
        }
        if (sandbox === false) {
            return res.status(503).json({ success: false, error: 'Production payment gateway integration pending.' });
        }

        const tierMap = {
            starter: { credits: 250, price: 4.99 },
            pro: { credits: 600, price: 9.99 },
            elite: { credits: 3000, price: 19.99 }
        };

        const tierData = tierMap[tier];
        const targetCredits = Number(credits) || (tierData ? tierData.credits : 0);
        const addAmountInr = amountInr ? Number(amountInr) : (targetCredits > 0 ? targetCredits / CREDITS_PER_INR : 0);

        if (isNaN(addAmountInr) || addAmountInr <= 0 || addAmountInr > 1000) {
            return res.status(400).json({ success: false, error: "Invalid credit top-up parameters." });
        }

        const cleanPaymentId = paymentId || ('sandbox_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        const tierName = tier || 'credit_bundle';

        // ACTUALLY ADD CREDITS TO THE DATABASE
        const newInr = await addUserCreditsDB(req, addAmountInr, tierName, cleanPaymentId);
        const newCredits = Math.round(newInr * CREDITS_PER_INR);

        res.json({
            success: true,
            credits: newCredits,
            creditsAdded: Math.round(addAmountInr * CREDITS_PER_INR),
            data: {
                credits_inr: newInr
            }
        });
    } catch (err) {
        console.error('[Payment Verify Error]', err);
        res.status(500).json({ success: false, error: 'Payment verification failed.' });
    }
});

// VULN-06 FIX: Credit purchase is disabled until Razorpay production integration is verified
app.post('/api/credits/purchase', requireSupabaseAuth, apiLimiter, (req, res) => {
    return res.status(503).json({
        success: false,
        error: "Direct credit purchasing is currently unavailable. Payment gateway integration is deferred."
    });
});

// VULN-11 & Hardening FIX: Account deletion permanently removes authenticated user's data from Supabase Postgres & Auth
app.post('/api/user/delete-account', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: 'Unauthorized: valid authentication token required.' });
        }

        if (!supabaseAdmin || !supabaseAdmin.auth || !supabaseAdmin.auth.admin || typeof supabaseAdmin.auth.admin.deleteUser !== 'function') {
            return res.status(500).json({ success: false, error: 'Server authentication admin service is unavailable.' });
        }

        const isMissingOptionalTableError = (err) => {
            const code = err && err.code ? String(err.code) : '';
            return code === '42P01' || code === 'PGRST116' || code === 'PGRST205';
        };

        // 1. Purge optional user-created content before deleting the Auth identity. These tables
        // are not part of the core FK cascade and may not exist in every deployment.
        for (const table of ['saved_bios', 'saved_chat_analyses', 'saved_chat_histories']) {
            try {
                const { error: tblErr } = await supabaseAdmin.from(table).delete().eq('user_id', uid);
                if (tblErr && !isMissingOptionalTableError(tblErr)) {
                    console.error(`[delete-account ${table} error]:`, tblErr.message);
                    return res.status(500).json({ success: false, error: 'Failed to purge saved account content.' });
                }
            } catch (e) {
                return res.status(500).json({ success: false, error: 'Failed to purge saved account content.' });
            }
        }

        // 2. In local development, purge auxiliary SQLite state before the irreversible Auth
        // deletion. A local cleanup failure must not leave an already-deleted Auth identity.
        if (db) {
            try {
                const rls = forRequest(req, db);
                await rls.purgeAll();
                await db.run('DELETE FROM users_auth WHERE id = ?', uid);
            } catch (localErr) {
                console.error('[delete-account local database error]:', localErr.message);
                return res.status(500).json({ success: false, error: 'Failed to purge local account data.' });
            }
        }

        // 3. Delete the Supabase Auth identity as the authoritative commit point. Core Postgres
        // data is protected by ON DELETE CASCADE foreign keys:
        // auth.users -> profiles -> credit_transactions, and auth.users -> user_consents.
        // We deliberately do NOT pre-delete profiles or the credit ledger. If Auth deletion fails,
        // the user's core account state therefore remains intact instead of becoming corrupted.
        const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (authDelErr) {
            console.error('[delete-account Auth delete error]:', authDelErr.message);
            return res.status(500).json({ success: false, error: 'Failed to delete authentication account: ' + authDelErr.message });
        }

        res.json({ success: true, message: "Account data and authentication profile permanently purged." });
    } catch (err) {
        console.error("Delete Account Error:", err);
        res.status(500).json({ success: false, error: "Internal server error during account deletion." });
    }
});

// PUBLIC ENDPOINT FOR SUPABASE AUTHENTICATION CONFIGURATION
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        supabaseUrl: process.env.SUPABASE_URL || 'https://gstnghuhhrxtwjdafufd.supabase.co',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_oh5nDsBwEw56TLZFelxrvQ_A75_y-4j'
    });
});

// PRIVACY-SAFE ANALYTICS FOUNDATION (Strict metadata allowlist; zero personal content stored)
const ALLOWED_ANALYTICS_EVENTS = new Set([
    'signup_completed',
    'generation_started',
    'generation_succeeded',
    'generation_failed',
    'reply_copied',
    'reply_marked_useful',
    'credits_exhausted',
    'checkout_started',
    'checkout_completed'
]);
const ALLOWED_ANALYTICS_META_KEYS = new Set([
    'endpoint',
    'feature',
    'tier',
    'status',
    'remainingCredits',
    'currentCredits',
    'optionIndex',
    'timestamp'
]);

app.post('/api/analytics/event', (req, res) => {
    try {
        const { event, meta } = req.body || {};
        if (!event || typeof event !== 'string' || !ALLOWED_ANALYTICS_EVENTS.has(event)) {
            return res.status(400).json({ success: false, error: 'Invalid or disallowed event name.' });
        }
        const safeMeta = {};
        if (meta && typeof meta === 'object') {
            for (const [k, v] of Object.entries(meta)) {
                if (!ALLOWED_ANALYTICS_META_KEYS.has(k)) continue;
                if (typeof v === 'string' && v.length <= 80 && !v.startsWith('data:')) {
                    safeMeta[k] = v;
                } else if (typeof v === 'number' || typeof v === 'boolean') {
                    safeMeta[k] = v;
                }
            }
        }
        if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {
            console.log(`[ANALYTICS] ${event}:`, safeMeta);
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: true });
    }
});

// Centralized Error Handler (Prevents stack trace leaks)
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
        return res.status(400).json({
            success: false,
            error: "These images are too large. Maximum total upload size: 25 MB."
        });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ success: false, error: "Invalid JSON body format." });
    }
    console.error("Unhandled error:", err.stack || err.message || err);
    res.status(500).json({ success: false, error: "An internal server error occurred." });
});

// Server Startup (Supabase Postgres Primary, Optional Local SQLite Fallback)
async function startWingmanServer() {
    try {
        const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
        if (!isProduction && process.env.ENABLE_LOCAL_SQLITE === 'true') {
            try {
                const { initializeDatabase } = require('./database');
                db = await initializeDatabase();
                if (db) {
                    console.log("[DB Notice] Local SQLite attached as secondary dev storage.");
                } else {
                    console.warn("[DB Notice] Local SQLite driver unavailable, running with Supabase Postgres primary storage.");
                }
            } catch (dbErr) {
                console.warn("[DB Notice] Local SQLite unavailable, running with Supabase Postgres primary storage.");
            }
        } else {
            console.log("[DB Notice] Production environment detected (or local SQLite disabled). Running in pure 3-Tier Supabase Postgres mode.");
        }
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Secure Wingman 3-Tier Backend Online on port ${PORT} (Supabase Postgres Active)`);
        });
        server.keepAliveTimeout = 120000;
        server.headersTimeout = 125000;
        return server;
    } catch (err) {
        console.error("Fatal Server Startup Error:", err);
        throw err;
    }
}

// Importing the application must not open a network listener. Runtime entry points call
// startWingmanServer explicitly; tests and tooling can safely import the Express app.
module.exports = { app, startWingmanServer, supabaseAdmin };

if (require.main === module) {
    startWingmanServer().catch(() => process.exit(1));
}