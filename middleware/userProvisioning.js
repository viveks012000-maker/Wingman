/**
 * =========================================================================================
 * WINGMAN USER AUTO-PROVISIONING MIDDLEWARE
 * =========================================================================================
 * Automatically ensures a local SQLite profile and FK-safe auth record exist for any
 * authenticated Supabase user on every incoming request.
 * Prevents credit deduction failures and zero-touch onboarding RLS mismatches.
 * =========================================================================================
 */

function createUserProvisioningMiddleware(dbGetter) {
    return async function autoProvisionUser(req, res, next) {
        if (req.user && req.user.id && req.user.id !== 'guest_user') {
            try {
                const db = typeof dbGetter === 'function' ? dbGetter() : dbGetter;
                if (db) {
                    const uid = String(req.user.id);
                    const email = req.user.email || null;

                    const profileRow = await db.get('SELECT user_id FROM user_profiles WHERE user_id = ?', [uid]);
                    if (!profileRow) {
                        let authRow = await db.get('SELECT id FROM users_auth WHERE id = ?', [uid]);

                        if (!authRow) {
                            const targetEmail = (email && email.includes('@')) ? email : `${uid}@user.local`;
                            const existingEmailRow = await db.get('SELECT id FROM users_auth WHERE email = ?', [targetEmail]);
                            if (existingEmailRow) {
                                try {
                                    await db.run('UPDATE users_auth SET id = ? WHERE email = ?', [uid, targetEmail]);
                                } catch (e) {
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
                                } catch (e) {
                                    const fallbackEmail = `${uid}@user.local`;
                                    await db.run(
                                        'INSERT OR IGNORE INTO users_auth (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)',
                                        [uid, fallbackEmail, 'supabase_auth', 1, new Date().toISOString()]
                                    );
                                }
                            }
                        }

                        try {
                            await db.run(
                                'INSERT OR IGNORE INTO user_profiles (user_id, display_name, credits_balance, tier) VALUES (?, ?, ?, ?)',
                                [uid, (email && email.includes('@')) ? email.split('@')[0] : 'MyWingman User', 0, 'free']
                            );
                        } catch (e) {}
                    }
                }
            } catch (err) {
                console.warn('[userProvisioning Notice]:', err.message);
            }
        }
        next();
    };
}

module.exports = { createUserProvisioningMiddleware };
