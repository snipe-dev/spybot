import Database from 'better-sqlite3';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQLite database instance
let db: Database.Database | null = null;

/**
 * Initializes the SQLite database connection
 * @returns Database instance
 */
function getDatabase(): Database.Database {
    if (!db) {
        const dbPath = path.join(__dirname, '..', 'selectors', 'selectors.db');
        db = new Database(dbPath, { readonly: false });

        // Ensure table exists with index
        db.exec(`
            CREATE TABLE IF NOT EXISTS selectors (
                selector TEXT PRIMARY KEY,
                signature TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_signature ON selectors(signature);
        `);
    }
    return db;
}

/**
 * Fetches function signature from OpenChain API
 * @param selector - Function selector (e.g., '0xa9059cbb')
 * @returns Function name or original selector if not found
 */
export async function openchain(selector: string): Promise<string> {
    try {
        const response = await fetch(
            `https://api.4byte.sourcify.dev/signature-database/v1/lookup?function=${selector}&filter=true`
        );
        const data = await response.json();
        if (data.result.function[selector]) {
            return data.result.function[selector][0].name;
        }
    } catch (error) {
        // Silently fail and return selector
    }
    return selector;
}

/**
 * Fetches function signature from 4byte directory API
 * @param selector - Function selector (e.g., '0xa9059cbb')
 * @returns Function signature or original selector if not found
 */
export async function fourByte(selector: string): Promise<string> {
    try {
        const response = await fetch(
            `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`
        );
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            return data.results[0]['text_signature'];
        }
    } catch (error) {
        // Silently fail and return selector
    }
    return selector;
}

/**
 * Resolves a function selector to its signature
 *
 * Resolution order:
 * 1. Check local SQLite cache
 * 2. Query OpenChain and 4byte APIs in parallel
 * 3. Cache the result if found
 * 4. Return selector if not found anywhere
 *
 * @param selector - Function selector (e.g., '0xa9059cbb')
 * @returns Function signature or original selector if not resolved
 */
export async function resolveSelector(selector: string): Promise<string> {
    const database = getDatabase();

    // Check local cache first
    const cached = database.prepare('SELECT signature FROM selectors WHERE selector = ?').get(selector) as { signature: string } | undefined;

    if (cached) {
        return cached.signature;
    }

    // Query both APIs in parallel
    const [openchainResult, fourByteResult] = await Promise.all([
        openchain(selector),
        fourByte(selector)
    ]);

    // Determine which result to use
    let signature: string | null = null;

    if (openchainResult !== selector) {
        signature = openchainResult;
    } else if (fourByteResult !== selector) {
        signature = fourByteResult;
    }

    // Cache the result if found
    if (signature) {
        try {
            database.prepare('INSERT OR IGNORE INTO selectors (selector, signature) VALUES (?, ?)').run(selector, signature);
        } catch (error) {
            console.error('[  SYS   ]', 'Failed to cache selector:', error);
        }
        return signature;
    }

    // Nothing found, return original selector
    return selector;
}

/**
 * Shortens a function signature by removing parameters
 *
 * @param signature - Full function signature (e.g., "transfer(address,uint256)")
 * @returns Short signature with empty parentheses (e.g., "transfer()")
 *
 * @example
 * shortSignature("transferFrom(address,address,uint256)") // "transferFrom()"
 * shortSignature("balanceOf(address)") // "balanceOf()"
 * shortSignature("0xa9059cbb") // "0xa9059cbb" (selector unchanged)
 */
export function shortSignature(signature: string): string {
    const parenIndex = signature.indexOf('(');
    if (parenIndex === -1) {
        return signature;
    }
    return signature.substring(0, parenIndex) + '()';
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