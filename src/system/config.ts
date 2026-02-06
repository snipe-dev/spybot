import {readFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import type {SystemConfig} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads configuration based on command line argument
 * Usage: node dist/index.js bsc
 */
function loadSystemConfig(): SystemConfig {

    const configName = process.argv[2];

    if (!configName) {
        throw new Error(
            'Config file not specified. Use: node index.js <config> .\n'
        );
    }

    const configPath = join(__dirname, '..', 'config', `${configName}.json`);

    try {
        const configData = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configData) as SystemConfig;

        console.log(`[CONFIG] Loaded configuration: ${configName}`);

        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `Configuration file not found: ${configPath}\n`
            );
        }
        throw error;
    }
}

export const config = loadSystemConfig();

