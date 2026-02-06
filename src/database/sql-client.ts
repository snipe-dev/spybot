import mysql from 'mysql2/promise';
import {SqlConfig, UserAccess, Watcher, WatchlistEntry, WatchlistRow} from "./types.js";

/**
 * SQL client for managing database operations with MySQL
 *
 * Handles user access, watchlists, CEX addresses, and function signatures.
 * Provides automatic watchlist updates and caching mechanisms.
 *
 * @remarks
 * Uses bot username (string) as bot_id throughout, maintaining compatibility
 * with existing database schema from JavaScript version.
 */
export class Sql {
    private config: SqlConfig;
    private pool: mysql.Pool | null = null;
    private watchlistInterval: NodeJS.Timeout | null = null;

    // Cached data for fast access
    public access: Record<string, UserAccess> = {};
    public watchlist: Record<string, Record<string, WatchlistEntry>> = {};
    public cex: Record<string, string> = {};

    // Promise that resolves when initialization is complete
    public ready: Promise<this>;

    /**
     * Creates a new SQL client instance
     *
     * @param config - Database connection configuration
     */
    constructor(config: SqlConfig) {
        this.config = config;
        this.ready = this.init(config);
    }

    /**
     * Initializes the database connection pool and loads initial data
     *
     * @param config - Database configuration
     * @returns Promise resolving to this instance
     */
    private async init(config: SqlConfig): Promise<this> {
        try {
            this.pool = mysql.createPool({
                host: config.host,
                user: config.user,
                password: config.password,
                waitForConnections: true,
                multipleStatements: true,
                namedPlaceholders: true,
                connectionLimit: 10,
                connectTimeout: 10000,
                queueLimit: 0
            });

            const connection = await this.pool.getConnection();
            connection.release();
            console.log('[  SQL   ]', config.host, 'SQL initialized');

            // Load initial data in parallel for faster startup
            await Promise.all([
                this.updateAccess(),
                this.updateWatchlist(),
                this.updateCex()
            ]);

            // Start automatic watchlist updates every 2 seconds
            this.startWatchlistAutoUpdate();

            return this;
        } catch (error) {
            console.error('[  SQL   ]', config.host, 'SQL initialize error:', error);
            throw error;
        }
    }

    /**
     * Starts automatic watchlist updates at regular intervals
     */
    private startWatchlistAutoUpdate(): void {
        if (this.watchlistInterval) {
            clearInterval(this.watchlistInterval);
        }

        this.watchlistInterval = setInterval(async () => {
            try {
                await this.updateWatchlist();
            } catch (error) {
                console.error('[  SQL   ]', 'Auto update_watchlist failed:', error);
            }
        }, 2000);
    }

    /**
     * Stops automatic watchlist updates
     */
    public stopWatchlistAutoUpdate(): void {
        if (this.watchlistInterval) {
            clearInterval(this.watchlistInterval);
            this.watchlistInterval = null;
        }
    }

