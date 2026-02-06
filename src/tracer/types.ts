/**
 * Common type definitions for the tracer system
 */

export interface TokenMetadata {
    symbol: string;
    decimals: number;
}

export interface TokenMap {
    [address: string]: string; // address => symbol
}

export interface BalanceData {
    bal: string;
    chn: string;
}

export interface BalanceChangeData extends BalanceData {
    pnl: string;
}

export interface TracerResult {
    status: boolean | null;
    interact: TokenMap;
    logs: number | null;
    blockNumber: bigint | string;
    contractAddress: string | null;
    pnl: string;
    bal: string;
    chn: string;
    amount: string | null;
}
