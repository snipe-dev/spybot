import {getENSCache} from '../ens/ens-resolver.js';
import {InlineKeyboard} from "grammy";
import {formatEther, getAddress} from "viem";
import {baseTokens} from "../system/base-tokens.js";
import {shortSignature} from "../selectors/signature-resolver.js";
import type {MessageBuilderConfig} from "./types.js";
import type {TransactionData} from "../transport/types.js";
import type {TracerResult} from "../tracer/types.js";

/**
 * Builds formatted Telegram messages for EVM transactions.
 *
 * Responsible for:
 * - Rendering transaction metadata (from/to, value, gas, block, hash)
 * - Displaying decoded trace information (PNL, balance, interactions)
 * - Resolving ENS names when available
 * - Generating optional inline keyboard buttons for token-related actions
 *
 * Output is HTML-formatted text compatible with Telegram parse mode.
 */
export class MessageBuilder {
    private readonly ensCache = getENSCache();

    /**
     * @param config Runtime configuration used to build explorer links,
     *               chart URLs, chain labels, vault symbol and buttons.
     */
    constructor(
        private readonly config: MessageBuilderConfig
    ) {}

    /**
     * Resolves an address to ENS name if cached.
     * Falls back to checksum-formatted address.
     *
     * @param address EVM address
     * @returns ENS name or checksum address
     */
    private resolveENS(address: string): string {
        return this.ensCache.get(address.toLowerCase()) ?? getAddress(address);
    }

    /**
     * Builds the final Telegram message for a transaction.
     *
     * Includes:
     * - Direction indicator and status icon
     * - From/To addresses with explorer links
     * - Token interaction summary
     * - Function signature and method selector
     * - Value, PNL, balance, gas info
     * - Transaction and block references
     *
     * @param address Tracked address
     * @param tx Raw transaction data
     * @param decoded Decoded trace result
     * @param signature Full function signature (if resolved)
     *
     * @returns Object containing formatted HTML text
     *          and optional inline keyboard
     */
    public build(
        address: string,
        tx: TransactionData,
        decoded: TracerResult,
        signature: string
    ): { text: string; buttons?: InlineKeyboard } {

        const selector = tx.data.slice(0, 10);
        const p = this.prepareMessageParams(address, tx, decoded, selector);

        let txVal = Number(formatEther(tx.value));
        txVal = Math.round(txVal * 1000) / 1000;

        let msg = p.icon;

        msg += `<b>$$NAME$$</b>\n`;

        const toLabel = p.isContractAddress ? 'new  :' : 'to   :';

        msg += `<a href="${this.config.explorer}address/${p.from}/transactions">➥</a><code>from :</code> <code>${this.resolveENS(p.from)}</code>${this.dot(address, p.from)}\n`;
        msg += `<a href="${this.config.explorer}address/${p.to}/transactions">➥</a><code>${toLabel}</code> <code>${this.resolveENS(p.to)}</code>${this.dot(address, p.to)}\n`;

        msg += p.interactions;

        if (signature !== selector) {
            msg += `<code>Function: </code>${shortSignature(signature)}\n`;
        }

        msg += `<code>MethodID: </code>${selector}\n`;

        msg += `<code>Val: </code><b>${txVal}</b><code>${this.config.vault}</code> | `;
        msg += `<code>PNL: </code><b>${decoded.pnl}</b><code>${this.config.vault}</code> | `;
        msg += `<code>Bal: </code><b>${decoded.bal}</b><code>${this.config.vault}</code> ${decoded.chn} | `;
        msg += `<code>Gwei: </code><b>${this.gwei(tx)}</b>\n`;

        msg += `<code>Txn: </code><a href="${this.config.explorer}tx/${tx.hash}/">${tx.hash.slice(0, 6)}..${tx.hash.slice(62, 66)}</a>`;
        msg += `<code> at </code><a href="${this.config.explorer}txs?block=${decoded.blockNumber}/">${decoded.blockNumber}</a> | `;
        msg += `<code>Find: </code>#S${address.slice(34, 42)}`;

        if (p.tokenForButton) {
            msg += ` | <code>Token: </code>#T${p.tokenForButton.slice(2, 10)}`;
        }
        msg += `\n`;

        msg += `<b>${this.config.chain}</b>`;
        return {
            text: msg,
            buttons: p.tokenForButton
                ? this.buildKeyboard(p.tokenForButton)
                : undefined
        };
    }