    /**
     * Updates the access cache from database
     *
     * Loads all user permissions into memory for fast lookups
     *
     * @remarks
     * Access keys are formatted as: {chat_id}@{bot_id}
     * where bot_id is the bot username (e.g., "eth_spybot")
     */
    public async updateAccess(): Promise<void> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT chat_id, bot_id, username, alltx, swap, deploy FROM ${this.config.database}.access`
            );

            const newAccess: Record<string, UserAccess> = {};

            for (const row of rows) {
                // Format: {chat_id}@{bot_username}
                const id = `${row.chat_id}@${row.bot_id}`;
                newAccess[id] = {
                    username: row.username,
                    alltx: row.alltx === 1,
                    swap: row.swap === 1,
                    deploy: row.deploy === 1
                };
            }

            this.access = newAccess;
        } catch (error) {
            console.error('[  SQL   ]', 'Error in updateAccess:', error);
        }
    }

    /**
     * Updates the watchlist cache from database
     *
     * Loads all non-blocked watchlist entries into memory
     *
     * @remarks
     * Watchlist structure: {address: {userKey: WatchlistEntry}}
     * where userKey = {chat_id}@{bot_username}
     */
    public async updateWatchlist(): Promise<void> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT address, name, chat_id, bot_id FROM ${this.config.database}.watchlist WHERE blocked = 0`
            );

            const newWatchlist: Record<string, Record<string, WatchlistEntry>> = {};

            for (const row of rows) {

                // Normalize address to lowercase
                const address = row.address.toLowerCase();

                if (!newWatchlist[address]) {
                    newWatchlist[address] = {};
                }

                // User key format: {chat_id}@{bot_username}
                const userId = `${row.chat_id}@${row.bot_id}`;

                newWatchlist[address][userId] = {
                    name: row.name,
                    tx_in: false,
                    tx_out: true
                };
            }

            this.watchlist = newWatchlist;

            console.log('[  SQL   ]',
                "Watchlist loaded. Entries:",
                Object.keys(this.watchlist).length
            );

        } catch (error) {
            console.error('[  SQL   ]', 'Error in updateWatchlist:', error);
        }
    }


    /**
     * Updates the CEX address cache from database
     *
     * Loads known centralized exchange addresses
     */
    public async updateCex(): Promise<void> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                'SELECT address, name FROM net_tools.cex WHERE 1'
            );

            const newCex: Record<string, string> = {};

            for (const row of rows) {
                newCex[row.address] = row.name;
            }

            this.cex = newCex;
        } catch (error) {
            console.error('[  SQL   ]', 'Error in updateCex:', error);
        }
    }

    /**
     * Retrieves user's watchlist from database
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @returns Array of watchlist entries
     */
    public async getUserWatchlist(chatId: number, botId: string): Promise<WatchlistRow[]> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT address, name FROM ${this.config.database}.watchlist WHERE chat_id = :chat_id AND bot_id = :bot_id`,
                { chat_id: chatId, bot_id: botId }
            );

            return rows as WatchlistRow[];
        } catch (error) {
            console.error('[  SQL   ]', 'Error in getUserWatchlist:', error);
            return [];
        }
    }

    /**
     * Adds or updates an address in user's watchlist
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @param username - User's Telegram username
     * @param address - Blockchain address to watch
     * @param name - Custom name for the address
     * @returns True if new address was added, false if updated
     */
    public async addAddress(
        chatId: number,
        botId: string,
        username: string,
        address: string,
        name: string
    ): Promise<boolean> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const timestamp = Math.floor(Date.now() / 1000);

            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT * FROM ${this.config.database}.watchlist WHERE chat_id = :chat_id AND bot_id = :bot_id AND address = :address`,
                { chat_id: chatId, bot_id: botId, address }
            );

            if (rows.length > 0) {
                // Update existing entry
                await this.pool.execute(
                    `UPDATE ${this.config.database}.watchlist SET name = :name, time = :time WHERE address = :address AND chat_id = :chat_id AND bot_id = :bot_id`,
                    { name, time: timestamp, address, chat_id: chatId, bot_id: botId }
                );
                await this.updateWatchlist();
                return false;
            } else {
                // Insert new entry
                await this.pool.execute(
                    `INSERT INTO ${this.config.database}.watchlist (address, chat_id, bot_id, username, name, time) VALUES (:address, :chat_id, :bot_id, :username, :name, :time)`,
                    { address, chat_id: chatId, bot_id: botId, username, name, time: timestamp }
                );
                await this.updateWatchlist();

                return true;
            }
        } catch (error) {
            console.error('[  SQL   ]', `Error in addAddress (chat_id: ${chatId}, bot_id: ${botId}, address: ${address}):`, error);
            return false;
        }
    }

    /**
     * Removes an address from user's watchlist
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @param address - Address to remove
     * @returns True if successful
     */
    public async deleteAddress(chatId: number, botId: string, address: string): Promise<boolean> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            await this.pool.execute(
                `DELETE FROM ${this.config.database}.watchlist WHERE address = :address AND chat_id = :chat_id AND bot_id = :bot_id`,
                { address, chat_id: chatId, bot_id: botId }
            );
            await this.updateWatchlist();
            return true;
        } catch (error) {
            console.error('[  SQL   ]', `Error in deleteAddress (chat_id: ${chatId}, bot_id: ${botId}, address: ${address}):`, error);
            return false;
        }
    }

    /**
     * Updates the custom name for a watched address
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @param address - Address to update
     * @param name - New name
     * @returns True if successful
     */
    public async setName(chatId: number, botId: string, address: string, name: string): Promise<boolean> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT * FROM ${this.config.database}.watchlist WHERE chat_id = :chat_id AND bot_id = :bot_id AND address = :address`,
                { chat_id: chatId, bot_id: botId, address }
            );

            if (rows.length > 0) {
                await this.pool.execute(
                    `UPDATE ${this.config.database}.watchlist SET name = :name WHERE chat_id = :chat_id AND bot_id = :bot_id AND address = :address`,
                    { name, chat_id: chatId, bot_id: botId, address }
                );
                await this.updateWatchlist();
                return true;
            }

            return false;
        } catch (error) {
            console.error('[  SQL   ]', `Error in setName (chat_id: ${chatId}, bot_id: ${botId}, address: ${address}):`, error);
            return false;
        }
    }

    /**
     * Sets the blocked state for all user's watchlist entries
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @param state - Blocked state (1 = blocked, 0 = unblocked)
     * @returns True if successful
     */
    public async setBlocked(chatId: number, botId: string, state: number): Promise<boolean> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            await this.pool.execute(
                `UPDATE ${this.config.database}.watchlist SET blocked = :state WHERE chat_id = :chat_id AND bot_id = :bot_id`,
                { state, chat_id: chatId, bot_id: botId }
            );
            await this.updateWatchlist();
            return true;
        } catch (error) {
            console.error('[  SQL   ]', `Error in setBlocked (chat_id: ${chatId}, bot_id: ${botId}):`, error);
            return false;
        }
    }

    /**
     * Clears all entries from user's watchlist
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @returns True if successful
     */
    public async clearWatchlist(chatId: number, botId: string): Promise<boolean> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            await this.pool.execute(
                `DELETE FROM ${this.config.database}.watchlist WHERE chat_id = :chat_id AND bot_id = :bot_id`,
                { chat_id: chatId, bot_id: botId }
            );
            await this.updateWatchlist();
            return true;
        } catch (error) {
            console.error('[  SQL   ]', `Error in clearWatchlist (chat_id: ${chatId}, bot_id: ${botId}):`, error);
            return false;
        }
    }

    /**
     * Adds a new user to the access table
     *
     * Uses INSERT IGNORE to avoid duplicates
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @param username - User's Telegram username
     * @returns True if successful
     */
    public async addUser(chatId: number, botId: string, username: string): Promise<boolean> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            await this.pool.execute(
                `INSERT IGNORE INTO ${this.config.database}.access (chat_id, bot_id, username) VALUES (:chat_id, :bot_id, :username)`,
                { chat_id: chatId, bot_id: botId, username }
            );
            await this.updateAccess();

            return true;
        } catch (error) {
            console.error('[  SQL   ]', `Error in addUser (chat_id: ${chatId}, bot_id: ${botId}):`, error);
            return false;
        }
    }

    /**
     * Retrieves all watchers for a specific address
     *
     * @param address - Blockchain address
     * @returns Array of watcher information
     */
    public async getAllWatchers(address: string): Promise<Watcher[]> {
        if (!this.pool) throw new Error('Pool not initialized');

        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT name, bot_id, username FROM ${this.config.database}.watchlist WHERE address = :address`,
                { address }
            );

            return rows.map(row => ({
                bot_id: row.bot_id,
                username: row.username,
                name: row.name
            }));
        } catch (error) {
            console.error('[  SQL   ]', `Error in getAllWatchers (address: ${address}):`, error);
            return [];
        }
    }

    /**
     * Checks if a user has access permissions
     *
     * @param chatId - Telegram chat ID
     * @param botId - Bot username (e.g., "eth_spybot")
     * @returns True if user has access
     *
     * @remarks
     * Access key format: {chatId}@{botId}
     * Example: "955954371@eth_spybot"
     */
    public checkAccess(chatId: number, botId: string): boolean {
        try {
            const id = `${chatId}@${botId}`;
            console.log('Check Access:', id, id in this.access, this.access[id]?.username);
            return id in this.access;
        } catch (error) {
            console.error('[  SQL   ]', 'Error in checkAccess:', error);
            return false;
        }
    }

    /**
     * Closes the database connection pool and stops auto-updates
     */
    public async close(): Promise<void> {
        this.stopWatchlistAutoUpdate();

        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }
}