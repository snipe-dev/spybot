import {Bot, Context, InlineKeyboard, InputFile} from "grammy";
import {Message} from "grammy/types";
import {PROMO_MESSAGE_CAPTION, PROMO_MESSAGE_KEYBOARD} from "./bot-messages.js";
import {getChecksumAddress, isValidAddress} from "./address-utils.js";
import {applyDefaults} from "./apply-defaults.js";
import {Sql} from "../database/sql-client.js";
import * as fs from "fs";
import {dirname, join} from "path";
import {Sender, SpybotConfig} from "./types.js";
import {fileURLToPath} from "url";


/**
 * Spybot - Telegram bot for wallet monitoring and contract analysis.
 * Handles user commands, watchlist management, and blockchain interactions.
 */
export class TelegramBot {
    private bot: Bot;
    private sql: Sql;

    private readonly owner: number;
    private readonly openAccess: boolean;
    private readonly explorer: string;
    private botId: string = ""; // Bot username (e.g., "eth_spybot")
    private username: string = "";

    private rebootInProgress: boolean = false;
    private waitingForReply: Map<string, string> = new Map();

    // Handler registries
    private commandHandlers: Record<string, (sender: Sender) => Promise<void>> = {};
    private callbackHandlers: Record<string, (sender: Sender, ...args: string[]) => Promise<void>> = {};
    private commandExecutors: Record<string, (sender: Sender, text: string) => Promise<void>> = {};

    // Promotional image
    private promoImage: InputFile | undefined;

    /**
     * Creates a new TelegramBot instance.
     *
     * @param bot - Grammy Bot instance
     * @param sql - SQL database client
     * @param config - Bot configuration
     */
    constructor(bot: Bot, sql: Sql, config: SpybotConfig) {
        this.bot = bot;
        this.sql = sql;
        this.owner = config.owner;
        this.openAccess = config.open_access;
        this.explorer = config.explorer;

        // Apply defaults to all API calls via middleware
        this.setupApiMiddleware();

        this.loadPromoImage();
        this.registerHandlers();

        // Automatically start polling
        this.start().catch(err => {
            console.error('[  BOT   ]', "Failed to start bot:", err);
        });
    }

    /**
     * Sets up API middleware to apply default message settings.
     */
    private setupApiMiddleware(): void {
        this.bot.api.config.use((prev, method, payload) => {
            applyDefaults(method, payload);
            return prev(method, payload);
        });
    }

    /**
     * Initialize bot information and setup commands.
     */
    async initialize(): Promise<void> {
        try {
            const me = await this.bot.api.getMe();
            this.username = me.username || "";
            this.botId = me.username?.toLowerCase() || "";
            console.log('[  BOT   ]', `Bot initialized: @${this.username} (${this.botId})`);

            await this.bot.api.setMyCommands([
                { command: "add", description: "Add address to watchlist" },
                { command: "del", description: "Delete address from watchlist" },
                { command: "list", description: "Show all addresses from your watchlist" },
                { command: "name", description: "Set address name" },
                { command: "clear", description: "Clear my watchlist" },
                { command: "export", description: "Export all addresses from your watchlist" },
                { command: "start", description: "Start or restart bot" }
            ]);
        } catch (error) {
            console.error('[  BOT   ]', "Failed to initialize bot:", error);
        }
    }

    /**
     * Start bot polling and send startup notification.
     */
    async start(): Promise<void> {
        await this.initialize();

        await this.bot.start({
            onStart: async () => {
                console.log('[  BOT   ]', `Bot @${this.username} started polling`);

                // Send notification asynchronously without blocking startup
                try {
                    await this.bot.api.sendMessage(this.owner, "🟢 Bot started");
                    console.log('[  BOT   ]', `Startup notification sent to owner (ID: ${this.owner})`);
                } catch (error) {
                    console.warn('[  BOT   ]', "Error sending startup notification:", error);
                }
            }
        });
    }

    /**
     * Load promotional image for welcome messages.
     */
    private loadPromoImage(): void {
        try {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const imagePath = join(__dirname, '..', 'assets', `_spy.png`);
            if (fs.existsSync(imagePath)) {
                this.promoImage = new InputFile(imagePath);
            } else {
                console.warn('[  BOT   ]', `Could not load ${imagePath}, falling back to text-only messages`);
            }
        } catch (error) {
            console.warn('[  BOT   ]', "Error loading image:", error);
        }
    }