    /**
     * Builds inline keyboard with configured URL buttons.
     * Token address is injected into button URLs.
     *
     * @param token Token address used in URL templates
     */
    private buildKeyboard(token: string): InlineKeyboard {
        const keyboard = new InlineKeyboard();

        for (const row of this.config.buttons) {
            const btnRow = row.map(btn =>
                InlineKeyboard.url(
                    btn.text,
                    btn.url.replace("$$ADDRESS$$", token)
                )
            );

            keyboard.row(...btnRow);
        }

        return keyboard;
    }

    /**
     * Prepares dynamic message parts:
     * - Direction icon
     * - Interaction summary
     * - Button token (if applicable)
     *
     * @param address Tracked address
     * @param tx Transaction data
     * @param decoded Decoded trace result
     * @param selector Method selector
     */
    private prepareMessageParams(
        address: string,
        tx: TransactionData,
        decoded: TracerResult,
        selector: string
    ) {
        const interact = decoded.interact ?? {};
        let interactions = "";
        let tokenForButton: string | null = null;

        let icon = address === tx.to ? "↘️:  " : "↖️:  ";
        let from = tx.from;
        let to = tx.to ?? address;
        let isContractAddress = false;

        const tokens = Object.keys(interact);

        if (tokens.length > 0) {
            interactions = "<code>Interact: </code>";

            for (let i = 0; i < tokens.length && i < 10; i++) {
                const token = tokens[i];
                const symbol = interact[token];

                if (!baseTokens.includes(symbol)) {
                    interactions += `<a href="${this.config.chart}${token}?maker=${tx.from}"><b>[${symbol}]</b></a>`;
                    interactions += `<a href="${this.config.explorer}token/${token}"><b>[➥]</b></a> | `;
                    tokenForButton = token;
                } else {
                    interactions += `<a href="${this.config.chart}${token}">[${symbol}]</a> | `;
                }
            }

            interactions = interactions.slice(0, -2) + "\n";
        }

        try {
            if (tokens.length === 1 && selector === '0xa9059cbb') {
                if (address === from) {
                    icon = "💰➡️:  ";
                } else {
                    icon = "➡️💰:  ";
                }

                if (decoded.amount) {
                    interactions = interactions.slice(0, -1);
                    interactions += `→ ${decoded.amount}\n`;
                }
            }

            if (tokens.length > 1) {
                if (tx.value === 0n) {
                    icon = '<b>⚪️ Sell</b>:  ';
                } else {
                    icon = '<b>🟢 Buy</b>:  ';
                }
                if (decoded.status === false) {
                    icon = '<b>🟢 Buy</b>:  ';
                }
            }

        } catch (e) {
            console.error('Error determining icon:', e);
        }

        if (decoded.contractAddress && to === decoded.contractAddress) {
            isContractAddress = true;
        }

        icon = this.checkStatus(decoded.status) + icon;

        return {
            interactions,
            icon,
            from,
            to,
            tokenForButton,
            isContractAddress
        };
    }

    /**
     * Returns visual status indicator.
     *
     * @param status Transaction execution status
     */
    private checkStatus(status: boolean | null): string {
        if (status === null) return "";
        return status ? "✅" : "❌";
    }

    /**
     * Marks address with a dot if it matches tracked address.
     *
     * @param a First address
     * @param b Second address
     */
    private dot(a: string, b: string): string {
        return a.toLowerCase() === b.toLowerCase() ? "●" : "";
    }

    /**
     * Extracts priority fee (Gwei) from transaction.
     * Returns "1" as fallback.
     *
     * @param tx Transaction data
     */
    private gwei(tx: TransactionData): string {
        try {
            return tx.maxPriorityFeePerGas
                ? (Number(tx.maxPriorityFeePerGas) / 1e9).toString()
                : "1";
        } catch {
            return "1";
        }
    }
}