import {Bot} from "grammy";
import {TelegramBot} from "../telegram/telegram-bot.js";
import {TelegramQueue} from "../telegram/telegram-queue.js";
import {Sql} from "../database/sql-client.js"
import {config} from "../system/config.js";

const bots: Record<string, { queue: TelegramQueue }> = {};

const sql = new Sql(config.database);

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

