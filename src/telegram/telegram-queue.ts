import {sleep} from "../utils/sleep.js";
import {applyDefaults} from "./apply-defaults.js";
import {Api, GrammyError, InlineKeyboard, InputFile} from "grammy";
import type {Chat, Message} from "grammy/types";
import type {EditQueueItem, SendQueueItem} from "./types.js";

/**
 * TelegramQueue
 *
 * A reliable outgoing message delivery layer for Telegram bots.
 *
 * This class is designed for bots that send messages frequently and must
 * remain stable under Telegram rate limits.
 *
 * Core responsibilities:
 * - sequential message delivery
 * - automatic handling of HTTP 429 errors
 * - retry_after support
 * - guaranteed message order
 * - separation of delivery logic from user interaction logic
 *
 * It acts purely as a transport-safe message queue.
 */
export class TelegramQueue {

    /**
     * Telegram Bot API instance.
     * Used strictly as a transport layer.
     */
    private api: Api;

    /**
     * Bot username in lowercase form.
     */
    private botId: string = "UnnamedBot";

    /**
     * Queue of outgoing messages.
     */
    private sendQueue: SendQueueItem[] = [];

    /**
     * Indicates active send queue processing.
     */
    private isProcessingSendQueue = false;

    /**
     * Pending send promises mapped by internal message id.
     */
    private pendingSendMessages = new Map<string, Promise<number>>();

    /**
     * Queue of pending edit operations.
     */
    private editQueue: EditQueueItem[] = [];

    /**
     * Indicates active edit queue processing.
     */
    private isProcessingEditQueue = false;

    /**
     * Pending edit promises mapped by internal edit id.
     */
    private pendingEditMessages = new Map<string, Promise<boolean>>();

    /**
     * Creates a new TelegramQueue instance.
     *
     * @param api Telegram Bot API instance
     */
    constructor(api: Api) {
        this.api = api;
        this.setupApiMiddleware();

        this.api.getMe()
            .then(me => {
                this.botId = me.username?.toLowerCase() || "unnamedbot";
                console.log('[ QUEUE  ]', "@" + this.botId, me.first_name);
            })
            .catch(err => {
                console.error('[ QUEUE  ]', "Failed to get bot info:", err);
            });
    }

    /**
     * Sets up API middleware to apply default message settings.
     *
     * Applies HTML parse mode and disabled link previews to all
     * sendMessage and editMessageText calls automatically.
     */
    private setupApiMiddleware(): void {
        this.api.config.use((prev, method, payload) => {
            applyDefaults(method, payload);
            return prev(method, payload);
        });
    }

    /**
     * Enqueues a message for guaranteed delivery.
     *
     * Messages are sent sequentially and automatically retried
     * when Telegram rate limits are reached.
     *
     * @param chatId Target chat id
     * @param text Message text (HTML supported)
     * @param buttons Optional inline keyboard
     */
    async sendMessage(chatId: number | string, text: string, buttons?: InlineKeyboard) {
        return this.enqueueSendMessage(chatId, text, buttons);
    }

    /**
     * Adds a message to the send queue.
     */
    private async enqueueSendMessage(
        chatId: number | string,
        text: string,
        buttons: InlineKeyboard | undefined
    ): Promise<number> {

        if (text.length > 4096) {
            throw new Error("Message too long");
        }

        const messageId = `${chatId}_${Date.now()}_${Math.random()}`;

        let resolve!: (v: number) => void;
        let reject!: (e: any) => void;

        const promise = new Promise<number>((res, rej) => {
            resolve = res;
            reject = rej;
        });

        this.sendQueue.push({
            chatId,
            text,
            buttons,
            messageId,
            resolve,
            reject,
        });

        this.pendingSendMessages.set(messageId, promise);

        if (!this.isProcessingSendQueue) {
            this.processSendQueue().catch(console.error);
        }

        return promise;
    }

