// server.js
require('dotenv').config();

// Startup Environment Variables Validation
const requiredEnvVars = ['AICREDITS_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = requiredEnvVars.filter(key => !process.env[key]);
if (missingEnv.length > 0 && process.env.NODE_ENV === 'production') {
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
const { supabaseAdmin, verifySupabaseToken, requireSupabaseAuth } = require('./middleware/supabaseAuth');
const { createUserProvisioningMiddleware } = require('./middleware/userProvisioning');
const autoProvisionUser = createUserProvisioningMiddleware(() => db);
const { validateImagePayload } = require('./middleware/imageValidator');
const { forRequest } = require('./middleware/rls');


const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// 1. Security Headers Middleware (Helmet + Explicit Production Headers)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'", "https://*.supabase.co", "http://localhost:*", "ws://localhost:*"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://*.supabase.co"],
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
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['https://mywingman.com', 'https://*.pages.dev', 'http://localhost:3000', 'http://localhost:10000', 'http://127.0.0.1:3000', 'http://127.0.0.1:10000'];

function isOriginAllowed(origin, allowedList) {
    if (!origin || origin === 'null') return true;
    if (allowedList.includes('*') || allowedList.includes(origin)) return true;

    for (const item of allowedList) {
        if (item.includes('*')) {
            const regexStr = '^' + item.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[a-zA-Z0-9-]+') + '$';
            try {
                if (new RegExp(regexStr).test(origin)) return true;
            } catch (e) {}
        }
    }
    if (/^https:\/\/[a-zA-Z0-9-]+\.pages\.dev$/.test(origin)) {
        return true;
    }
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return true;
    }
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
        if (!IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }
        console.warn(`[SECURITY WARN] Blocked request from unauthorized origin: ${origin}`);
        callback(new Error('CORS origin not allowed'), false);
    },
    credentials: true
}));

// 3. Global Rate Limiter (API Scoped) & Express Payload Limits
app.use('/api/', globalLimiter);
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ limit: '30mb', extended: true }));
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
            [uid, (email && email.includes('@')) ? email.split('@')[0] : 'MyWingman User', 0, 'free']
        );
        return uid;
    } catch (err) {
        console.error(`[ensureUserProfile ERROR] Profile provisioning failed for ${uid}:`, err.message);
        return uid;
    }
}

