import {formatEther, getAddress, Hash, Hex, isAddress} from 'viem';
import {AddressExtractor} from './address-extractor.js';
import {TokenResolver} from './token-resolver.js';
import {MultinodePublicClient} from '../transport/multinode-client.js';
import {BalanceChangeData, BalanceData, TracerResult} from './types.js';
import {TransactionData} from "../transport/types.js";
import {normalizeTransaction} from "../transport/transactions.js";

/**
 * OptimizedTracer provides fast and full transaction decoding.
 *
 * It extracts interacted contract addresses, resolves token symbols,
 * and calculates balance changes for a watched address.
 *
 * Two modes are supported:
 * - fast decoding (mempool / unconfirmed transactions)
 * - full decoding (confirmed transactions with receipt)
 */
export class OptimizedTracer {
    private provider: MultinodePublicClient;
    addressExtractor: AddressExtractor;
    private tokenResolver: TokenResolver;

    /**
     * @param provider - MultinodePublicClient instance
     * @param multicallAddress - Multicall3 contract address
     */
    constructor(provider: MultinodePublicClient, multicallAddress: string) {
        this.provider = provider;
        this.addressExtractor = new AddressExtractor();
        this.tokenResolver = new TokenResolver(provider, multicallAddress);
    }

    /**
     * Fast transaction decoding.
     *
     * Intended for mempool or early transaction inspection.
     * Uses calldata and transaction target address.
     *
     * @param tx - Transaction object
     * @param watchAddress - Address being monitored
     * @returns Tracer result
     */
    async decodeFast(tx: TransactionData, watchAddress: string): Promise<TracerResult> {
        try {
            // 1. Extract addresses from calldata
            const extracted = this.addressExtractor.extractAddressesFromCalldata(
                tx.data
            );

            const addresses = [...extracted];

            // Explicitly include transaction target address
            if (tx.to) {
                try {
                    if (isAddress(tx.to)) {
                        addresses.push(getAddress(tx.to).toLowerCase());
                    }
                } catch (e) {
                    // Ignore invalid to-address
                }
            }

            // Extract token addresses from potential LP contracts
            const tokensFromPairs = await this.tokenResolver.extractAddressesFromPairs(
                addresses
            );
            addresses.push(...tokensFromPairs);

            // Remove duplicates
            const uniqueAddresses = [...new Set(addresses)];

            // 2. Resolve balance and tokens in parallel
            const [balanceData, tokens] = await Promise.all([
                this.getCurrentBalance(watchAddress),
                this.tokenResolver.resolveWithNetwork(uniqueAddresses)
            ]);

            // 3. Decode transfer amount if exactly one token is involved
            let amount: string | null = null;
            if (
                Object.keys(tokens).length === 1 &&
                tx.data.startsWith('0xa9059cbb')
            ) {
                const tokenAddress = Object.keys(tokens)[0];
                amount = this.tokenResolver.decodeTransferAmount(
                    tx.data,
                    tokenAddress
                );
            }

            return {
                status: null,
                interact: tokens,
                logs: null,
                blockNumber: tx.blockNumber || 'mempool',
                contractAddress: null,
                pnl: '0.0',
                bal: balanceData.bal,
                chn: balanceData.chn,
                amount: amount
            };
        } catch (error) {
            console.error('Tracer.decodeFast error:', error);
            return this.getFallbackData(watchAddress);
        }
    }

    /**
     * Full transaction decoding.
     *
     * Semantically identical to decodeFast, but:
     * - waits for transaction receipt
     * - includes addresses from logs
     * - calculates balance changes between blocks
     *
     * @param tx - Transaction object
     * @param watchAddress - Address being monitored
     * @returns Tracer result
     */
    async decodeFull(tx: TransactionData, watchAddress: string): Promise<TracerResult> {
        try {
            // 1. Wait for transaction receipt
            const receipt = await this.provider.waitForTransactionReceipt({
                hash: tx.hash,
                confirmations: 1,
                timeout: 30000
            });

            // 2. Extract addresses from calldata
            const extractedFromCalldata =
                this.addressExtractor.extractAddressesFromCalldata(tx.data);

            // 3. Extract addresses from logs
            const extractedFromLogs = this.addressExtractor.extractAddressesFromLogs(
                receipt.logs || []
            );

            const addresses = [...extractedFromCalldata, ...extractedFromLogs];

            // Explicitly include transaction target address
            if (tx.to && isAddress(tx.to)) {
                addresses.push(getAddress(tx.to).toLowerCase());
            }

            // Extract token addresses from potential LP contracts
            const tokensFromPairs = await this.tokenResolver.extractAddressesFromPairs(
                addresses
            );
            addresses.push(...tokensFromPairs);

            const uniqueAddresses = [...new Set(addresses)];

            // 4. Resolve balance changes and tokens in parallel
            const [balanceData, tokens] = await Promise.all([
                this.calculateBalanceChanges(watchAddress, receipt.blockNumber),
                this.tokenResolver.resolveWithNetwork(uniqueAddresses)
            ]);

            // 5. Decode transfer amount if exactly one token is involved
            let amount: string | null = null;
            if (
                Object.keys(tokens).length === 1 &&
                tx.data.startsWith('0xa9059cbb')
            ) {
                const tokenAddress = Object.keys(tokens)[0];
                amount = this.tokenResolver.decodeTransferAmount(
                    tx.data,
                    tokenAddress
                );
            }

            return {
                status: receipt.status === 'success',
                interact: tokens,
                logs: receipt.logs.length,
                blockNumber: receipt.blockNumber,
                contractAddress: receipt.contractAddress || null,
                pnl: balanceData.pnl,
                bal: balanceData.bal,
                chn: balanceData.chn,
                amount: amount
            };
        } catch (error) {
            console.error('Tracer.decodeFull error:', error);
            return await this.getFallbackDecode(tx.hash, watchAddress);
        }
    }

