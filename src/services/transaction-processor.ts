import {formatEther} from "viem";
import type {TransactionData} from "../transport/types.js";
import type {TracerResult} from "../tracer/types.js";
import type {WatchlistEntry} from "../database/types.js";
import {resolveSelector} from "../selectors/signature-resolver.js";
import {Sql} from "../database/sql-client.js";
import {OptimizedTracer} from "../tracer/optimized-tracer.js";
import {MessageBuilder} from "../message/message-builder.js";
import {TelegramQueue} from "../telegram/telegram-queue.js";

/**
 * Central transaction processing pipeline.
 *
 * Responsibilities:
 * - Detect whether a transaction is relevant to any watched address
 * - Run fast and full decoding via tracer
 * - Resolve function selectors
 * - Build formatted Telegram messages
 * - Send initial messages and later update them with full trace data
 * - Prevent duplicate processing
 *
 * Designed for high-throughput mempool / block stream handling.
 */
export class TransactionProcessor {

    /**
     * Deduplication storage.
     * Keeps recently processed (address:txHash) pairs.
     * Insertion order is used to evict oldest entries.
     */
    private sent = new Set<string>();

    /**
     * @param sql SQL client providing watchlist access
     * @param tracer Optimized transaction tracer (fast + full decoding)
     * @param builder Message builder for Telegram formatting
     * @param bots Active Telegram bot instances mapped by botId
     */
    constructor(
        private readonly sql: Sql,
        private readonly tracer: OptimizedTracer,
        private readonly builder: MessageBuilder,
        private readonly bots: Record<string, { queue: TelegramQueue }>
    ) {}

    /**
     * Entry point for every incoming transaction.
     *
     * Performs lightweight routing:
     * - Direct match on `from`
     * - Direct match on `to`
     * - ERC20 transfer recipient extraction
     * - Generic calldata address extraction
     *
     * For each matched address, triggers full processing pipeline.
     *
     * @param tx Raw transaction data
     */
    async handle(tx: TransactionData): Promise<void> {
        try {
            const watchlist = this.sql.watchlist;

            if (tx.from in watchlist) {
                await this.process(tx.from, tx);
            }

            if (tx.to && tx.to in watchlist) {
                await this.process(tx.to, tx);
            }

            const transferTo = this.tracer.addressExtractor.extractTransferRecipient(tx.data);
            if (transferTo && transferTo in watchlist) {
                await this.process(transferTo, tx);
            }

            const internalAddresses =
                this.tracer.addressExtractor.extractAddressesFromCalldata(tx.data);

            for (const address of internalAddresses) {
                if (address in watchlist) {
                    await this.process(address, tx);
                }
            }

        } catch (error) {
            console.error("Transaction handle error:", error);
        }
    }

    /**
     * Core processing flow for a specific watched address.
     *
     * Pipeline:
     * 1. Deduplication check
     * 2. Resolve active watchers
     * 3. Resolve function selector
     * 4. Skip trivial native transfers
     * 5. Run fast decode and send preliminary message
     * 6. Run full decode in parallel
     * 7. Update previously sent messages
     *
     * @param address Watched address
     * @param tx Transaction data
     */
    private async process(address: string, tx: TransactionData): Promise<void> {
        try {
            if (this.alreadySent(address, tx.hash)) {
                return;
            }

            const watchers = this.getWatchers(address);
            if (Object.keys(watchers).length === 0) {
                return;
            }

            const selector = tx.data.slice(0, 10);
            const signature = await resolveSelector(selector);

            // Ignore small plain native transfers
            if (
                selector === "0x" &&
                Number(formatEther(tx.value)) < 0.01
            ) {
                return;
            }

            const fast: TracerResult =
                await this.tracer.decodeFast(tx, address);

            const txOutgoing = address === tx.from;

            const fastMsg = this.builder.build(
                address,
                tx,
                fast,
                signature
            );

            const [sentMap, full] = await Promise.all([
                this.massSend(watchers, fastMsg, txOutgoing),
                this.tracer.decodeFull(tx, address)
            ]);

            const fullMsg = this.builder.build(
                address,
                tx,
                full,
                signature
            );

            await this.massUpdate(
                watchers,
                fullMsg,
                sentMap,
                txOutgoing
            );

        } catch (error) {
            console.error("Process transaction error:", error);
        }
    }

