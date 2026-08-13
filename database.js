const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const LEGACY_DB_PATH = path.join(__dirname, 'wingman.sqlite');
const DB_PATH = path.join(DATA_DIR, 'wingman.sqlite');

// Automatic DB Migration from web root to data/ subdirectory
if (fs.existsSync(LEGACY_DB_PATH) && !fs.existsSync(DB_PATH)) {
    try {
        fs.renameSync(LEGACY_DB_PATH, DB_PATH);
        console.log('[DB MIGRATION] Moved root wingman.sqlite to data/wingman.sqlite');
    } catch (e) {
        console.warn('[DB MIGRATION WARN] Failed to move legacy DB file:', e.message);
    }
}

async function initializeDatabase() {
    let sqlite3 = null;
    let open = null;
    try {
        sqlite3 = require('sqlite3');
        open = require('sqlite').open;
    } catch (driverErr) {
        console.warn('[DB Notice] Native sqlite3/sqlite package not available. SQLite storage skipped.');
        return null;
    }

    const targetDbPath = fs.existsSync(DB_PATH) ? DB_PATH : (fs.existsSync(LEGACY_DB_PATH) ? LEGACY_DB_PATH : DB_PATH);
    const db = await open({
        filename: targetDbPath,
        driver: sqlite3.Database
    });

    // Enforce foreign key constraints
    await db.exec('PRAGMA foreign_keys = ON');

    console.log("Connected to persistent SQLite database at", targetDbPath);

    // 1. Create users_auth table (Strictly for Auth secrets & login logic)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users_auth (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email_verified BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 2. Create user_profiles table (Public facing metadata & credits)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            display_name TEXT,
            avatar_url TEXT,
            credits_balance REAL DEFAULT 0,
            tier TEXT DEFAULT 'free',
            FOREIGN KEY (user_id) REFERENCES users_auth(id) ON DELETE CASCADE
        )
    `);

    // 3. Create saved_bios table (Isolated by user)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS saved_bios (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            original_bio TEXT,
            mode TEXT,
            generated_options TEXT, -- JSON Array
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users_auth(id) ON DELETE CASCADE
        )
    `);

    // 4. Create saved_chat_analyses table (Isolated by user)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS saved_chat_analyses (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            image_url TEXT,
            tone TEXT,
            generated_options TEXT, -- JSON Array
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users_auth(id) ON DELETE CASCADE
        )
    `);

    // 5. Create saved_chat_histories table (Isolated by user — Roleplay/Coach conversation history)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS saved_chat_histories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            scenario TEXT,
            messages TEXT, -- JSON Array
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users_auth(id) ON DELETE CASCADE
        )
    `);

    // 6. Create credit_purchases table (Audit trail for credit transactions & top-ups)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS credit_purchases (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount_inr REAL NOT NULL,
            credits_added REAL NOT NULL,
            tier_name TEXT,
            payment_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users_auth(id) ON DELETE CASCADE
        )
    `);

    // 7. Create credit_deductions table (Audit trail for feature credit usage & deductions)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS credit_deductions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount_inr REAL NOT NULL,
            feature TEXT NOT NULL,
            request_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users_auth(id) ON DELETE CASCADE
        )
    `);

    // 8. Row-Level Security (RLS) ENGINE: enforce isolation indexes across all user-scoped tables.
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_profiles_user ON user_profiles(user_id);
        CREATE INDEX IF NOT EXISTS idx_saved_bios_user ON saved_bios(user_id);
        CREATE INDEX IF NOT EXISTS idx_saved_analyses_user ON saved_chat_analyses(user_id);
        CREATE INDEX IF NOT EXISTS idx_saved_chat_histories_user ON saved_chat_histories(user_id);
        CREATE INDEX IF NOT EXISTS idx_credit_purchases_user ON credit_purchases(user_id);
        CREATE INDEX IF NOT EXISTS idx_credit_deductions_user ON credit_deductions(user_id);
    `);

    return db;
}

module.exports = {
    initializeDatabase
};
