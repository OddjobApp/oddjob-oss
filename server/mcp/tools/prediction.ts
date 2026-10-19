/**
 * Prediction Intelligence Tool Definitions
 */
export const predictionToolDefinitions = [
    {
        name: "get_hidden_state_estimate",
        description: "Infers the current hidden state of the system based on context and quants.",
        inputSchema: {
            type: "object",
            properties: {
                contextId: { type: "string", description: "The context ID (e.g., 'user-123' or 'session-xyz')" }
            },
            required: ["contextId"]
        }
    },
    {
        name: "predict_outcomes",
        description: "Generates prediction branches for a set of predicates.",
        inputSchema: {
            type: "object",
            properties: {
                contextId: { type: "string", description: "The context ID" },
                predicates: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of predicates to predict (e.g., ['user_will_click', 'user_will_bounce'])"
                }
            },
            required: ["contextId", "predicates"]
        }
    },
    {
        name: "explain_prediction",
        description: "Generates a causal explanation for a prediction.",
        inputSchema: {
            type: "object",
            properties: {
                contextId: { type: "string", description: "The context ID" },
                predictionId: { type: "string", description: "The prediction ID" }
            },
            required: ["contextId", "predictionId"]
        }
    }
];
