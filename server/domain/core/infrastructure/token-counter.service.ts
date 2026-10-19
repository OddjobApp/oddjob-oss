/**
 * Token Counter Service
 * Provides token counting using heuristics when specialized libraries are unavailable.
 */
export const tokenCounterService = {
    /**
     * Approximate tokens in a string.
     * Rule of thumb: 1 token ≈ 4 characters for English text.
     * For source code or complex JSON, tokens are shorter.
     */
    countTokens(text: string, model: string = "default"): number {
        if (!text) return 0;

        // Simple heuristic: 4 chars per token for general text
        let charPerToken = 4;

        // Adjust based on content type
        if (text.includes('{') && text.includes('}') && text.includes('"')) {
            // JSON/Code usually has more tokens per character
            charPerToken = 3.2;
        } else if (text.length > 1000 && text.split('\n').length > 20) {
            // Long structured text
            charPerToken = 3.5;
        }

        // Normalize model specific adjustments
        if (model.includes("gpt-4") || model.includes("claude-3")) {
            charPerToken *= 0.95; // Slightly denser encodings
        }

        return Math.ceil(text.length / charPerToken);
    },

    /**
     * Estimate output tokens based on task type.
     * Heuristics based on typical agent behavior.
     */
    estimateOutputTokens(taskType: string, inputTokens: number): number {
        const multipliers: Record<string, number> = {
            "data_analysis": 0.4,   // Summaries/tables
            "web_research": 0.5,    // Summarized findings
            "content_creation": 1.2, // Generating more text than input
            "debugging": 0.3,       // Usually concise fixes
            "testing": 0.4,         // Verification results
            "etl": 0.8,             // Transformed data
            "general": 0.5          // Default
        };

        const multiplier = multipliers[taskType] || 0.5;

        // Caps and floors for sanity
        const estimate = Math.ceil(inputTokens * multiplier);
        return Math.max(50, Math.min(estimate, 4096)); // Agent outputs are usually in this range
    }
};