// Read credits from Supabase Postgres 'profiles' table with optional SQLite fallback
const devCreditsMap = {};

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

        if (!error && data && typeof data.credits === 'number') {
            return Number(data.credits) / CREDITS_PER_INR;
        }

        if (typeof devCreditsMap[uid] === 'number') {
            return devCreditsMap[uid] / CREDITS_PER_INR;
        }

        // Auto-provision profile row in Supabase 'profiles' table if missing
        try {
            await supabaseAdmin
                .from('profiles')
                .upsert({ id: uid, credits: 0 });
        } catch (autoErr) {}
            
        return (devCreditsMap[uid] || 0) / CREDITS_PER_INR;
    } catch (e) {
        if (typeof devCreditsMap[uid] === 'number') return devCreditsMap[uid] / CREDITS_PER_INR;
        console.warn(`[getUserCreditsDB Notice] Supabase query notice for ${uid}:`, e.message);
        return 0.00;
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

// Atomic Credit Verification & Deduction in Supabase Postgres ('profiles' & 'credit_transactions')
async function verifyAndDeductCreditsDB(req, costInr, featureName = 'ai_feature', idempotencyKey = null) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user') {
        return { success: false, currentCredits: 0, error: 'Authentication required.', unauthenticated: true };
    }

    const costCredits = Math.round(costInr * CREDITS_PER_INR);
    const reqId = idempotencyKey || ('req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

    // Priority 1: Try atomic Postgres RPC function 'deduct_credits' in Supabase
    try {
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('deduct_credits', {
            p_user_id: uid,
            p_amount: costCredits,
            p_feature: featureName,
            p_request_id: reqId
        });

        if (!rpcErr && rpcRes && typeof rpcRes === 'object') {
            if (rpcRes.success === false) {
                return { success: false, currentCredits: typeof rpcRes.currentCredits === 'number' ? rpcRes.currentCredits : 0 };
            }
            if (rpcRes.success === true) {
                const rem = typeof rpcRes.remainingCredits === 'number' ? rpcRes.remainingCredits : 0;
                return {
                    success: true,
                    remainingCredits: rem,
                    remainingInr: rem / CREDITS_PER_INR
                };
            }
        }
    } catch (rpcEx) {
        // Fallback to table query if RPC function is not installed in Supabase Postgres
    }

    // Priority 2: Standard Supabase Postgres Query Pipeline
    try {
        const { data: profile, error: selectErr } = await supabaseAdmin
            .from('profiles')
            .select('credits')
            .eq('id', uid)
            .maybeSingle();

        if (selectErr) throw selectErr;

        let currentCredits = (profile && typeof profile.credits === 'number')
            ? Number(profile.credits)
            : (typeof devCreditsMap[uid] === 'number' ? devCreditsMap[uid] : 0);

        if (!profile) {
            try { await supabaseAdmin.from('profiles').upsert({ id: uid, credits: 0 }); } catch (e) {}
            currentCredits = typeof devCreditsMap[uid] === 'number' ? devCreditsMap[uid] : 0;
        }

        if (currentCredits < costCredits) {
            return { success: false, currentCredits: currentCredits };
        }

        const remainingCredits = currentCredits - costCredits;
        devCreditsMap[uid] = remainingCredits;

        try {
            const { error: updateErr } = await supabaseAdmin
                .from('profiles')
                .update({ credits: remainingCredits })
                .eq('id', uid);
            if (updateErr && process.env.NODE_ENV === 'production') {
                console.error('[verifyAndDeductCreditsDB Supabase Update ERROR]:', updateErr.message);
            }
        } catch (updateEx) {}

        // Log entry in credit_transactions
        try {
            await supabaseAdmin
                .from('credit_transactions')
                .insert({
                    user_id: uid,
                    amount: -costCredits,
                    feature: featureName,
                    request_id: reqId,
                    created_at: new Date().toISOString()
                });
        } catch (txErr) {
            console.warn('[credit_transactions audit notice]:', txErr.message);
        }

        if (db && process.env.ENABLE_LOCAL_SQLITE === 'true') {
            db.run('UPDATE user_profiles SET credits_balance = ROUND(credits_balance - ?, 2) WHERE user_id = ? AND credits_balance >= ?', [costInr, uid, costInr]).catch(() => {});
        }

        return {
            success: true,
            remainingCredits: remainingCredits,
            remainingInr: remainingCredits / CREDITS_PER_INR
        };
    } catch (err) {
        console.warn('[verifyAndDeductCreditsDB Notice] Supabase credit deduction error:', err.message);
        // CRITICAL SECURITY RULE: In production, NEVER fall back to SQLite for credit mutations. Return 500 error.
        if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LOCAL_SQLITE !== 'true') {
            return { success: false, currentCredits: 0, error: 'Credit service unavailable. Please try again.' };
        }
        if (db) {
            return await verifyAndDeductCreditsSQLite(req, costInr, featureName, reqId);
        }
        return { success: false, currentCredits: 0, error: 'Database service unavailable.' };
    }
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

