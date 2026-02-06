import {MultinodePublicClient} from '../transport/multinode-client.js';
import {OptimizedTracer} from '../tracer/optimized-tracer.js';
import {normalizeTransaction} from "../transport/transactions.js";

/**
 * Simple quick test for OptimizedTracer
 */

const rpcUrls = [
    'http://157.90.212.108:8545',
    'http://65.108.192.118:8545',
    'https://bsc-rpc.publicnode.com',
];

const multicallAddress = '0xcA11bde05977b3631167028862bE2a173976CA11';
const client = new MultinodePublicClient({ rpcUrls, requestTimeout: 3000 });
const tracer = new OptimizedTracer(client, multicallAddress);

async function quickTest() {
    const txHash = '0x06cef431a17feaec1edb00e1705fe93187851ce3fafc7ee01571ee79a8ce6d2f';

    const raw_tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    const tx = normalizeTransaction(raw_tx)
    console.log('From:', tx.from);

    const fast = await tracer.decodeFast(tx, tx.from);
    console.log('\nFast:', fast);

    const full = await tracer.decodeFull(tx, tx.from);
    console.log('\nFull:', full);

    tracer.close();
}

quickTest().catch(console.error);