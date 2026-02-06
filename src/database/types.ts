/**
 * Common type definitions for the SQL client
 */


/**
 * Configuration for MySQL database connection
 */
export interface SqlConfig {
    host: string;
    user: string;
    password: string;
    database: string;
}

/**
 * User access permissions
 */
export interface UserAccess {
    username: string;
    alltx: boolean;
    swap: boolean;
    deploy: boolean;
}

/**
 * Watchlist entry for a specific user
 */
export interface WatchlistEntry {
    name: string;
    tx_in: boolean;
    tx_out: boolean;
}

/**
 * Database watchlist row
 */
export interface WatchlistRow {
    address: string;
    name: string;
    chat_id: number;
    bot_id: string; // Bot username (e.g., "eth_spybot"), not numeric ID
}

/**
 * Transaction object for signature lookup
 */
export interface Transaction {
    to: string | null;
    data: string;
}

/**
 * Watcher information
 */
export interface Watcher {
    bot_id: string; // Bot username
    username: string;
    name: string;
}