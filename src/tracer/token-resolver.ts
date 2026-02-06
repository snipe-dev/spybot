import {decodeAbiParameters, Hex} from 'viem';
import {TokenCache} from './token-cache.js';
import {MultinodePublicClient} from '../transport/multinode-client.js';
import {multicall, MulticallData} from '../multicall/multicall-viem.js';
import {TokenMap, TokenMetadata} from './types.js';
import {baseTokens} from "../system/base-tokens.js";

/**
 * TokenResolver resolves contract addresses to ERC20 token symbols.
 *
 * Design principles:
 * - Cache only confirmed tokens
 * - Never permanently cache negative results
 * - Always allow re-checking addresses via network
 *
 * This approach avoids missing freshly deployed or
 * temporarily uninitialized tokens.
 */
export class TokenResolver {
    private provider: MultinodePublicClient;
    private cache: TokenCache;
    private multicallAddress: string;

    /**
     * @param provider - MultinodePublicClient for blockchain interaction
     * @param multicallAddress - Multicall3 contract address
     */
    constructor(provider: MultinodePublicClient, multicallAddress: string) {
        this.provider = provider;
        this.cache = new TokenCache();
        this.multicallAddress = multicallAddress;
    }

    /**
     * Resolves a list of addresses to token symbols.
     *
     * Resolution flow:
     * 1. Read confirmed tokens from cache
     * 2. Fetch all unresolved addresses from network
     * 3. Cache only successfully resolved tokens
     *
     * @param addresses - Contract addresses to resolve
     * @returns address => symbol map
     */
    async resolveWithNetwork(addresses: string[]): Promise<TokenMap> {
        if (!addresses || !addresses.length) {
            return {};
        }

        const result: TokenMap = {};
        const toFetch: string[] = [];

        // Read confirmed tokens from cache
        const cachedTokens = this.cache.getTokens(addresses);

        // Split addresses into cached and unresolved
        for (const address of addresses) {
            const lowerAddress = address.toLowerCase();

            if (cachedTokens[lowerAddress]) {
                result[lowerAddress] = cachedTokens[lowerAddress].symbol;
            } else {
                toFetch.push(address);
            }
        }

        // Fetch unresolved addresses from network
        if (toFetch.length > 0) {
            const fetched = await this.fetchTokensFromNetwork(toFetch);

            for (const address of toFetch) {
                const lowerAddress = address.toLowerCase();
                const tokenData = fetched[address];

                if (tokenData && tokenData.symbol && tokenData.decimals > 0) {
                    result[lowerAddress] = tokenData.symbol;
                    this.cache.addToken(
                        address,
                        tokenData.symbol,
                        tokenData.decimals
                    );
                }
            }
        }

        return this.sortTokens(result);
    }

    /**
     * Fetches token metadata (symbol and decimals) from the network
     * using multicall.
     *
     * @param addresses - Addresses to query
     * @returns Map of address to token metadata
     */
    private async fetchTokensFromNetwork(
        addresses: string[]
    ): Promise<Record<string, TokenMetadata>> {
        const result: Record<string, TokenMetadata> = {};
        if (!addresses.length) {
            return result;
        }

        try {
            const symbolCalls: MulticallData[] = [];
            const decimalsCalls: MulticallData[] = [];

            // Prepare multicall payloads
            // symbol() selector: 0x95d89b41
            // decimals() selector: 0x313ce567
            for (const address of addresses) {
                symbolCalls.push({
                    target: address,
                    callData: '0x95d89b41' as Hex
                });
                decimalsCalls.push({
                    target: address,
                    callData: '0x313ce567' as Hex
                });
            }

            const [symbolResults, decimalsResults] = await Promise.all([
                multicall(this.provider, this.multicallAddress, symbolCalls),
                multicall(this.provider, this.multicallAddress, decimalsCalls)
            ]);

            // Process multicall results
            for (let i = 0; i < addresses.length; i++) {
                const address = addresses[i];
                const symbolResult = symbolResults[i];
                const decimalsResult = decimalsResults[i];

                if (!symbolResult || !symbolResult.success) continue;
                if (!decimalsResult || !decimalsResult.success) continue;

                try {
                    // Decode symbol (string)
                    const [symbol] = decodeAbiParameters(
                        [{ name: 'symbol', type: 'string' }],
                        symbolResult.returnData
                    );

                    // Decode decimals (uint8)
                    const [decimalsValue] = decodeAbiParameters(
                        [{ name: 'decimals', type: 'uint8' }],
                        decimalsResult.returnData
                    );

                    const symbolTrimmed = symbol.trim();
                    const decimals = Number(decimalsValue);

                    if (symbolTrimmed && symbolTrimmed.length > 0 && decimals > 0) {
                        result[address] = { symbol: symbolTrimmed, decimals };
                    }
                } catch (e) {
                    // Ignore decode errors, address will be retried later
                }
            }
        } catch (e) {
            // Network or multicall failure, return empty result
            console.error('TokenResolver.fetchTokensFromNetwork error:', e);
        }

        return result;
    }

