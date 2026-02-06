import Database from 'better-sqlite3';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQLite database instance
let db: Database.Database | null = null;

// In-memory cache for ENS records
let cache: Map<string, string> | null = null;

/**
 * Initializes the SQLite database connection
 * @returns Database instance
 */
function getDatabase(): Database.Database {
    if (!db) {
        const dbPath = path.join(__dirname, '..', 'ens', 'ens.db');
        db = new Database(dbPath, { readonly: false });

        // Ensure table exists with index
        db.exec(`
            CREATE TABLE IF NOT EXISTS ens (
                address TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_address ON ens(address);
        `);
    }
    return db;
}

/**
 * Loads all ENS records into memory cache as a Map
 * Call this once to reduce database queries
 * @returns Cached ENS records as Map<address, name>
 */
export function loadCache(): Map<string, string> {
    const database = getDatabase();

    const rows = database.prepare('SELECT address, name FROM ens').all() as { address: string, name: string }[];

    cache = new Map<string, string>();
    for (const row of rows) {
        // Normalize addresses to lowercase for consistent lookups
        cache.set(row.address.toLowerCase(), row.name);
    }

    closeDatabase();

    return cache;
}

/**
 * Returns the current cache or loads it if not loaded
 * @returns Cached ENS records as Map<address, name>
 */
export function getENSCache(): Map<string, string> {
    if (!cache) {
        return loadCache();
    }
    return cache;
}

/**
 * Closes the database connection
 * Call this when shutting down the application
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
    }
}