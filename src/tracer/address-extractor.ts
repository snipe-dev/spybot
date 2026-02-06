import {getAddress, Hex, isAddress} from 'viem';

/**
 * AddressExtractor extracts EVM addresses from transaction calldata and logs.
 *
 * The extraction logic is intentionally heuristic and low-level:
 * - raw 32-byte chunk scanning
 * - multiple calldata offsets for better ABI coverage
 * - no ABI decoding assumptions
 *
 * This approach is proven to be more reliable than regex-based scanning
 * for real-world calldata.
 */
export class AddressExtractor {
    /**
     * Extracts addresses from raw transaction calldata.
     *
     * The method scans calldata in 32-byte chunks using multiple offsets
     * to catch different ABI-encoding layouts.
     *
     * @param _data - Transaction calldata (hex string, with 0x prefix)
     * @returns Array of unique, lowercase addresses
     */
    extractAddressesFromCalldata(_data: Hex | string): string[] {
        const addresses: string[] = [];

        try {
            if (!_data || _data.length < 76) return [];

            // Offsets used to improve coverage of ABI-encoded addresses
            // 2  -> after "0x"
            // 10 -> after function selector (4 bytes)
            const offsets = [2, 10];

            for (const offset of offsets) {
                const data = _data.slice(offset);

                for (let i = 0; i < data.length; i += 64) {
                    try {
                        const chunk = data.substring(i, i + 64);

                        // Address is encoded as 12 zero bytes + 20-byte address
                        if (chunk.slice(0, 24) === '000000000000000000000000') {
                            const addressHex = '0x' + chunk.slice(24, 64);
                            
                            // Validate address before adding
                            if (isAddress(addressHex)) {
                                const address = getAddress(addressHex);
                                addresses.push(address.toLowerCase());
                            }
                        }
                    } catch (e) {
                        // Ignore invalid chunk or address
                    }
                }
            }
        } catch (e) {
            // Ignore malformed calldata
        }

        return [...new Set(addresses)];
    }

    /**
     * Extracts contract addresses from transaction logs.
     *
     * @param logs - Transaction receipt logs
     * @returns Array of unique addresses
     */
    extractAddressesFromLogs(logs: Array<{ address: string }>): string[] {
        const addresses = new Set<string>();

        for (const log of logs) {
            try {
                if (isAddress(log.address)) {
                    const address = getAddress(log.address);
                    addresses.add(address.toLowerCase());
                }
            } catch (e) {
                // Ignore invalid log addresses
            }
        }

        return Array.from(addresses);
    }

    /**
     * Extracts ERC20 transfer recipient from calldata.
     *
     * Supports only transfer(address,uint256).
     *
     * @param data - Transaction calldata
     * @returns Address or null
     */
    extractTransferRecipient(data: Hex | string): string | null {
        try {
            // transfer(address,uint256) selector: 0xa9059cbb
            if (data.startsWith('0xa9059cbb') && data.length >= 74) {
                const addressHex = '0x' + data.slice(34, 74);
                
                if (isAddress(addressHex)) {
                    return getAddress(addressHex);
                }
            }
        } catch (e) {
            // Ignore decode errors
        }

        return null;
    }
}