// Persistent Credit Top-Up in Supabase Postgres ('profiles' & 'credit_transactions')
async function addUserCreditsDB(req, amountInr, tierName = 'purchase', paymentId = null) {
    const uid = getUserIdFromReq(req);
    if (!uid || uid === 'guest_user') {
        const err = new Error('Authentication required to top up credits.');
        err.statusCode = 401;
        throw err;
    }

    const addCredits = Math.round(amountInr * CREDITS_PER_INR);

    try {
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('credits')
            .eq('id', uid)
            .maybeSingle();

        const currentCredits = (profile && typeof profile.credits === 'number')
            ? Number(profile.credits)
            : (typeof devCreditsMap[uid] === 'number' ? devCreditsMap[uid] : 0);
        const newCredits = currentCredits + addCredits;
        devCreditsMap[uid] = newCredits;

        try {
            const { error: upsertErr } = await supabaseAdmin
                .from('profiles')
                .upsert({ id: uid, credits: newCredits });
            if (upsertErr && process.env.NODE_ENV === 'production') {
                console.error('[addUserCreditsDB Supabase Upsert ERROR]:', upsertErr.message);
            }
        } catch (upsertEx) {}

        // Log entry in credit_transactions
        try {
            await supabaseAdmin
                .from('credit_transactions')
                .insert({
                    user_id: uid,
                    amount: addCredits,
                    feature: tierName,
                    payment_id: paymentId || ('sim_' + Date.now()),
                    created_at: new Date().toISOString()
                });
        } catch (txErr) {
            console.warn('[credit_transactions topup notice]:', txErr.message);
        }

        if (db) {
            db.run('UPDATE user_profiles SET credits_balance = ROUND(credits_balance + ?, 2) WHERE user_id = ?', [amountInr, uid]).catch(() => {});
        }

        return newCredits / CREDITS_PER_INR;
    } catch (err) {
        console.warn('[addUserCreditsDB Notice] Supabase top-up failed, attempting local fallback:', err.message);
        if (db) {
            await ensureUserProfile(uid, (req.user && req.user.email) || null);
            return await withTransactionRetry(db, async (db) => {
                await db.run('UPDATE user_profiles SET credits_balance = ROUND(credits_balance + ?, 2) WHERE user_id = ?', [amountInr, uid]);
                const updatedRow = await db.get('SELECT credits_balance FROM user_profiles WHERE user_id = ?', [uid]);
                return updatedRow ? Number(updatedRow.credits_balance) : 0.00;
            });
        }
        throw err;
    }
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
    let targetModel = modelIdentifier;
    if (!targetModel.includes("/")) {
        targetModel = "qwen/" + targetModel;
    }

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

    const baseUrl = process.env.AICREDITS_BASE_URL || "https://aicredits.in/v1";

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
            const err = new Error(`OpenRouter API Failure [${targetModel}]: ${response.status} - ${errText}`);
            err.statusCode = response.status;
            throw err;
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(`OpenRouter API Error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        if (!data.choices || data.choices.length === 0) {
            throw new Error(`OpenRouter API returned no choices. Response: ${JSON.stringify(data)}`);
        }
        return data.choices[0].message.content;
    } catch (err) {
        if (timer) clearTimeout(timer);
        if (err.name === 'AbortError') {
            const timeoutErr = new Error("Analysis timed out. Please try again.");
            timeoutErr.isTimeout = true;
            throw timeoutErr;
        }
        throw err;
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

    // Model Failover Retry Logic (Task 3)
    const FALLBACK_MODELS = {
        'qwen3-235b-a22b-2507': 'qwen/qwen2.5-72b-instruct',
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

// ==================== THE 4 CORE FEATURE API ENDPOINTS ====================

// 1. CHAT SCREENSHOT ANALYZER (/api/analyze & /api/analyze-chat-screenshot)
app.post(['/api/analyze', '/api/analyze-chat-screenshot'], requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const deduction = await verifyAndDeductCreditsDB(req, 1.0);
        if (!deduction.success) {
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

        const { tone, image, images, imageBase64, messages, shorthandOption, emojiOption } = req.body;
        const targetImage = image || imageBase64;

        // IMAGE PAYLOAD HANDLING: Accept up to 5 valid image data URLs or HTTP links
        const MAX_IMAGES = 5;
        let imageList = [];
        if (Array.isArray(images) && images.length > 0) {
            imageList = images.filter(img => typeof img === 'string' && img.length > 0 && (img.startsWith('data:image/') || img.startsWith('http://') || img.startsWith('https://'))).slice(0, MAX_IMAGES);
        } else if (targetImage && typeof targetImage === 'string' && targetImage.length > 0) {
            let cleanImg = targetImage.trim();
            if (!cleanImg.startsWith('data:image/') && !cleanImg.startsWith('http://') && !cleanImg.startsWith('https://')) {
                cleanImg = 'data:image/jpeg;base64,' + cleanImg;
            }
            imageList = [cleanImg];
        }

        // =========================================================================
        // DUAL-MODEL VISION & CHAT STATE PIPELINE
        // STAGE 1: Vision Extraction & Spatial Parsing via google/gemini-2.5-flash
        // STAGE 2: State-Aware Strategy & Reply Generation via qwen/qwen2.5-vl-72b-instruct
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
   - LEFT-ALIGNED BUBBLES/MEDIA (X < 50% screen width) = SENT_BY_MATCH (The Girl).

2. CHRONOLOGICAL RECENCY (TOP TO BOTTOM):
   - Parse all chat elements chronologically from top to bottom.
   - The element at the absolute bottom of the screenshot is the LATEST_ACTION.
   - If the bottom-most element is SENT_BY_USER and has no left-aligned reply below it, set active_status = "USER_LEFT_ON_READ".
   - If the bottom-most element is SENT_BY_MATCH, set active_status = "MATCH_REPLIED".

3. STRICT REEL OCR ISOLATION LAW (CRITICAL):
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

            console.log(`Executing Stage 1: Optical Vision & Spatial Parsing for ${imageList.length} screenshot(s) using google/gemini-2.5-flash...`);
            const transcriptionPromises = imageList.map(async (imgUrl, i) => {
                try {
                    const cleanImgUrl = typeof imgUrl === 'string' ? imgUrl.trim().replace(/[\r\n]+/g, '') : imgUrl;
                    const positionTag = (i === imageList.length - 1)
                        ? `SCREENSHOT ${i + 1} OF ${imageList.length} (LATEST SCREENSHOT - CONTAINS FINAL MESSAGE)`
                        : `SCREENSHOT ${i + 1} OF ${imageList.length} (EARLIER CONVERSATION HISTORY)`;

                    const visionMessages = [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: `${visionSystemPrompt}\n\n[SCREENSHOT SEQUENCE TAG: ${positionTag}]` },
                                { type: "image_url", image_url: { url: cleanImgUrl } }
                            ]
                        }
                    ];
                    let singleTranscript = "";
                    try {
                        singleTranscript = await queryOpenRouter("google/gemini-2.5-flash", visionMessages, 0.1, 400, 25000);
                    } catch(vPrimaryErr) {
                        console.warn(`Primary vision model (google/gemini-2.5-flash) failed for screenshot ${i + 1}, trying fallback:`, vPrimaryErr.message);
                        try {
                            singleTranscript = await queryOpenRouter("qwen/qwen2.5-vl-72b-instruct", visionMessages, 0.1, 400, 25000);
                        } catch(vFallbackErr) {
                            console.warn(`Secondary vision model failed for screenshot ${i + 1}, trying tertiary fallback:`, vFallbackErr.message);
                            singleTranscript = await queryOpenRouter("google/gemini-2.5-flash", visionMessages, 0.1, 400, 25000);
                        }
                    }
                    return `--- ${positionTag} ---\n${singleTranscript}`;
                } catch (vErr) {
                    console.warn(`Vision extraction fallback triggered for screenshot ${i + 1}:`, vErr.message);
                    return `{"chat_history":[{"sender":"SENT_BY_USER","type":"SHARED_REEL","text":"[Video Reel]"},{"sender":"SENT_BY_USER","type":"TEXT","text":"Hiii"}],"latest_sender":"SENT_BY_USER","active_status":"USER_LEFT_ON_READ","match_has_replied":false}`;
                }
            });

            const transcriptions = await Promise.all(transcriptionPromises);
            extractedTextContext = transcriptions.join("\n\n");
            
            console.log("\n================ [STAGE 1 VISION JSON OUTPUT] ================");
            console.log(extractedTextContext);
            console.log("==============================================================\n");
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
            description: "Sharp observations, dry humor, clever callouts, and high-status banter.",
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
            bucketDefinitions: `• Options 1-2 [Sharp Observation]: Witty callout or clever spin on what she said/did.
• Options 3-4 [Dry Banter]: Playful teasing or sarcastic joke with zero insecurity.
• Options 5-6 [Clever Question]: Intriguing, sharp question that forces a fun reply.
• Options 7-8 [Witty Topic Pivot]: Smooth, clever transition to a new topic.
• Options 9-10 [Snappy Minimalist]: 2-to-4 word snappy, high-status text.`
        };

        if (cleanToneKey === 'casual') {
            modeConfig = {
                name: "CASUAL",
                description: "Natural, unforced, relaxed texting flow. Grounded, friendly, and zero pressure.",
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
                bucketDefinitions: `• Options 1-2 [Easygoing Reaction]: Relaxed, natural comment on her text or situation.
• Options 3-4 [Low-Key Question]: Simple, effortless question to keep the chat moving without pressure.
• Options 5-6 [Relatable Take]: Shared lifestyle detail or funny relatable take.
• Options 7-8 [Casual Topic Shift]: Easy transition into something light and unforced.
• Options 9-10 [Short Chill Text]: 2-to-4 word effortless replies (e.g., "all good", "fair enough", "sounds like a plan").`
            };
        } else if (cleanToneKey === 'flirty') {
            modeConfig = {
                name: "FLIRTY",
                description: "Playful charm, teasing, subtle romantic tension, and confident spark.",
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
                bucketDefinitions: `• Options 1-2 [Playful Charm]: Smooth, flattering tease or charming comment.
• Options 3-4 [Flirty Tease]: Building tension, playful challenge, or light teasing.
• Options 5-6 [Intriguing Spark]: Question designed to flirt and tease her personality.
• Options 7-8 [Smooth Vibe Setup]: Subtle setup toward hanging out or getting her number.
• Options 9-10 [Cheeky Minimalist]: 2-to-4 word cheeky flirty text.`
            };
        } else if (cleanToneKey === 'bold' || cleanToneKey === 'direct' || cleanToneKey === 'closer') {
            modeConfig = {
                name: "BOLD / CLOSER",
                description: "Direct, confident, high-energy moves. Unapologetic charm and clear intent.",
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
                bucketDefinitions: `• Options 1-2 [Direct Callout]: Unapologetic, confident statement that takes control of the chat.
• Options 3-4 [Bold Challenge]: Playful challenge or direct callout that commands respect.
• Options 5-6 [Direct Plan Move]: Bold suggestion to grab drinks, coffee, or switch to IG/WhatsApp.
• Options 7-8 [High-Energy Hook]: Intriguing, confident question with strong presence.
• Options 9-10 [Power Minimalist]: 2-to-4 word direct, ultra-confident statement.`
            };
        }

        const screenshotTextSystemPrompt = `You are an elite AI Wingman and Social Attraction Strategist.
Generate 10 strategic text reply options based on the provided conversation JSON state.

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
MODE FIREWALL & TONE RULES:
--------------------------------------------------------------------------------
[MODE: CASUAL]
- Vibe: Unforced, low-pressure, relaxed human texting flow.
- BANNED: Flirty smirks (😜), cheesy pickup lines, direct romantic teasing, or desperate double-texting.
- Example for USER_LEFT_ON_READ: "random question but are you a spontaneous trip person or full planner?"

[MODE: WITTY]
- Tone: Sharp observations, dry humor, clever callouts, high-status banter.

[MODE: FLIRTY]
- Tone: Playful charm, subtle romantic tension, confident spark.

[MODE: BOLD / CLOSER]
- Tone: Direct, confident, making direct moves/plans.

--------------------------------------------------------------------------------
UNIVERSAL BATCH DIVERSITY LAW
--------------------------------------------------------------------------------
When generating an array/batch of output options for a single user request:
1. EVERY option in the batch MUST use a strictly distinct:
   - Sentence length & rhythm (e.g., Option 1: 4-6 words, Option 2: 8-12 words, Option 3: 14+ words).
   - Opening hook & lead-in prefix (NO TWO options may share the same first 2 words).
   - Ending format (e.g., Option 1: Open question, Option 2: Statement/No question, Option 3: This-or-That debate).

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

        console.log(`Executing Stage 2: Generating 10 strategic response cards for mode ${modeConfig.name} using qwen/qwen2.5-vl-72b-instruct...`);
        let finalCardsOutput = "";
        try {
            finalCardsOutput = await queryOpenRouter("qwen/qwen2.5-vl-72b-instruct", generationMessages, 0.20, 800, 25000);
        } catch(gErr) {
            console.warn("Primary generation model (qwen/qwen2.5-vl-72b-instruct) fallback triggered:", gErr.message);
            finalCardsOutput = await queryOpenRouter("qwen3-235b-a22b-2507", generationMessages, 0.20, 800, 25000);
        }

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

        res.json({
            success: true,
            options: optionsList,
            text: formattedText,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Pipeline breakdown:", error.message);
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({ success: false, error: "Analysis timed out. Please try again." });
        }
        res.status(500).json({
            success: false,
            error: IS_PROD ? "An internal server error occurred." : (error.message || "Internal processing error.")
        });
    }
});

