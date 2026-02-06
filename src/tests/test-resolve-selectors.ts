import {closeDatabase, resolveSelector, shortSignature} from '../selectors/signature-resolver.js';

/**
 * Example usage of signature resolver
 */
async function example() {
    // Example selectors
    const selectors = [
        '0xa9059cbb', // transfer(address,uint256)
        '0x095ea7b3', // approve(address,uint256)
        '0x23b872dd', // transferFrom(address,address,uint256)
        '0x12345678', // Unknown selector
    ];

    console.log('Resolving selectors...\n');

    for (const selector of selectors) {
        const signature = await resolveSelector(selector);
        const short = shortSignature(signature);
        console.log(`${selector} -> ${signature} -> ${short}`);
    }

    // Clean up
    closeDatabase();
}

example().catch(console.error);