    /**
     * Register all command and callback handlers.
     */
    private registerHandlers(): void {
        // Register command handlers
        this.commandHandlers = {
            add: this.handleAddCommand.bind(this),
            del: this.handleDelCommand.bind(this),
            list: this.handleListCommand.bind(this),
            name: this.handleNameCommand.bind(this),
            clear: this.handleClearCommand.bind(this),
            export: this.handleExportCommand.bind(this),
            start: this.handleStartCommand.bind(this),
            reboot: this.handleRebootCommand.bind(this)
        };

        // Register callback handlers (only for adding users)
        this.callbackHandlers = {
            add_user: this.handleAddNewUser.bind(this),
            reboot: this.handleRebootCommand.bind(this)
        };

        // Register command executors
        this.commandExecutors = {
            add: this.executeAddCommand.bind(this),
            del: this.executeDelCommand.bind(this),
            name: this.executeNameCommand.bind(this),
            clear: this.executeClearCommand.bind(this)
        };

        // Setup Grammy message handler
        this.bot.on("message", async (ctx) => {
            try {
                await this.handleMessage(ctx);
            } catch (err) {
                console.error('[  BOT   ]', "Error in handleMessage:", err);
            }
        });

        // Setup Grammy callback query handler
        this.bot.on("callback_query:data", async (ctx) => {
            try {
                await this.handleCallback(ctx);
            } catch (err) {
                console.error('[  BOT   ]', "Error in handleCallback:", err);
            }
        });
    }

    /**
     * Handle incoming messages.
     */
    private async handleMessage(ctx: Context): Promise<void> {
        const msg = ctx.message;
        if (!msg || !msg.text) return;

        const sender = this.parseSender(msg);
        if (!sender) return;

        const text = msg.text.trim();
        const key = this.messageKey(msg);

        // Handle reboot confirmation
        if (this.rebootInProgress && sender.chatId === this.owner) {
            if (text.toLowerCase() === "yes") {
                await ctx.reply("🔄 Rebooting...");
                setTimeout(() => process.exit(0), 1000);
            }
            this.rebootInProgress = false;
            return;
        }

        // Check if waiting for user input
        if (this.waitingForReply.has(key)) {
            const command = this.waitingForReply.get(key)!;
            this.waitingForReply.delete(key);

            const executor = this.commandExecutors[command];
            if (executor) {
                await executor(sender, text);
            }
            return;
        }

        // Handle bot commands
        if (this.isBotCommand(text)) {
            if (!this.isCommandForThisBot(text)) {
                return;
            }

            const command = this.extractCommand(text);
            if (!command) return;

            const handler = this.commandHandlers[command];
            if (handler) {
                await handler(sender);
            }
            return;
        }

        // Default: handle as potential watchlist input
        if (this.checkAccess(sender.chatId)) {
            await this.executeAddCommand(sender, text);
        }
    }

    /**
     * Handle callback queries.
     */
    private async handleCallback(ctx: Context): Promise<void> {
        const query = ctx.callbackQuery;
        if (!query || !query.data) return;

        const msg = query.message;
        if (!msg) return;

        const sender = this.parseSender(msg);
        if (!sender) return;

        await ctx.answerCallbackQuery();

        const [command, args] = this.parseCallbackQuery(query.data);
        if (!command) return;

        const handler = this.callbackHandlers[command];
        if (handler) {
            await handler(sender, ...args);
        }
    }


    /**
     * Handle /add command - request addresses to add to watchlist.
     */
    private async handleAddCommand(sender: Sender): Promise<void> {
        if (!this.checkAccess(sender.chatId)) {
            await this.sendNewUserMessage(sender);
            return;
        }

        const answer = `<b>ADD ADDRESS.</b>\nOK. Send me a list of addresses to add to the watchlist. Please use this format:\n\n<i>address1 - name\naddress2 - name</i>`;
        await this.bot.api.sendMessage(sender.chatId, answer);

        const key = `${sender.chatId}:${sender.userId}`;
        this.waitingForReply.set(key, "add");
    }