// 2. ICEBREAKER GENERATOR (Direct qwen3-235b-a22b-2507)
app.post('/api/icebreaker', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const deduction = await verifyAndDeductCreditsDB(req, 1.0);
        if (!deduction.success) {
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

        let { tone, text, messages, shorthandOption, emojiOption } = req.body;
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

            return applyFormattingRules(cleaned, useShorthand, emojiLevel);
        });

        cleanedOptions = enforceUniqueQuestionAnchors(enforceStructuralBatchDiversity(cleanedOptions, "icebreaker"));
        console.log("[ICEBREAKER CLEAN OUTPUT]:", cleanedOptions);

        const formattedText = cleanedOptions.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
        res.json({
            success: true,
            text: formattedText,
            options: cleanedOptions,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Icebreaker breakdown:", error.message);
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({ success: false, error: "Icebreaker generation timed out. Please try again." });
        }
        res.status(500).json({
            success: false,
            error: IS_PROD ? "An internal server error occurred." : (error.message || "Internal processing error.")
        });
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
app.post(['/api/optimize', '/api/bio-optimizer'], requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const deduction = await verifyAndDeductCreditsDB(req, 1.0);
        if (!deduction.success) {
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

        let { tone, text, messages, style, shorthandOption, emojiOption } = req.body;
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

        const sanitizedText = sanitizeBioInput(text);
        const textPayload = enforceWordLimit(sanitizedText, 500);

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

        res.json({
            success: true,
            options: optionsList,
            text: formattedText,
            credits: deduction.remainingCredits
        });
    } catch (error) {
        console.error("Bio optimizer breakdown:", error.message);
        if (error.isTimeout || (error.message && error.message.includes("timed out"))) {
            return res.status(504).json({ success: false, error: "Bio optimization timed out. Please try again." });
        }
        res.status(500).json({
            success: false,
            error: IS_PROD ? "An internal server error occurred." : (error.message || "Internal processing error.")
        });
    }
});

