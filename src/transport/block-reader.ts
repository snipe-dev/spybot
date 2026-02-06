import path from 'path';
import {promises as fs} from 'fs';
import {fileURLToPath} from 'url';
import {EventEmitter} from 'eventemitter3';
import type {Block, Hex} from 'viem';
import {sleep} from "../utils/sleep.js";
import {MultinodePublicClient} from './multinode-client.js';
import {BlockData, BlockReaderEvents, TransactionData} from "./types.js";
import {normalizeTransaction} from "./transactions.js";

// Path to store last processed block
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAST_BLOCK_FILE = path.join(__dirname, 'block.txt');

/**
 * Continuously reads blocks from the blockchain and emits
 * block and transaction events in real time.
 * Designed for long-running indexers and streaming pipelines.
 */
export class BlockReader extends EventEmitter<BlockReaderEvents> {
    private client: MultinodePublicClient;
    private expectedBlockNumber: bigint = 0n;

    // Configuration
    private readonly maxAttempts: number = 3;
    private readonly rereadBlocks: number = 10;
    private readonly maxParallelBlocks: number = 5; // Match JS version for BSC performance
    private readonly saveInterval: number = 10;     // Persist state every N blocks

    // State tracking using Sets for O(1) duplicate checks
    private processedBlocks = new Set<string>(); // Stored as strings for consistency
    private processedTransactions = new Set<Hex>();

    // Sliding window sizes for deduplication protection
    private readonly BLOCK_WINDOW = 200;   // Reorg protection window
    private readonly TX_WINDOW = 10000;    // Transaction deduplication window

    /**
     * Creates a new BlockReader instance.
     * Automatically starts the block reading loop.
     * @param client Fault-tolerant blockchain client.
     */
    constructor(client: MultinodePublicClient) {
        super();

        this.client = client;

        this.start().catch(error => {
            this.emit('error', error);
        });
    }

    /**
     * Initializes internal state and determines the starting block.
     */
    private async start(): Promise<void> {
        try {
            const lastBlock = await this.loadLastProcessedBlock();
            this.expectedBlockNumber = lastBlock + 1n;
            console.log("[ READER ]", "Starting from block:", this.expectedBlockNumber.toString());
            await this.readBlocksLoop();
        } catch (error) {
            this.emit('error', error as Error);
        }
    }

    /**
     * Main loop that polls the chain head
     * and processes new blocks sequentially.
     */
    private async readBlocksLoop(): Promise<void> {
        try {
            const head = await this.client.getBlockNumber();

            if (head < this.expectedBlockNumber) {
                this.expectedBlockNumber = head;
            }

            // Обрабатываем все новые блоки за одну итерацию
            while (this.expectedBlockNumber <= head) {
                const fetchedBlocks = new Map<string, any>();
                const batch: Promise<void>[] = [];

                // Определяем, сколько блоков нужно обработать за эту итерацию
                const blocksToFetch = Math.min(
                    this.maxParallelBlocks,
                    Number(head - this.expectedBlockNumber + 1n)
                );

                // Загружаем блоки параллельно
                for (let i = 0; i < blocksToFetch; i++) {
                    const blockNumber = this.expectedBlockNumber + BigInt(i);
                    batch.push(
                        this.tryGetBlock(blockNumber, this.maxAttempts)
                            .then(block => {
                                if (block) {
                                    fetchedBlocks.set(blockNumber.toString(), block);
                                }
                            })
                            .catch(error => {
                                console.error("[ ERROR  ]", `Failed to fetch block ${blockNumber}:`, error.message);
                            })
                    );
                }

                await Promise.all(batch);

                // Обрабатываем загруженные блоки по порядку
                for (let i = 0; i < blocksToFetch; i++) {
                    const blockNumber = this.expectedBlockNumber;
                    const block = fetchedBlocks.get(blockNumber.toString());
                    if (block) {
                        await this.processBlock(block);
                        this.expectedBlockNumber++;

                        // Сохраняем каждые saveInterval блоков
                        if (this.expectedBlockNumber % BigInt(this.saveInterval) === 0n) {
                            await this.saveLastProcessedBlock(this.expectedBlockNumber);
                        }
                    } else {
                        // Если блок не загрузился, выходим из цикла
                        break;
                    }
                }

                // Если блоки не загрузились, делаем паузу перед следующей попыткой
                if (fetchedBlocks.size === 0) {
                    break;
                }
            }
        } catch (error) {
            this.emit('error', error as Error);
        }

        // Ждем 1 секунду перед следующей итерацией (как в JS версии)
        setTimeout(() => this.readBlocksLoop(), 1000);
    }