    /**
     * Sequentially processes the send queue.
     *
     * Guarantees:
     * - message order
     * - safe rate-limit handling
     * - retry_after compliance
     */
    private async processSendQueue() {
        if (this.isProcessingSendQueue) return;
        this.isProcessingSendQueue = true;

        while (this.sendQueue.length > 0) {
            const item = this.sendQueue[0];

            try {
                const msg = await this.api.sendMessage(
                    item.chatId,
                    item.text,
                    item.buttons ? { reply_markup: item.buttons } : {}
                );

                console.log(
                    '[ QUEUE  ]',
                    this.botId,
                    "Message:",
                    msg.message_id,
                    "send to:",
                    this.parseReceiver(msg)?.fullname,
                    "OK"
                );

                this.sendQueue.shift();
                this.pendingSendMessages.delete(item.messageId);
                item.resolve(msg.message_id);

                await sleep(200);

            } catch (err) {
                const action = this.handleError(err, item.chatId);

                if (action.retrySending) {
                    await sleep(action.retryAfter * 1000);
                    continue;
                }

                if (action.removeMessage) {
                    this.sendQueue.shift();
                    this.pendingSendMessages.delete(item.messageId);
                    item.reject(err);
                }
            }
        }

        this.isProcessingSendQueue = false;
    }

    /**
     * Enqueues a message edit operation.
     */
    async editMessage(
        chatId: number | string,
        msgId: number,
        text: string,
        buttons?: InlineKeyboard
    ): Promise<boolean> {
        return this.enqueueEditMessage(chatId, msgId, text, buttons);
    }

    /**
     * Adds an edit operation to the queue.
     */
    private async enqueueEditMessage(
        chatId: number | string,
        msgId: number,
        text: string,
        buttons: InlineKeyboard | undefined
    ): Promise<boolean> {

        if (text.length > 4096) {
            throw new Error("Message too long");
        }

        const editId = `${chatId}_${msgId}_${Date.now()}`;

        let resolve!: (v: boolean) => void;
        let reject!: (e: any) => void;

        const promise = new Promise<boolean>((res, rej) => {
            resolve = res;
            reject = rej;
        });

        this.editQueue.push({
            chatId,
            msgId,
            text,
            buttons,
            editId,
            resolve,
            reject,
        });

        this.pendingEditMessages.set(editId, promise);

        if (!this.isProcessingEditQueue) {
            this.processEditQueue().catch(console.error);
        }

        return promise;
    }

    /**
     * Sequentially processes message edit operations.
     */
    private async processEditQueue() {
        if (this.isProcessingEditQueue) return;
        this.isProcessingEditQueue = true;

        while (this.editQueue.length > 0) {
            const item = this.editQueue[0];

            try {
                await this.api.editMessageText(
                    item.chatId,
                    item.msgId,
                    item.text,
                    item.buttons ? { reply_markup: item.buttons } : {}
                );

                console.log(
                    '[ QUEUE  ]',
                    this.botId,
                    "Message:",
                    item.msgId,
                    "Updated"
                );

                this.editQueue.shift();
                this.pendingEditMessages.delete(item.editId);
                item.resolve(true);

                await sleep(200);

            } catch (err) {
                const action = this.handleError(err, item.chatId);

                if (action.retrySending) {
                    await sleep(action.retryAfter * 1000);
                    continue;
                }

                if (action.removeMessage) {
                    this.editQueue.shift();
                    this.pendingEditMessages.delete(item.editId);
                    item.reject(err);
                }
            }
        }

        this.isProcessingEditQueue = false;
    }

    /**
     * Sends a message immediately without using the queue.
     * Intended for low-frequency or service-level notifications.
     */
    async sendSingleMessage(
        chatId: number | string,
        text: string,
        buttons?: InlineKeyboard
    ): Promise<number | null> {

        if (text.length > 4096) return null;

        try {
            const msg = await this.api.sendMessage(
                chatId,
                text,
                buttons ? { reply_markup: buttons } : {}
            );

            console.log(
                '[ QUEUE  ]',
                this.botId,
                "Message:",
                msg.message_id,
                "send to:",
                this.parseReceiver(msg)?.fullname,
                "OK"
            );

            return msg.message_id;

        } catch (err) {
            this.handleError(err, chatId);
            return null;
        }
    }