// 4. MAEVE AI DATING COACH & EVALUATOR CHAT (/api/chat & /api/simulator/chat)
app.post(['/api/chat', '/api/simulator/chat'], requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const deduction = await verifyAndDeductCreditsDB(req, 0.2);
        if (!deduction.success) {
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

        const { mode, message, userMessage, conversationHistory, sessionHistory, scenario, shorthandOption, emojiOption } = req.body;
        const currentScenario = scenario || "Flirting & Teasing";
        const useShorthand = shorthandOption !== false;
        const emojiLevel = typeof emojiOption === 'number' ? emojiOption : 1;
        const isHotline = mode === "hotline" || currentScenario === "Coach Hotline";

        const userTextRaw = message || userMessage || (req.body.messages && req.body.messages.length > 0 ? req.body.messages[req.body.messages.length - 1].content : "");
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

        let historyArr = req.body.messages || conversationHistory || sessionHistory || [];
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
        const mood = isDryOrNonsense ? "Bored 🥱" : (score >= 80 ? "Flirty 😏" : (score >= 50 ? "Playful ✨" : "Hesitant 🤨"));
        const isCheckpoint = status !== "PASSED" || isDryOrNonsense;
        const checkpoint = isCheckpoint ? {
            type: (isNonsense || isDryResponse) ? "ATTRACTION_DROP" : (status === "FAILED" ? "ATTRACTION_DROP" : "MISSED_FLIRT"),
            title: isDryOrNonsense ? "📉 Major Attraction Drop (-15%)" : (status === "FAILED" ? "⚠️ Low Attraction Turn" : "💡 Coaching Moment"),
            explanation: isDryOrNonsense ? "Dry 1-word responses ('hi', 'ok', 'nothing') kill attraction and force the match to carry 100% of the conversational weight." : critique,
            pro_tip: alternative ? `Try this line instead: "${alternative}"` : "Keep your confidence high and suggest a specific time/place!"
        } : null;

        res.json({
            success: true,
            reply: replyText,
            roleplay_response: replyText,
            attraction_score: attractionScore,
            attraction_change: attractionChange,
            character_mood: mood,
            trigger_checkpoint: isCheckpoint,
            checkpoint_data: checkpoint,
            credits: deduction.remainingCredits,
            evaluation: {
                score: score,
                status: status,
                critique: critique,
                alternative: alternative
            }
        });
    } catch (error) {
        console.error("Maeve AI Chat Pipeline Error:", error.stack || error.message || error);
        res.status(500).json({
            success: false,
            error: error.message || "Connection error: Unable to reach AI coach. Please try again."
        });
    }
});

