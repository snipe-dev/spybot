import {getENSCache} from '../ens/ens-resolver.js';

/**
 * Initialize ENS cache at application startup.
 * The returned Map contains lowercase address -> ENS name mappings.
 */
const ensCache = getENSCache();

/**
 * Resolve an address using the in-memory ENS cache.
 * Returns the ENS name if present, otherwise returns the original address.
 *
 * @param address - Ethereum address to resolve.
 * @returns ENS name or the original address if not found.
 */
const ENS = (address: string): string =>
    ensCache.get(address.toLowerCase()) ?? address;

/**
 * Log the number of ENS records currently loaded into memory.
 */
console.log(`Loaded ${ensCache.size} ENS records`);

/**
 * Example usage of the ENS() helper.
 * Demonstrates resolution with fallback to the original address.
 */
const address1 = '0x742d35Cc6634C0532925a3b844Bc9e90F90b1A6f';
const name1 = ENS(address1);

console.log(`${address1} -> ${name1}`);

const address2 = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const name2 = ENS(address2);

console.log(`${address2} -> ${name2}`);
