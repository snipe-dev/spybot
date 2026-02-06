import {TransactionData} from "./types.js";
import {Transaction} from 'viem';

/**
 * Converts raw transaction data into normalized internal format.
 * @param tx Raw transaction object from RPC.
 */
export function normalizeTransaction(tx: Transaction): TransactionData {
    return {
        hash: tx.hash,
        blockNumber: tx.blockNumber || null,
        blockHash: tx.blockHash || null,
        index: tx.transactionIndex || 0,
        to: tx.to || null,
        from: tx.from,
        nonce: Number(tx.nonce) || 0,
        gas: BigInt(tx.gas || 0),
        gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : null,
        maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : null,
        data: tx.input || '0x',
        value: BigInt(tx.value || 0),
        chainId: Number(tx.chainId) || 0,
        source: tx.blockNumber?.toString() ?? "block",
    };
}