    /**
     * Processes a block and emits block and transaction events.
     * Guarantees block-level deduplication using a sliding window.
     */
    private async processBlock(block: Block): Promise<void> {

        if (block.number === null || block.hash === null) {
            return;
        }

        const blockNumber = BigInt(block.number);
        const blockKey = blockNumber.toString();

        if (this.processedBlocks.has(blockKey)) {
            return;
        }

        this.processedBlocks.add(blockKey);

        const blockData: BlockData = {
            source: "READER",
            number: blockNumber,
            hash: block.hash,
            timestamp: block.timestamp ?? 0n,
            transactions: []
        };

        for (const tx of block.transactions) {

            if (typeof tx !== "object") {
                continue;
            }

            const normalizedTx = normalizeTransaction(tx);
            blockData.transactions.push(normalizedTx);

            const txData: TransactionData = {
                ...normalizedTx,
                source: "block"
            };

            this.processTransaction(txData);
        }

        console.log(
            "[ READER ]",
            this.formatBlockTime(Number(blockData.timestamp)),
            "|", blockData.number.toString(), "|",
            "txns:",
            blockData.transactions.length
        );

        this.emit("new_block", blockData);

        if (blockNumber > BigInt(this.BLOCK_WINDOW)) {
            const oldBlockKey = (blockNumber - BigInt(this.BLOCK_WINDOW)).toString();
            this.processedBlocks.delete(oldBlockKey);
        }
    }


    /**
     * Emits transaction event if not processed before.
     * Guarantees transaction-level deduplication.
     */
    private processTransaction(txData: TransactionData): void {
        if (this.processedTransactions.has(txData.hash)) {
            return;
        }

        this.processedTransactions.add(txData.hash);
        this.emit('new_transaction', txData);

        // Sliding window cleanup
        if (this.processedTransactions.size > this.TX_WINDOW) {
            const toDelete = Array.from(this.processedTransactions)
                .slice(0, Math.floor(this.TX_WINDOW / 2));
            toDelete.forEach(hash => this.processedTransactions.delete(hash));
        }
    }

    /**
     * Attempts to fetch a block with retry logic
     * and exponential backoff.
     * @param blockNumber Block number to fetch.
     * @param maxAttempts Maximum retry count.
     */
    private async tryGetBlock(blockNumber: bigint, maxAttempts: number = 3): Promise<Block | null> {
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const block = await this.client.getBlock({
                    blockNumber: blockNumber,
                    includeTransactions: true
                });

                if (block && block.hash) {
                    return block;
                }
            } catch (error) {
                attempts++;
                if (attempts < maxAttempts) {
                    await sleep(Math.min(1000 * attempts, 5000));
                }
            }
        }

        return null;
    }



    /**
     * Converts a block timestamp to local time string.
     * @param timestamp Unix timestamp in seconds.
     */
    private formatBlockTime(timestamp: number): string {
        const blockTime = new Date(timestamp * 1000);
        return `${blockTime.toLocaleDateString()} ${blockTime.toLocaleTimeString()}`;
    }

    /**
     * Loads the last processed block number from disk.
     */
    private async loadLastProcessedBlock(): Promise<bigint> {
        try {
            const data = await fs.readFile(LAST_BLOCK_FILE, 'utf8');
            let lastProcessedBlock = BigInt(parseInt(data.trim(), 10) || 0);

            try {
                const currentBlock = await this.client.getBlockNumber();

                if (currentBlock - lastProcessedBlock > BigInt(this.rereadBlocks) || lastProcessedBlock === 0n) {
                    const newStartBlock = currentBlock - BigInt(this.rereadBlocks);
                    if (newStartBlock > 0n) {
                        await this.saveLastProcessedBlock(newStartBlock);
                        return newStartBlock;
                    }
                }
            } catch (error) {
                this.emit('error', error as Error);
            }

            return lastProcessedBlock;

        } catch (error) {
            try {
                const currentBlock = await this.client.getBlockNumber();
                const newStartBlock = currentBlock - BigInt(this.rereadBlocks);
                if (newStartBlock > 0n) {
                    await this.saveLastProcessedBlock(newStartBlock);
                    return newStartBlock;
                }
                return currentBlock;
            } catch (error) {
                this.emit('error', error as Error);
                return 0n;
            }
        }
    }

    /**
     * Persists the last processed block number to disk.
     * @param blockNumber Block number to persist.
     */
    private async saveLastProcessedBlock(blockNumber: bigint): Promise<void> {
        try {
            await fs.writeFile(LAST_BLOCK_FILE, blockNumber.toString(), 'utf8');
        } catch (error) {
            console.error("[ ERROR  ]", 'Failed to save block number:', error);
        }
    }
}