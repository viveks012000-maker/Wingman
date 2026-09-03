/**
 * =========================================================================================
 * WINGMAN ROW-LEVEL SECURITY (RLS) ENGINE
 * =========================================================================================
 * SQLite provides no native row-level security, so this module is the authoritative
 * application-layer permission engine. EVERY user-scoped read/write MUST pass through
 * these helpers, which bind the owner's identity from the SERVER-VALIDATED token only.
 * Client-supplied identity is never accepted, making cross-account data flow impossible.
 * =========================================================================================
 */

// Bind SQLite fallback rows directly to the identity already established by the canonical
// Supabase middleware. Do not import the retired JWT/session compatibility layer here.
function getAuthenticatedUid(req) {
    return req && req.user && req.user.id ? String(req.user.id) : null;
}

// Tables whose rows are strictly owned by a single authenticated user.
const USER_SCOPED_TABLES = ['user_profiles', 'saved_bios', 'saved_chat_analyses', 'saved_icebreakers', 'saved_chat_histories', 'credit_purchases', 'credit_deductions'];

class RlsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RlsError';
    }
}

const SAFE_ORDER_BY = ['created_at DESC', 'created_at ASC'];

// Strict identifier policy for dynamically accepted column names. Identifiers that fail
// this pattern are never interpolated into SQL or forwarded to the provider.
const SAFE_COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Ownership columns are always bound server-side; callers may never supply them.
const FORBIDDEN_IDENTITY_COLUMNS = ['user_id'];

function assertSafeColumns(columns) {
    if (!Array.isArray(columns)) {
        throw new RlsError('RLS: invalid insert column specification.');
    }
    for (const column of columns) {
        if (typeof column !== 'string' || !SAFE_COLUMN_PATTERN.test(column)) {
            throw new RlsError('RLS: invalid insert column name.');
        }
        if (FORBIDDEN_IDENTITY_COLUMNS.includes(column)) {
            throw new RlsError('RLS: identity columns are bound server-side and cannot be caller-supplied.');
        }
    }
}

function logSafeDiagnostic(operation, table, error) {
    // Structured, bounded diagnostic. Never includes SQL text, params, or provider payloads.
    const message = error && typeof error.message === 'string' ? error.message.slice(0, 200) : 'unknown error';
    console.error(`[RLS] ${operation} failed for table ${table}: ${message}`);
}

let supabaseAdmin = null;
try {
    supabaseAdmin = require('./supabaseAuth').supabaseAdmin;
} catch (e) {}

/**
 * Build a scoped data-access handle bound to the authenticated request.
 * Every returned helper refuses to run without a server-validated user id and always
 * scopes the query by that exact id.
 *
 * options.supabaseAdmin (test seam) overrides the module-level admin client.
 */
function forRequest(req, db, options = {}) {
    const uid = getAuthenticatedUid(req);
    const admin = options && options.supabaseAdmin !== undefined ? options.supabaseAdmin : supabaseAdmin;

    function assertAuthenticated() {
        if (!uid) {
            throw new RlsError('Unauthorized: user context required for scoped data access.');
        }
        return uid;
    }

    function assertScopedTable(table) {
        if (!USER_SCOPED_TABLES.includes(table)) {
            throw new RlsError(`RLS: table not registered as user-scoped: ${table}`);
        }
    }

    return {
        uid,
        isAuthenticated: Boolean(uid),
        assertAuthenticated,

        /** SELECT rows whose user_id === authenticated uid (tamper-proof binding). */
        async list(table, { orderBy = 'created_at DESC' } = {}) {
            assertAuthenticated();
            assertScopedTable(table);
            if (db) {
                const order = SAFE_ORDER_BY.includes(orderBy) ? orderBy : 'created_at DESC';
                try {
                    return await db.all(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order}`, uid);
                } catch (e) {
                    logSafeDiagnostic('list', table, e);
                    throw new RlsError('RLS: scoped data is temporarily unavailable.');
                }
            }
            if (admin) {
                const { data, error } = await admin.from(table).select('*').eq('user_id', uid);
                if (error) {
                    logSafeDiagnostic('list', table, error);
                    throw new RlsError('RLS: scoped data is temporarily unavailable.');
                }
                return Array.isArray(data) ? data : [];
            }
            return [];
        },

        /**
         * INSERT a row whose user_id is exclusively the validated uid.
         * Caller-supplied identity columns are rejected outright; the owner binding is
         * applied last so no later assignment can replace it.
         */
        async create(table, columns, values) {
            assertAuthenticated();
            assertScopedTable(table);
            assertSafeColumns(columns);
            if (db) {
                const cols = [...columns, 'user_id'];
                const params = [...values, uid];
                const placeholders = params.map(() => '?').join(', ');
                return db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, params);
            }
            if (admin) {
                const rowObj = {};
                columns.forEach((col, idx) => { rowObj[col] = values[idx]; });
                rowObj.user_id = uid; // Owner binding is forced LAST by design.
                const { error } = await admin.from(table).insert([rowObj]);
                if (error) {
                    logSafeDiagnostic('create', table, error);
                    throw new RlsError('RLS: insert failed.');
                }
                return { success: true };
            }
            return undefined;
        },

        /**
         * Hard-delete EVERY row owned by the validated uid across all scoped tables.
         * Every table is attempted; any failure fails closed with a controlled error so
         * account deletion can never report success after a partial purge.
         */
        async purgeAll() {
            assertAuthenticated();
            const failures = [];
            const attemptDelete = async (store, table, run) => {
                try {
                    await run();
                } catch (e) {
                    logSafeDiagnostic('purgeAll', table, e);
                    failures.push({ store, table });
                }
            };

            if (db) {
                for (const table of USER_SCOPED_TABLES) {
                    await attemptDelete('sqlite', table, () => db.run(`DELETE FROM ${table} WHERE user_id = ?`, uid));
                }
            }
            if (admin) {
                for (const table of USER_SCOPED_TABLES) {
                    await attemptDelete('supabase', table, () => admin.from(table).delete().eq('user_id', uid));
                }
            }

            if (failures.length > 0) {
                throw new RlsError('RLS: account data purge failed for one or more scoped tables.');
            }
            return { purged: true };
        }
    };
}

module.exports = { forRequest, RlsError, USER_SCOPED_TABLES };
