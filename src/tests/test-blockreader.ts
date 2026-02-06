import {config} from "../system/config.js";
import {BlockReader} from '../transport/block-reader.js';
import {MultinodePublicClient} from "../transport/multinode-client.js";

async function main() {
    console.log('=== Starting BlockReader Test ===\n');

    try {
        // Create a multinode RPC client
        const multinodeClient = new MultinodePublicClient({
            rpcUrls: config.rpc_urls,
            requestTimeout: 3000   // Timeout for regular RPC requests
        });

        // Create BlockReader using the multinode client
        const blockReader = new BlockReader(multinodeClient);

        // Subscribe to new block events
        blockReader.on('new_block', async (block) => {

        });

        // Subscribe to error events
        blockReader.on('error', (error) => {
            console.error('BlockReader error:', error.message);
        });

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

main().catch(console.error);
