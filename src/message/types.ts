export interface InlineButtonConfig {
    text: string;
    url: string;
}

export type InlineKeyboardConfig = InlineButtonConfig[][];

export interface MessageBuilderConfig {
    chain: string;
    explorer: string;
    chart: string;
    vault: string;
    buttons: InlineKeyboardConfig;
}