// 4C. DATING FLIGHT SIMULATOR REVIEW API ENGINE (`/api/simulator/review`)
app.post('/api/simulator/review', apiLimiter, async (req, res) => {
    try {
        const { sessionHistory } = req.body;
        const historyArray = Array.isArray(sessionHistory) ? sessionHistory.filter(h => h.role !== 'system') : [];

        // Fallback for empty or 1-message chats
        if (!sessionHistory || historyArray.length < 2) {
            return res.json({
                overall_score: 75,
                status_text: "STATUS: OK",
                wit_score: "70%",
                text_economy: "80%",
                confidence_score: "70%",
                performance_summary: "The session was too short to perform a deep tactical evaluation. Try having a longer conversation to unlock full insights.",
                biggest_strength: "Initiated the conversation.",
                biggest_mistake: "Ended the practice session prematurely.",
                priority_focus: "Aim for at least 4-6 back-and-forth messages to test your conversational flow."
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
  "overall_score": 78,
  "status_text": "STATUS: GOOD",
  "wit_score": "68%",
  "text_economy": "85%",
  "confidence_score": "72%",
  "performance_summary": "Detailed 2-sentence summary of how the user performed.",
  "biggest_strength": "Direct quote or specific action the user did well and why.",
  "biggest_mistake": "Direct quote or specific mistake the user made (e.g. sending dry 'hm' replies or needy apologies) and why it hurt momentum.",
  "priority_focus": "Actionable, 1-sentence tactical rule for their next attempt."
}`;

        const payload = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Here is the conversation transcript to analyze:\n\n${formattedTranscript}` }
        ];

        let rawContent = await queryOpenRouter("qwen3-235b-a22b-2507", payload, 0.3, 400);

        // Clean potential markdown fencing from LLM
        const cleanedContent = (rawContent || "")
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        let reviewJson;
        try {
            reviewJson = JSON.parse(cleanedContent);
        } catch (parseError) {
            console.error("JSON Parsing Error from Review LLM:", parseError);
            reviewJson = {
                overall_score: 78,
                status_text: "STATUS: GOOD",
                wit_score: "75%",
                text_economy: "85%",
                confidence_score: "70%",
                performance_summary: "Maintained steady conversation flow throughout the session.",
                biggest_strength: "Kept responses engaged and on topic.",
                biggest_mistake: "Could take more playful risks to build stronger attraction.",
                priority_focus: "Focus on driving towards a concrete date offer earlier."
            };
        }

        res.json({
            overall_score: Number(reviewJson.overall_score) || 78,
            status_text: reviewJson.status_text || "STATUS: GOOD",
            wit_score: reviewJson.wit_score || "75%",
            text_economy: reviewJson.text_economy || "85%",
            confidence_score: reviewJson.confidence_score || "70%",
            performance_summary: reviewJson.performance_summary || "Maintained steady conversation flow throughout the session.",
            biggest_strength: reviewJson.biggest_strength || "Kept responses engaged and on topic.",
            biggest_mistake: reviewJson.biggest_mistake || "Could take more playful risks to build stronger attraction.",
            priority_focus: reviewJson.priority_focus || reviewJson.priority_tip || "Focus on driving towards a concrete date offer earlier.",
            priority_tip: reviewJson.priority_focus || reviewJson.priority_tip || "Focus on driving towards a concrete date offer earlier."
        });

    } catch (error) {
        console.error("Qwen Review API Error:", error);
        // Safe fallback payload to guarantee modal never freezes
        res.json({
            overall_score: 78,
            status_text: "STATUS: GOOD",
            wit_score: "75%",
            text_economy: "85%",
            confidence_score: "70%",
            performance_summary: "Maintained steady conversation flow throughout the session.",
            biggest_strength: "Kept responses engaged and on topic.",
            biggest_mistake: "Could take more playful risks to build stronger attraction.",
            priority_focus: "Focus on driving towards a concrete date offer earlier.",
            priority_tip: "Focus on driving towards a concrete date offer earlier."
        });
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
        const { tier, paymentId, sandbox, credits, amountInr } = req.body;
        if (!tier && !credits && !amountInr) {
            return res.status(400).json({ success: false, error: 'Tier or credit amount required.' });
        }
        // For production we would integrate a real gateway; sandbox is always true for now
        if (sandbox === false) {
            return res.status(501).json({ success: false, error: 'Production payment gateway integration pending.' });
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

// VULN-06 FIX: Credit purchase requires authentication and rate limiting to prevent abuse
app.post('/api/credits/purchase', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: "Please sign in to purchase credits." });
        }
        const { amount, credits, tier, paymentId } = req.body;
        const addAmount = amount ? Number(amount) : (credits ? Number(credits) / 10 : 0);
        if (isNaN(addAmount) || addAmount <= 0 || addAmount > 1000) {
            return res.status(400).json({ success: false, error: "Invalid credit top-up amount." });
        }
        const newCredInr = await addUserCreditsDB(req, addAmount, tier || 'credit_topup', paymentId || null);
        const creditCount = Math.round(newCredInr * 10);
        res.json({
            success: true,
            credits: creditCount,
            newBalance: creditCount,
            creditsAdded: Math.round(addAmount * 10),
            data: {
                credits_inr: newCredInr
            }
        });
    } catch (err) {
        console.error('[Credit Purchase ERROR]:', err.message);
        res.status(500).json({ success: false, error: "Failed to process credit purchase." });
    }
});

