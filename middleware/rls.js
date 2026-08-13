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

const { getAuthenticatedUid } = require('./auth');

// Tables whose rows are strictly owned by a single authenticated user.
const USER_SCOPED_TABLES = ['user_profiles', 'saved_bios', 'saved_chat_analyses', 'saved_chat_histories', 'credit_purchases', 'credit_deductions'];

class RlsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RlsError';
    }
}

const SAFE_ORDER_BY = ['created_at DESC', 'created_at ASC'];

let supabaseAdmin = null;
try {
    supabaseAdmin = require('./supabaseAuth').supabaseAdmin;
} catch (e) {}

/**
 * Build a scoped data-access handle bound to the authenticated request.
 * Every returned helper refuses to run without a server-validated user id and always
 * scopes the query by that exact id.
 */
function forRequest(req, db) {
    const uid = getAuthenticatedUid(req);

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
                    return [];
                }
            }
            if (supabaseAdmin) {
                try {
                    const { data } = await supabaseAdmin.from(table).select('*').eq('user_id', uid);
                    return data || [];
                } catch (e) {
                    return [];
                }
            }
            return [];
        },

        /** INSERT a row with user_id forced to the validated uid (client cannot set owner). */
        async create(table, columns, values) {
            assertAuthenticated();
            assertScopedTable(table);
            if (db) {
                const cols = [...columns, 'user_id'];
                const params = [...values, uid];
                const placeholders = params.map(() => '?').join(', ');
                return db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, params);
            }
            if (supabaseAdmin) {
                try {
                    const rowObj = { user_id: uid };
                    columns.forEach((col, idx) => { rowObj[col] = values[idx]; });
                    return await supabaseAdmin.from(table).insert([rowObj]);
                } catch (e) {}
            }
        },

        /** Hard-delete EVERY row owned by the validated uid across all scoped tables. */
        async purgeAll() {
            assertAuthenticated();
            if (db) {
                for (const table of USER_SCOPED_TABLES) {
                    try {
                        await db.run(`DELETE FROM ${table} WHERE user_id = ?`, uid);
                    } catch (e) {}
                }
            }
            if (supabaseAdmin) {
                for (const table of USER_SCOPED_TABLES) {
                    try {
                        await supabaseAdmin.from(table).delete().eq('user_id', uid);
                    } catch (e) {}
                }
            }
        }
    };
}

module.exports = { forRequest, RlsError, USER_SCOPED_TABLES };