    /**
     * Handle /del command - request addresses to remove from watchlist.
     */
    private async handleDelCommand(sender: Sender): Promise<void> {
        if (!this.checkAccess(sender.chatId)) return;

        const answer = `<b>DEL ADDRESS.</b>\nOK. Send me a list of addresses to delete from the watchlist. Please use this format:\n\n<i>address1\naddress2</i>`;
        await this.bot.api.sendMessage(sender.chatId, answer);

        const key = `${sender.chatId}:${sender.userId}`;
        this.waitingForReply.set(key, "del");
    }

    /**
     * Handle /list command - show user's watchlist.
     */
    private async handleListCommand(sender: Sender): Promise<void> {
        if (!this.checkAccess(sender.chatId)) return;

        const addresses = await this.sql.getUserWatchlist(sender.chatId, this.botId);

        if (addresses.length === 0) {
            await this.bot.api.sendMessage(sender.chatId, "Your watchlist is empty.\n");
            return;
        }

        let answer = `YOUR WATCHLIST (<b>${addresses.length}</b>):\n\n`;

        for (const item of addresses) {
            answer += `[ ${item.name} ]\n`;
            answer += `<a href="${this.explorer}address/${item.address}/">➥</a> <code>${item.address}</code>\n\n`;

            // Split message when reaching limit
            if (answer.length >= 4000) {
                await this.bot.api.sendMessage(sender.chatId, answer);
                answer = '';
            }
        }

        if (answer.length > 0) {
            await this.bot.api.sendMessage(sender.chatId, answer);
        }
    }

    /**
     * Handle /name command - request address and name for renaming.
     */
    private async handleNameCommand(sender: Sender): Promise<void> {
        if (!this.checkAccess(sender.chatId)) return;

        const answer = `<b>SET NAME.</b>\nOK. Send me an address to set a name. Please use this format:\n\n<i>address - name</i>`;
        await this.bot.api.sendMessage(sender.chatId, answer);

        const key = `${sender.chatId}:${sender.userId}`;
        this.waitingForReply.set(key, "name");
    }

    /**
     * Handle /clear command - request confirmation to clear watchlist.
     */
    private async handleClearCommand(sender: Sender): Promise<void> {
        if (!this.checkAccess(sender.chatId)) return;

        const answer = `<b>CLEAR WATCHLIST.</b>\nOK. Type <code>YES</code> to confirm cleaning. This operation cannot be undone!`;
        await this.bot.api.sendMessage(sender.chatId, answer);

        const key = `${sender.chatId}:${sender.userId}`;
        this.waitingForReply.set(key, "clear");
    }

    /**
     * Handle /export command - export watchlist as plain text.
     */
    private async handleExportCommand(sender: Sender): Promise<void> {
        if (!this.checkAccess(sender.chatId)) return;

        const addresses = await this.sql.getUserWatchlist(sender.chatId, this.botId);

        if (addresses.length === 0) {
            await this.bot.api.sendMessage(sender.chatId, "Your watchlist is empty.\n");
            return;
        }

        let answer = '';
        for (const item of addresses) {
            answer += `${item.address} - ${item.name}\n`;

            // Split message when reaching limit
            if (answer.length >= 4000) {
                await this.bot.api.sendMessage(sender.chatId, answer);
                answer = '';
            }
        }

        if (answer.length > 0) {
            await this.bot.api.sendMessage(sender.chatId, answer);
        }
    }

    /**
     * Handle /start command - send welcome message and check access.
     */
    private async handleStartCommand(sender: Sender): Promise<void> {
        await this.sendPromoMessage(sender.chatId);

        if (sender.chatId === this.owner) {
            // Add owner to database if not exists
            if (!this.sql.checkAccess(sender.chatId, this.botId)) {
                await this.sql.addUser(sender.chatId, this.botId, sender.fullname);
            }
            await this.sql.setBlocked(sender.chatId, this.botId, 0);
            return;
        }

        // Check access for other users
        if (this.checkAccess(sender.chatId)) {
            await this.sql.setBlocked(sender.chatId, this.botId, 0);
        } else {
            if (this.openAccess) {
                // Automatically add user when openAccess = true
                await this.sql.addUser(sender.chatId, this.botId, sender.fullname);

                // Notify user
                await this.bot.api.sendMessage(sender.chatId, `Access granted to ${sender.fullname}`);

                // Notify owner
                const msg = `Access granted to: \nusername: ${sender.fullname}\nuser_id: <code>${sender.chatId}</code>`;
                await this.bot.api.sendMessage(this.owner, msg);

                // Remove block
                await this.sql.setBlocked(sender.chatId, this.botId, 0);
            } else {
                // Only notify owner for private bots
                await this.sendNewUserMessage(sender);
            }
        }
    }

