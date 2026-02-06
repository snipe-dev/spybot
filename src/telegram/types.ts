import {InlineKeyboard} from "grammy";

/**
 * Common type definitions for the telegram system
 */

/**
 * Internal queue item representing a pending send operation.
 * Messages are processed strictly sequentially.
 */
export type SendQueueItem = {
    chatId: number | string;
    text: string;
    buttons: InlineKeyboard | undefined;
    messageId: string;
    resolve: (value: number) => void;
    reject: (reason?: any) => void;
};

/**
 * Internal queue item representing a pending edit operation.
 */
export type EditQueueItem = {
    chatId: number | string;
    msgId: number;
    text: string;
    buttons: InlineKeyboard | undefined;
    editId: string;
    resolve: (value: boolean) => void;
    reject: (reason?: any) => void;
};

/**
 * Sender information extracted from message.
 */
export interface Sender {
    chatId: number;
    userId: number;
    username: string;
    fullname: string;
    chatType: string; // 'private', 'group', 'supergroup', 'channel'
}

/**
 * Configuration for Spybot instance.
 */
export interface SpybotConfig {
    open_access: boolean;
    owner: number;
    explorer: string;
}

/**
 * Configuration object structure for saving to file.
 */
export interface Config {
    http_node?: string;
    wss_node?: string;
    debug_node?: string;
    [key: string]: any;
}