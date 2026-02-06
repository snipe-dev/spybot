import Database from 'better-sqlite3';
import path from 'path';
import {fileURLToPath} from 'url';
import {TokenMetadata} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * TokenCache provides a lightweight local SQLite cache
 * for confirmed ERC20 token metadata.
 *
 * Design principles:
 * - Cache only positive (confirmed) token results
 * - Never cache negative or temporary failures
 * - Allow tokens to become resolvable over time
 *
 * This design avoids missing freshly deployed or
 * partially initialized tokens.
 */
export class TokenCache {
    private db: Database.Database;
    private dbPath: string;
    private getTokenStmt!: Database.Statement;
    private insertTokenStmt!: Database.Statement;

    /**
     * @param dbPath - Optional custom path to SQLite database file.
     * If not provided, uses default path relative to module location.
     */
    constructor(dbPath?: string) {
        // Use provided path or default to module-relative path
        if (dbPath) {
            this.dbPath = path.isAbsolute(dbPath)
                ? dbPath
                : path.join(process.cwd(), dbPath);
        } else {
            // Default path relative to module location, consistent with signature-resolver.ts
            this.dbPath = path.join(__dirname, '..', 'tracer', 'token-cache.db');
        }

        this.db = new Database(this.dbPath);
        this.initDatabase();
        this.prepareStatements();
    }

    /**
     * Initializes database schema and indexes.
     * Called once during construction.
     */
    private initDatabase(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tokens (
                address TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                decimals INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tokens_address
                ON tokens(address);
        `);
    }

    /**
     * Prepares frequently used SQL statements.
     * Statements are reused to avoid repeated parsing.
     */
    private prepareStatements(): void {
        this.getTokenStmt = this.db.prepare(
            'SELECT symbol, decimals FROM tokens WHERE address = ?'
        );

        this.insertTokenStmt = this.db.prepare(
            'INSERT OR IGNORE INTO tokens (address, symbol, decimals) VALUES (?, ?, ?)'
        );
    }

    /**
     * Returns cached token metadata for a single address.
     *
     * @param address - Contract address
     * @returns Token metadata or null
     */
    getToken(address: string): TokenMetadata | null {
        try {
            const row = this.getTokenStmt.get(address.toLowerCase()) as
                { symbol: string; decimals: number } | undefined;

            return row ? { symbol: row.symbol, decimals: row.decimals } : null;
        } catch (e) {
            console.error('TokenCache.getToken error:', e);
            return null;
        }
    }

    /**
     * Returns cached token metadata for multiple addresses.
     * Only addresses that exist in cache are included.
     *
     * @param addresses - Array of contract addresses
     * @returns Map of address to token metadata
     */
    getTokens(addresses: string[]): Record<string, TokenMetadata> {
        if (!addresses || !addresses.length) return {};

        const result: Record<string, TokenMetadata> = {};

        for (const address of addresses) {
            const token = this.getToken(address);
            if (token) {
                result[address.toLowerCase()] = token;
            }
        }

        return result;
    }

    /**
     * Stores a confirmed ERC20 token in cache.
     *
     * @param address - Token contract address
     * @param symbol - Token symbol
     * @param decimals - Token decimals
     * @returns Success status
     */
    addToken(address: string, symbol: string, decimals: number): boolean {
        try {
            this.insertTokenStmt.run(
                address.toLowerCase(),
                symbol,
                decimals
            );
            return true;
        } catch (e) {
            console.error('TokenCache.addToken error:', e);
            return false;
        }
    }

    /**
     * Closes the underlying SQLite database.
     */
    close(): void {
        this.db.close();
    }
}
