import {config} from "./system/config.js";
import {Sql} from "./database/sql-client.js";
import {MultinodePublicClient} from "./transport/multinode-client.js";
import {BlockReader} from "./transport/block-reader.js";
import {OptimizedTracer} from "./tracer/optimized-tracer.js";
import {MessageBuilder} from "./message/message-builder.js";
import {TransactionProcessor} from "./services/transaction-processor.js";
import {Bot} from "grammy";
import {TelegramQueue} from "./telegram/telegram-queue.js";
import {TelegramBot} from "./telegram/telegram-bot.js";

async function main(): Promise<void> {

    console.log("Starting application...");

    // Database
    const sql = new Sql(config.database);
    await sql.ready;

    // Telegram bots + queues
    const bots: Record<string, { queue: TelegramQueue }> = {};

    for (const botConfig of config.bots) {
        const bot = new Bot(botConfig.bot_token);
        const queue = new TelegramQueue(bot.api);

        if (botConfig.polling) {
            new TelegramBot(bot, sql, {
                owner: config.owner,
                open_access: botConfig.open_access,
                explorer: config.explorer
            });
        }

        bots[botConfig.bot_id] = { queue };
    }

    // RPC client
    const client = new MultinodePublicClient({
        rpcUrls: config.rpc_urls,
        requestTimeout: 3000
    });

    // Block reader
    const blockReader = new BlockReader(client);

    // Tracer
    const tracer = new OptimizedTracer(
        client,
        config.multicall_address
    );

    // Message builder
    const builder = new MessageBuilder(config);

    // Transaction processor
    const processor = new TransactionProcessor(
        sql,
        tracer,
        builder,
        bots
    );

    // Events
    blockReader.on("new_transaction", (tx) => {
        processor.handle(tx).catch(err => {
            console.error("Processor error:", err);
        });
    });

    blockReader.on("error", (err) => {
        console.error("BlockReader error:", err.message);
    });

    console.log('[  SYS   ]', "System initialized.");
}

main().catch(err => {
    console.error("Fatal startup error:", err);
    process.exit(1);
});