    /**
     * Returns current ETH balance for an address.
     *
     * @param address - Address to query
     * @returns Balance data
     */
    private async getCurrentBalance(address: string): Promise<BalanceData> {
        try {
            const balance = await this.provider.getBalance({
                address: address as Hex
            });

            const bal = this.round(Number(formatEther(balance)), 2).toString();

            return {
                bal: bal.includes('.') ? bal : bal + '.0',
                chn: ' '
            };
        } catch (e) {
            return { bal: '0.0', chn: ' ' };
        }
    }

    /**
     * Calculates balance changes between two consecutive blocks.
     *
     * @param address - Address to monitor
     * @param blockNumber - Current block number
     * @returns Balance change data
     */
    private async calculateBalanceChanges(
        address: string,
        blockNumber: bigint
    ): Promise<BalanceChangeData> {
        try {
            const [newBalance, prevBalance] = await Promise.all([
                this.provider.getBalance({
                    address: address as Hex,
                    blockNumber: blockNumber
                }),
                this.provider.getBalance({
                    address: address as Hex,
                    blockNumber: blockNumber - 1n
                })
            ]);

            const pnlValue = Number(formatEther(newBalance - prevBalance));

            const pnl = this.round(pnlValue, 3);
            const bal = this.round(Number(formatEther(newBalance)), 2).toString();

            let _pnl: string;
            let chn: string;

            if (pnl > 0) {
                _pnl = `+${pnl}`;
                chn = '▲';
            } else if (pnl < 0) {
                _pnl = `${pnl}`;
                chn = '▼';
            } else {
                _pnl = `${pnl}`;
                chn = '.';
            }

            return {
                pnl: _pnl.includes('.') ? _pnl : _pnl + '.0',
                bal: bal.includes('.') ? bal : bal + '.0',
                chn: chn
            };
        } catch (e) {
            return { pnl: '0.0', bal: '0.0', chn: '.' };
        }
    }

    /**
     * Rounds a number to a fixed number of digits.
     *
     * @param number - Number to round
     * @param digits - Number of decimal places
     * @returns Rounded number
     */
    private round(number: number, digits: number): number {
        const multiple = Math.pow(10, digits);
        return Math.round(number * multiple) / multiple;
    }

    /**
     * Returns fallback data when decoding fails.
     *
     * @param watchAddress - Address being monitored
     * @returns Fallback tracer result
     */
    private async getFallbackData(watchAddress: string): Promise<TracerResult> {
        const balanceData = await this.getCurrentBalance(watchAddress);

        return {
            status: null,
            interact: {},
            logs: null,
            blockNumber: 'mempool',
            contractAddress: null,
            pnl: '0.0',
            bal: balanceData.bal,
            chn: balanceData.chn,
            amount: null
        };
    }

    /**
     * Fallback decoding using transaction data only.
     *
     * @param txHash - Transaction hash
     * @param watchAddress - Address being monitored
     * @returns Fallback tracer result
     */
    private async getFallbackDecode(
        txHash: Hash,
        watchAddress: string
    ): Promise<TracerResult> {
        try {
            const tx = await this.provider.getTransaction({ hash: txHash });
            if (tx) {
                return await this.decodeFast( normalizeTransaction(tx), watchAddress);
            }
        } catch (e) {
            // Ignore provider errors
        }

        return await this.getFallbackData(watchAddress);
    }

    /**
     * Closes all resources (token cache, etc.)
     */
    close(): void {
        this.tokenResolver.close();
    }
}