    /**
     * Sends initial message to all eligible watchers.
     *
     * Respects watcher direction preferences:
     * - tx_in  → incoming transactions
     * - tx_out → outgoing transactions
     *
     * Returns a map of watcherId → messageId
     * used later for message updates.
     *
     * @param watchers Watchers mapped by composite id (chatId@botId)
     * @param msg Pre-built message
     * @param txOutgoing Whether transaction is outgoing
     */
    private async massSend(
        watchers: Record<string, WatchlistEntry>,
        msg: { text: string; buttons?: any },
        txOutgoing: boolean
    ): Promise<Record<string, number>> {

        const sent: Record<string, number> = {};

        for (const id in watchers) {
            const [chatIdRaw, botId] = id.split("@");
            const chatId = Number.isNaN(Number(chatIdRaw))
                ? chatIdRaw
                : Number(chatIdRaw);

            const watcher = watchers[id];

            if (!txOutgoing && !watcher.tx_in) continue;
            if (txOutgoing && !watcher.tx_out) continue;

            if (!(botId in this.bots)) continue;

            const text = msg.text.replace("$$NAME$$", watcher.name);

            const messageId = await this.bots[botId].queue.sendMessage(
                chatId,
                text,
                msg.buttons
            );

            if (messageId) {
                sent[id] = messageId;
            }
        }

        return sent;
    }

    /**
     * Updates previously sent messages with full trace data.
     *
     * Uses messageId map returned from {@link massSend}.
     *
     * @param watchers Watcher definitions
     * @param msg Fully built message
     * @param sentMap watcherId → messageId
     * @param txOutgoing Whether transaction is outgoing
     */
    private async massUpdate(
        watchers: Record<string, WatchlistEntry>,
        msg: { text: string; buttons?: any },
        sentMap: Record<string, number>,
        txOutgoing: boolean
    ): Promise<void> {

        for (const id in sentMap) {
            const [chatIdRaw, botId] = id.split("@");
            const chatId = Number.isNaN(Number(chatIdRaw))
                ? chatIdRaw
                : Number(chatIdRaw);

            const watcher = watchers[id];

            if (!txOutgoing && !watcher.tx_in) continue;
            if (txOutgoing && !watcher.tx_out) continue;

            if (!(botId in this.bots)) continue;

            const text = msg.text.replace("$$NAME$$", watcher.name);

            await this.bots[botId].queue.editMessage(
                chatId,
                sentMap[id],
                text,
                msg.buttons
            );
        }
    }

    /**
     * Checks whether this (address, txHash) pair
     * has already been processed.
     *
     * Maintains bounded memory by evicting oldest entries
     * after exceeding 10,000 records.
     *
     * @param address Watched address
     * @param hash Transaction hash
     */
    private alreadySent(address: string, hash: string): boolean {
        const key = `${address}:${hash}`;

        if (this.sent.has(key)) {
            return true;
        }

        this.sent.add(key);

        if (this.sent.size > 10000) {
            const first = this.sent.values().next().value;
            if (first) {
                this.sent.delete(first);
            }
        }

        return false;
    }

    /**
     * Returns only watchers whose bot instance is currently active.
     *
     * Prevents sending messages to inactive or unloaded bots.
     *
     * @param address Watched address
     */
    private getWatchers(address: string):
        Record<string, WatchlistEntry> {

        const result: Record<string, WatchlistEntry> = {};
        const watchers = this.sql.watchlist[address] || {};

        for (const id in watchers) {
            const [, botId] = id.split("@");
            if (botId in this.bots) {
                result[id] = watchers[id];
            }
        }

        return result;
    }
}