    /**
     * Handle reboot command - request confirmation from owner.
     */
    private async handleRebootCommand(sender: Sender): Promise<void> {
        if (sender.chatId !== this.owner) return;

        this.rebootInProgress = true;
        await this.bot.api.sendMessage(this.owner, `⭕️ Restart program...`);
        console.log('[  BOT   ]', 'Manual reboot initiated by owner...');
        setTimeout(() => process.exit(1), 2000);
    }

    /**
     * Handle new user addition callback (admin only).
     */
    private async handleAddNewUser(sender: Sender, ...args: string[]): Promise<void> {
        if (sender.chatId !== this.owner) return;

        const chatIdStr = args[0];
        const username = args[1] || "unknown";

        if (!chatIdStr) return;

        const chatId = parseInt(chatIdStr);

        try {
            await this.sql.addUser(chatId, this.botId, username);
            await this.bot.api.sendMessage(chatId, `Access granted to ${username}`, {});

            const msg = `Access granted to: \nusername: ${username}\nuser_id: <code>${chatId}</code>`;
            await this.bot.api.sendMessage(this.owner, msg);

            console.log('[  BOT   ]', 'Access granted to:', chatId, username);
        } catch (e) {
            console.error('[  BOT   ]', e);
        }
    }


    /**
     * Execute address addition from user input.
     */
    private async executeAddCommand(sender: Sender, text: string): Promise<void> {
        let answer = '';

        if (text.length >= 42) {
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const [addrPart, namePart] = line.includes('-') ? line.split('-') : [line, ''];
                const addr = addrPart.trim();
                const name = namePart.trim();

                if (isValidAddress(addr)) {
                    const checksumAddr = getChecksumAddress(addr);

                    if (await this.sql.addAddress(sender.chatId, this.botId, sender.username, checksumAddr, name)) {
                        answer += `${i + 1} : <code>${checksumAddr}</code> ${name} \n✅ Added to watchlist.\n`;
                    } else {
                        answer += `${i + 1} : <code>${checksumAddr}</code> ${name} \n☑️ Already exists.\n`;
                    }
                } else {
                    answer += `${i + 1} : <code>${addr}</code> ${name} \n⛔️ Wrong Address!\n`;
                }

                // Split message when reaching limit
                if (answer.length >= 4000) {
                    await this.bot.api.sendMessage(sender.chatId, answer);
                    answer = '';
                }
            }
        } else {
            answer = '⛔️ Wrong format!';
        }

