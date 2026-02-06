// config/types.ts
export interface BotConfig {
    bot_id: string;
    bot_token: string;
    open_access: boolean;
    polling: boolean;
}

export interface DatabaseConfig {
    host: string;
    user: string;
    password: string;
    database: string;
}

export interface ButtonConfig {
    text: string;
    url: string;
}

export interface SystemConfig {
    owner: number;
    bots: BotConfig[];
    rpc_urls: string[];
    chain: string;
    explorer: string;
    chart: string;
    vault: string;
    multicall_address: string;
    database: DatabaseConfig;
    buttons: ButtonConfig[][];
}
