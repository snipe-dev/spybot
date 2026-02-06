import {Hex, PublicClient} from 'viem';

/**
 * Normalized transaction representation extracted from a block.
 *
 * Contains only the fields required by the processing pipeline,
 * independent from the original RPC response format.
 */
export interface TransactionData {
    hash: Hex;
    blockNumber: bigint | null;
    blockHash: Hex | null;
    index: number;
    to: Hex | null;
    from: Hex;
    nonce: number;
    gas: bigint;
    gasPrice: bigint | null;
    maxPriorityFeePerGas: bigint | null;
    maxFeePerGas: bigint | null;
    data: Hex;
    value: bigint;
    chainId: number;
    source: string;
}

/**
 * Normalized block payload emitted by BlockReader.
 *
 * Includes basic block metadata and a list of
 * normalized transactions.
 */
export interface BlockData {
    source: string;
    number: bigint;
    hash: Hex;
    timestamp: bigint;
    transactions: TransactionData[];
}

/**
 * Typed event map for BlockReader.
 *
 * - new_block        Emitted when a full block is processed
 * - new_transaction  Emitted for each individual transaction
 * - error            Emitted on processing or RPC errors
 */
export interface BlockReaderEvents {
    'new_block': (block: BlockData) => void;
    'new_transaction': (transaction: TransactionData) => void;
    'error': (error: Error) => void;
}

/**
 * Configuration for MultinodePublicClient.
 *
 * rpcUrls        List of RPC endpoints used for parallel requests
 * requestTimeout Optional timeout (in milliseconds) per request
 */
export interface MultinodePublicClientConfig {
    rpcUrls: string[];
    requestTimeout?: number;
}

/**
 * Strategy used to determine consensus across multiple RPC nodes.
 *
 * - firstSuccess  Return the first successful response
 * - mostLogs      Prefer the response containing the most logs
 * - highestBlock  Prefer the response with the highest block number
 */
export type ConsensusStrategy =
    | 'firstSuccess'
    | 'mostLogs'
    | 'highestBlock';

/**
 * Utility types enabling type-safe invocation of PublicClient methods.
 *
 * PublicClientMethod:
 *   Union of all property keys available on PublicClient.
 *
 * MethodParameters<M>:
 *   Resolves to the parameter tuple of the selected method.
 *   Returns never if the property is not callable.
 *
 * MethodReturnType<M>:
 *   Resolves to the return type of the selected method.
 *   Returns never if the property is not callable.
 */
export type PublicClientMethod = keyof PublicClient;

export type MethodParameters<M extends PublicClientMethod> =
    PublicClient[M] extends (...args: any[]) => any
        ? Parameters<PublicClient[M]>
        : never;

export type MethodReturnType<M extends PublicClientMethod> =
    PublicClient[M] extends (...args: any[]) => any
        ? ReturnType<PublicClient[M]>
        : never;
