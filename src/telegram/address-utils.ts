import type {Address} from "viem";
import {getAddress, isAddress} from "viem";

/**
 * Ethereum address utilities using viem
 *
 * Provides address validation and checksum conversion.
 * Uses non-strict validation to accept both lowercase and checksum addresses.
 */

/**
 * Check if a string is a valid Ethereum address.
 * Works with both lowercase and checksum formats.
 */
export function isValidAddress(address: string): boolean {
    return isAddress(address, { strict: false });
}

/**
 * Convert address to checksum format.
 * Throws if address is invalid.
 */
export function getChecksumAddress(address: string): Address {
    return getAddress(address);
}

/**
 * Validate RPC URL format.
 */
export function isValidRpcUrl(url: string, allowedProtocols?: string[]): boolean {
    try {
        const parsedUrl = new URL(url);

        if (allowedProtocols && !allowedProtocols.includes(parsedUrl.protocol)) {
            return false;
        }

        const validProtocols = ["http:", "https:", "ws:", "wss:"];
        return validProtocols.includes(parsedUrl.protocol);
    } catch {
        return false;
    }
}

/**
 * Test RPC connectivity by fetching block number.
 * Uses viem's public client.
 */
export async function testRpcConnection(url: string): Promise<{
    success: boolean;
    blockNumber?: bigint;
    error?: string;
}> {
    try {
        // Динамический импорт viem для избежания проблем с bundling
        const { createPublicClient, http, webSocket } = await import("viem");

        const parsedUrl = new URL(url);
        const transport = (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:")
            ? webSocket(url)
            : http(url);

        const client = createPublicClient({
            transport,
        });

        const blockNumber = await client.getBlockNumber();

        return { success: true, blockNumber };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Validate and test RPC URL.
 */
export async function validateAndTestRpcUrl(
    url: string,
    allowedProtocols?: string[]
): Promise<{
    valid: boolean;
    tested?: boolean;
    blockNumber?: bigint;
    error?: string;
}> {
    // First check URL format
    if (!isValidRpcUrl(url, allowedProtocols)) {
        return {
            valid: false,
            error: "Invalid RPC URL format"
        };
    }

    // Then test connectivity
    const testResult = await testRpcConnection(url);

    if (testResult.success) {
        return {
            valid: true,
            tested: true,
            blockNumber: testResult.blockNumber
        };
    } else {
        return {
            valid: true,
            tested: false,
            error: testResult.error
        };
    }
}