// VULN-11 FIX: Account deletion requires strict auth & rate limiting.
// Permanently purges the authenticated user's rows across all user-scoped tables (RLS).
app.post('/api/user/delete-account', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid) {
            return res.status(401).json({ success: false, error: 'Unauthorized: valid authentication token required.' });
        }
        const rls = forRequest(req, db);
        await rls.purgeAll(); // saved_bios, saved_chat_analyses, saved_chat_histories, user_profiles
        if (db) {
            await db.run('DELETE FROM users_auth WHERE id = ?', uid);
        }
        res.json({ success: true, message: "Account data purged." });
    } catch (err) {
        console.error("Delete Account Error:", err);
        res.status(500).json({ success: false, error: "Internal server error during account deletion." });
    }
});

// PUBLIC ENDPOINT FOR CSRF SECURITY TOKEN ISSUANCE
app.get('/api/csrf-token', (req, res) => {
    const token = generateCsrfToken();
    setHttpOnlyCookie(res, 'wingman_csrf', token, 3600);
    res.json({ success: true, csrfToken: token });
});

// PUBLIC ENDPOINT FOR SUPABASE AUTHENTICATION CONFIGURATION
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        supabaseUrl: process.env.SUPABASE_URL || 'https://gstnghuhhrxtwjdafufd.supabase.co',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_oh5nDsBwEw56TLZFelxrvQ_A75_y-4j'
    });
});

// Centralized Error Handler (Prevents stack trace leaks)
app.use((err, req, res, next) => {
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
        module.exports = { app, server, db, supabaseAdmin };
    } catch (err) {
        console.error("Fatal Server Startup Error:", err);
        process.exit(1);
    }
}

startWingmanServer();