    /**
     * Sorts tokens so that popular tokens appear at the end.
     *
     * @param tokens - address => symbol map
     * @returns Sorted token map
     */
    private sortTokens(tokens: TokenMap): TokenMap {
        const sorted: TokenMap = {};

        // First add non-popular tokens
        Object.keys(tokens).forEach(address => {
            if (!baseTokens.includes(tokens[address])) {
                sorted[address] = tokens[address];
            }
        });

        // Then add popular tokens
        Object.keys(tokens).forEach(address => {
            if (baseTokens.includes(tokens[address])) {
                sorted[address] = tokens[address];
            }
        });

        return sorted;
    }

    /**
     * Decodes ERC20 transfer amount using cached token decimals.
     *
     * @param data - Transaction calldata
     * @param tokenAddress - Token contract address
     * @returns Formatted amount or null
     */
    decodeTransferAmount(data: Hex | string, tokenAddress: string): string | null {
        const tokenData = this.cache.getToken(tokenAddress);
        if (!tokenData) return null;

        return this._decodeTransferAmount(data, tokenData.decimals);
    }

    /**
     * Internal helper to decode transfer amount.
     *
     * @param data - Transaction calldata
     * @param decimals - Token decimals
     * @returns Formatted amount or null
     */
    private _decodeTransferAmount(data: Hex | string, decimals: number): string | null {
        try {
            // transfer(address,uint256) selector: 0xa9059cbb
            if (data.startsWith('0xa9059cbb') && data.length >= 138) {
                const amountHex = ('0x' + data.slice(74, 138)) as Hex;

                const [value] = decodeAbiParameters(
                    [{ name: 'amount', type: 'uint256' }],
                    amountHex
                );

                const divisor = BigInt(10 ** decimals);
                const integerPart = value / divisor;
                const fractionalPart = value % divisor;

                const result =
                    Number(integerPart) +
                    Number(fractionalPart) / 10 ** decimals;

                return result.toFixed(2);
            }
        } catch (e) {
            // Ignore decode errors
        }

        return null;
    }

    /**
     * Extracts token addresses from liquidity pair contracts.
     *
     * Queries token0() and token1() from potential LP contracts
     * using multicall to identify underlying token addresses.
     *
     * @param addresses - Potential LP contract addresses
     * @returns Array of unique token addresses
     */
    async extractAddressesFromPairs(addresses: string[]): Promise<string[]> {
        const tokens: string[] = [];

        if (!addresses || addresses.length === 0) {
            return tokens;
        }

        try {
            const calldata: MulticallData[] = [];

            // Prepare multicall for token0() and token1()
            // token0() selector: 0x0dfe1681
            // token1() selector: 0xd21220a7
            for (const address of addresses) {
                calldata.push({
                    target: address,
                    callData: '0x0dfe1681' as Hex // token0()
                });
                calldata.push({
                    target: address,
                    callData: '0xd21220a7' as Hex // token1()
                });
            }

            const results = await multicall(
                this.provider,
                this.multicallAddress,
                calldata
            );

            // Process results and extract token addresses
            for (const result of results) {
                if (result && result.success) {
                    try {
                        const [tokenAddress] = decodeAbiParameters(
                            [{ name: 'token', type: 'address' }],
                            result.returnData
                        );

                        const normalizedAddress = tokenAddress.toLowerCase();

                        // Add only unique addresses
                        if (!tokens.includes(normalizedAddress)) {
                            tokens.push(normalizedAddress);
                        }
                    } catch (e) {
                        // Ignore decode errors - not a valid LP contract
                    }
                }
            }
        } catch (e) {
            // Ignore multicall errors - addresses might not be LP contracts
        }

        return tokens;
    }

    /**
     * Closes the token cache database.
     */
    close(): void {
        this.cache.close();
    }
}
