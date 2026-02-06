import {
    Block,
    CallParameters,
    createPublicClient,
    FeeHistory,
    GetCodeReturnType,
    Hash,
    http,
    Log,
    PublicClient,
    Transaction,
    TransactionReceipt
} from 'viem'

import {
    ConsensusStrategy,
    MethodParameters,
    MethodReturnType,
    MultinodePublicClientConfig,
    PublicClientMethod
} from "./types.js";

/**
 * Public client wrapper that executes requests across multiple RPC nodes
 * and returns a consensus-based result.
 *
 * Designed to improve reliability, fault tolerance, and data correctness
 * when working with unstable or heterogeneous RPC providers.
 */
export class MultinodePublicClient {
    private nodes: Array<{ url: string; client: PublicClient }> = []

    /**
     * Creates multiple viem public clients for all provided RPC URLs.
     *
     * @param config Configuration object containing RPC endpoints and timeout.
     */
    constructor(config: MultinodePublicClientConfig) {
        const requestTimeout = config.requestTimeout || 3000

        // Initialize clients for all RPC endpoints
        this.nodes = config.rpcUrls.map(url => ({
            url,
            client: createPublicClient({
                transport: http(url, { timeout: requestTimeout })
            })
        }))
    }

    /**
     * Executes the same RPC method on all nodes in parallel
     * and resolves the result using the selected consensus strategy.
     *
     * @param method PublicClient method name to invoke.
     * @param args Arguments passed to the method.
     * @param strategy Consensus strategy used to select the final result.
     */
    private async executeParallel<M extends PublicClientMethod>(
        method: M,
        args: MethodParameters<M>,
        strategy: ConsensusStrategy = 'firstSuccess'
    ): Promise<Awaited<MethodReturnType<M>>> {
        const promises = this.nodes.map(async ({ client }) => {
            try {
                const methodFn = client[method]
                if (typeof methodFn !== 'function') {
                    throw new Error(`Method ${String(method)} is not a function`)
                }
                const result = await (methodFn as any).apply(client, args)
                return { success: true, result, error: null }
            } catch (error) {
                return { success: false, result: null, error }
            }
        })

        const results = await Promise.allSettled(promises)

        const successful = results
            .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
            .map(r => r.value)
            .filter(r => r.success && r.result !== null)

        if (successful.length === 0) {
            throw new Error(`[RPC FAIL] All nodes failed for method: ${String(method)}`)
        }

        return this.applyConsensusStrategy(successful.map(s => s.result), strategy)
    }

    /**
     * Applies a consensus strategy to multiple successful RPC results.
     *
     * @param results Successful results returned by nodes.
     * @param strategy Strategy used to determine the final value.
     */
    private applyConsensusStrategy<T>(results: T[], strategy: ConsensusStrategy): T {
        switch (strategy) {
            case 'firstSuccess':
                return results[0]

            case 'mostLogs': {
                const firstResult = results[0]
                if (Array.isArray(firstResult)) {
                    return results.reduce((prev, current) =>
                        Array.isArray(current) && current.length > (Array.isArray(prev) ? prev.length : 0)
                            ? current
                            : prev
                    )
                }
                return firstResult
            }

            case 'highestBlock': {
                const firstResult = results[0]
                if (typeof firstResult === 'bigint') {
                    return results.reduce((prev, current) =>
                        typeof current === 'bigint' && current > (typeof prev === 'bigint' ? prev : 0n)
                            ? current
                            : prev
                    )
                }
                return firstResult
            }

            default:
                return results[0]
        }
    }

    /**
     * Returns the highest block number reported by available nodes.
     *
     * Used as a safety mechanism against lagging RPC providers.
     * Logs status of each node for real-time monitoring.
     */
    async getBlockNumber(): Promise<bigint> {
        const tasks = this.nodes.map(async ({ url, client }) => {
            try {
                const blockNumber = await client.getBlockNumber({
                    cacheTime: 0
                })

                if (blockNumber >= 0n) {
                    console.log(`[ RPC OK ] | ${blockNumber} | ${url}`)

                    return { success: true, blockNumber, url }
                }
            } catch (error: any) {
                console.log(`[RPC FAIL] ${url} → ${error.message}`)
            }
            return { success: false, blockNumber: null, url }
        })

        const results = await Promise.all(tasks)
        const successful = results
            .filter(r => r.success && r.blockNumber !== null)
            .map(r => r.blockNumber!) as bigint[]

        if (successful.length === 0) {
            throw new Error('[RPC FAIL] All nodes failed to get block number')
        }

        // Use highe block number strategy
        return successful.reduce((prev, current) =>
            current > prev ? current : prev
        )
    }

    /**
     * Retrieves a block by number or hash.
     */
    async getBlock(args: Parameters<PublicClient['getBlock']>[0]): Promise<Block> {
        return this.executeParallel('getBlock', [args], 'firstSuccess')
    }

    /**
     * Retrieves a transaction by hash.
     */
    async getTransaction(args: { hash: Hash }): Promise<Transaction> {
        return this.executeParallel('getTransaction', [args], 'firstSuccess')
    }

    /**
     * Retrieves a transaction receipt by hash.
     */
    async getTransactionReceipt(args: { hash: Hash }): Promise<TransactionReceipt> {
        return this.executeParallel('getTransactionReceipt', [args], 'firstSuccess')
    }

    /**
     * Waits until a transaction receipt becomes available.
     */
    async waitForTransactionReceipt(
        args: Parameters<PublicClient['waitForTransactionReceipt']>[0]
    ): Promise<TransactionReceipt> {
        return this.executeParallel('waitForTransactionReceipt', [args], 'firstSuccess')
    }

    /**
     * Returns the native balance of an address.
     */
    async getBalance(args: Parameters<PublicClient['getBalance']>[0]): Promise<bigint> {
        return this.executeParallel('getBalance', [args], 'firstSuccess')
    }

    /**
     * Returns the current gas price.
     */
    async getGasPrice(): Promise<bigint> {
        return this.executeParallel('getGasPrice', [], 'firstSuccess')
    }

    /**
     * Returns historical fee data for EIP-1559.
     */
    async getFeeHistory(
        args: Parameters<PublicClient['getFeeHistory']>[0]
    ): Promise<FeeHistory> {
        return this.executeParallel('getFeeHistory', [args], 'firstSuccess')
    }

    /**
     * Executes a read-only contract call.
     */
    async call(args: CallParameters): Promise<any> {
        return this.executeParallel('call', [args], 'firstSuccess')
    }

    /**
     * Returns the current chain ID.
     */
    async getChainId(): Promise<number> {
        return this.executeParallel('getChainId', [], 'firstSuccess')
    }

    /**
     * Returns deployed bytecode at the given address.
     */
    async getCode(args: Parameters<PublicClient['getCode']>[0]): Promise<GetCodeReturnType> {
        return this.executeParallel('getCode', [args], 'firstSuccess')
    }

    /**
     * Retrieves logs using the result set containing the highest number of entries.
     */
    async getLogs(args: Parameters<PublicClient['getLogs']>[0]): Promise<Log[]> {
        return this.executeParallel('getLogs', [args], 'mostLogs')
    }
}