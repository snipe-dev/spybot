import {decodeFunctionResult, encodeFunctionData, Hex} from "viem";
import {MultinodePublicClient} from "../transport/multinode-client.js";
import {multicallAbi} from "./abi.js";

/**
 * Interface representing a call for multicall
 * @interface MulticallData
 * @property {string} target - Contract address to call
 * @property {Hex} callData - Encoded call data (calldata)
 */
export interface MulticallData {
    target: string;
    callData: Hex;
}

/**
 * Executes multicall via Multicall3 contract
 * @async
 * @function multicall
 * @param {MultinodePublicClient} client - Viem PublicClient for blockchain interaction
 * @param {string} multicallAddress - Multicall3 contract address
 * @param {MulticallData[]} calldata - Array of calls to aggregate
 * @returns {Promise<Array<{success: boolean; returnData: Hex}>>}
 *          Promise that resolves to an array of results with success flag and return data
 */
export async function multicall(
    client: MultinodePublicClient,
    multicallAddress: string,
    calldata: MulticallData[]
): Promise<Array<{ success: boolean; returnData: Hex }>> {
    if (calldata.length === 0) {
        return [];
    }

    const data = encodeFunctionData({
        abi: multicallAbi,
        functionName: "tryAggregate",
        args: [
            false,
            calldata.map(call => ({
                target: call.target as Hex,
                callData: call.callData,
            })),
        ],
    });

    const result = await client.call({
        to: multicallAddress as Hex,
        data,
    });

    if (!result.data) {
        return [];
    }

    return decodeFunctionResult({
        abi: multicallAbi,
        functionName: "tryAggregate",
        data: result.data,
    }) as Array<{ success: boolean; returnData: Hex }>;
}