        if (answer.length > 0) {
            await this.bot.api.sendMessage(sender.chatId, answer);
        }
    }

    /**
     * Execute address deletion from user input.
     */
    private async executeDelCommand(sender: Sender, text: string): Promise<void> {
        let answer = '';

        if (text.length >= 42) {
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const [addrPart, namePart] = line.includes('-') ? line.split('-') : [line, ''];
                const addr = addrPart.trim();
                const name = namePart.trim();

                if (isValidAddress(addr)) {
                    const checksumAddr = getChecksumAddress(addr);
                    await this.sql.deleteAddress(sender.chatId, this.botId, checksumAddr);
                    answer += `${i + 1} : <code>${checksumAddr}</code> ${name} \n✅ Removed from watchlist.\n`;
                } else {
                    answer += `<code>${addr}</code> \n⛔️ Wrong Address!\n`;
                }
            }
        } else {
            answer = '⛔️ Wrong format!';
        }

        await this.bot.api.sendMessage(sender.chatId, answer);
    }

    /**
     * Execute address renaming from user input.
     */
    private async executeNameCommand(sender: Sender, text: string): Promise<void> {
        let answer: string;

        if (text.length >= 42 && text.includes('-')) {
            const [addrPart, namePart] = text.split('-');
            const addr = addrPart.trim();
            const name = namePart.trim();

            if (isValidAddress(addr)) {
                const checksumAddr = getChecksumAddress(addr);
                if (await this.sql.setName(sender.chatId, this.botId, checksumAddr, name)) {
                    answer = `1 : <code>${checksumAddr}</code> \n✅ Name set to <code>${name}</code>`;
                } else {
                    answer = '⛔️ Address not found in the watchlist.';
                }
            } else {
                answer = '⛔️ Wrong Address!';
            }
        } else {
            answer = '⛔️ Wrong format!';
        }

        await this.bot.api.sendMessage(sender.chatId, answer);
    }

    /**
     * Execute watchlist clearing with confirmation.
     */
    private async executeClearCommand(sender: Sender, text: string): Promise<void> {
        if (text.toLowerCase().trim() === 'yes') {
            await this.sql.clearWatchlist(sender.chatId, this.botId);
            const answer = '✅ DONE. Your watchlist is empty.';
            await this.bot.api.sendMessage(sender.chatId, answer);
        }
    }

    /**
     * Create unique key for message tracking.
     */
    private messageKey(msg: Message): string {
        return `${msg.chat.id}:${msg.from?.id}`;
    }

    /**
     * Check if text is a bot command.
     */
    private isBotCommand(text: string): boolean {
        return text.startsWith("/");
    }

    /**
     * Parse callback query data.
     */
    private parseCallbackQuery(text: string): [string | null, string[]] {
        if (!text.startsWith("#")) {
            return [null, []];
        }

        const parts = text.replace(/^#/, "").trim().split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);
        return [command, args];
    }

    /**
     * Check if command is intended for this bot.
     */
    private isCommandForThisBot(text: string): boolean {
        const match = text.match(/^\/[a-zA-Z0-9_]+@([a-zA-Z0-9_]+)\b/);
        return !match || match[1].toLowerCase() === this.username.toLowerCase();
    }

    /**
     * Extract command from text.
     */
    private extractCommand(text: string): string | null {
        const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?/);
        return match ? match[1] : null;
    }

    /**
     * Parse sender information from message.
     */
    private parseSender(msg: Message): Sender | null {
        if (!msg.from) return null;

        const username = msg.from.username
            ? "@" + msg.from.username
            : msg.from.first_name || `User${msg.from.id}`;

        return {
            chatId: msg.chat.id,
            userId: msg.from.id,
            username,
            fullname: msg.chat.type === "private"
                ? username
                : `${username} | ${(msg.chat as any).title || "Group"}`,
            chatType: msg.chat.type // Add chat type
        };
    }

    /**
     * Send new user notification to owner.
     */
    private async sendNewUserMessage(sender: Sender): Promise<void> {
        const msg = `username: ${sender.fullname}\nuser_id: <code>${sender.chatId}</code>`;

        const keyboard = new InlineKeyboard()
            .text("Add", `#add_user ${sender.chatId} ${sender.fullname}`);

        await this.bot.api.sendMessage(this.owner, msg, {
            reply_markup: keyboard
        });
    }

    /**
     * Send promotional message to user.
     */
    private async sendPromoMessage(chatId: number): Promise<void> {
        try {
            if (this.promoImage) {
                await this.bot.api.sendPhoto(chatId, this.promoImage, {
                    caption: PROMO_MESSAGE_CAPTION,
                    reply_markup: PROMO_MESSAGE_KEYBOARD
                });
            } else {
                await this.bot.api.sendMessage(chatId, PROMO_MESSAGE_CAPTION, {
                    reply_markup: PROMO_MESSAGE_KEYBOARD
                });
            }
        } catch (error) {
            console.error('[  BOT   ]', "Error sending promo message:", error);
            await this.bot.api.sendMessage(chatId, PROMO_MESSAGE_CAPTION, {
                reply_markup: PROMO_MESSAGE_KEYBOARD
            });
        }
    }

    /**
     * Check if user has access to this bot.
     */
    private checkAccess(chatId: number): boolean {
        if (chatId === this.owner) {
            return true;
        }
        return this.sql.checkAccess(chatId, this.botId);
    }
}