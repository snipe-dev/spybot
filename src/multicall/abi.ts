/**
 * Multicall contract ABI for tryAggregate function
 * @constant multicallAbi
 */
export const multicallAbi = [
    {
        type: "function",
        name: "tryAggregate",
        stateMutability: "view",
        inputs: [
            {
                name: "requireSuccess",
                type: "bool",
            },
            {
                name: "calls",
                type: "tuple[]",
                components: [
                    { name: "target", type: "address" },
                    { name: "callData", type: "bytes" },
                ],
            },
        ],
        outputs: [
            {
                name: "returnData",
                type: "tuple[]",
                components: [
                    { name: "success", type: "bool" },
                    { name: "returnData", type: "bytes" },
                ],
            },
        ],
    },
] as const;