    /**
     * Sends a photo immediately without queueing.
     *
     * Useful for occasional media notifications.
     */
    async sendSinglePhoto(
        chatId: number | string,
        text: string,
        photo: Buffer,
        buttons?: InlineKeyboard
    ): Promise<number | null> {

        if (text.length > 2048) return null;

        try {
            const file = new InputFile(photo, "photo.png");

            const msg = await this.api.sendPhoto(
                chatId,
                file,
                {
                    caption: text,
                    ...(buttons ? { reply_markup: buttons } : {})
                }
            );

            console.log(
                '[ QUEUE  ]',
                this.botId,
                "Photo:",
                msg.message_id,
                "send to:",
                this.parseReceiver(msg)?.fullname,
                "OK"
            );

            return msg.message_id;

        } catch (err) {
            this.handleError(err, chatId);
            return null;
        }
    }

    /**
     * Edits a message immediately without queueing.
     */
    async editSingleMessage(
        chatId: number | string,
        msgId: number,
        text: string,
        buttons?: InlineKeyboard
    ): Promise<number | null> {

        if (text.length > 4096) return null;

        try {
            await this.api.editMessageText(
                chatId,
                msgId,
                text,
                buttons ? { reply_markup: buttons } : {}
            );

            console.log(
                '[ QUEUE  ]',
                this.botId,
                "Message:",
                msgId,
                "Updated"
            );

            return msgId;

        } catch (err) {
            this.handleError(err, chatId);
            return null;
        }
    }

    /**
     * Centralized Telegram error handling logic.
     *
     * Determines whether an operation should:
     * - be retried
     * - be dropped
     * - mark a user as unavailable
     */
    private handleError(error: any, chatId: number | string) {

        const result = {
            removeMessage: true,
            removeUser: false,
            retrySending: false,
            retryAfter: 1,
        };

        if (!(error instanceof GrammyError)) {
            console.error('[ QUEUE  ]', `Unknown error for chat ${chatId}:`, error?.message || error);
            return result;
        }

        const errorCode = error.error_code;
        const description = error.description || "";

        if (errorCode === 429) {
            result.retryAfter = error.parameters?.retry_after || 1;
            result.removeMessage = false;
            result.removeUser = false;
            result.retrySending = true;

            console.log('[ QUEUE  ]',
                `Rate limit exceeded for chat ${chatId}, retrying after ${result.retryAfter} seconds`
            );

            return result;
        }

        if (
            description.includes("bot was blocked by the user") ||
            description.includes("chat not found") ||
            description.includes("bot was kicked") ||
            description.includes("user is deactivated")
        ) {
            console.warn('[ QUEUE  ]',
                `User ${chatId} is not available or chat not found: ${description}`
            );
            result.removeUser = true;
            return result;
        }

        if (
            description.includes("message text is invalid") ||
            description.includes("message to edit not found")
        ) {
            console.error('[ QUEUE  ]',
                `Message error for chat ${chatId}: ${description}`
            );
            result.removeUser = false;
            return result;
        }

        console.error('[ QUEUE  ]',
            `Failed to process message for chat ${chatId}: ${errorCode} - ${description}`
        );

        return result;
    }

    /**
     * Extracts receiver information from an outgoing Telegram message.
     */
    parseReceiver(msg: Message) {
        const chat: Chat = msg.chat;

        const name =
            chat.username
                ? "@" + chat.username
                : chat.title || `Chat${chat.id}`;

        return {
            chatId: chat.id,
            botId: this.botId,
            type: chat.type,
            fullname: `${this.botId}|${name}`,
        };
    }
}