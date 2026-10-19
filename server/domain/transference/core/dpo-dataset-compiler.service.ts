export interface TelemetryTracePair {
    prompt: string;
    chosenResponse: string; // Golden Path SOP / Successful Execution
    rejectedResponse: string; // Failed Trace Anti-Pattern
    metadata?: Record<string, any>;
}

export interface DpoDatasetExport {
    jsonlLines: string[];
    recordCount: number;
    exportTimestamp: string;
    targetModelFormat: "huggingface_dpo" | "unsloth_dpo" | "llama_factory";
}

export const dpoDatasetCompilerService = {
    /**
     * Compiles paired positive (chosen) and negative (rejected) traces into standard DPO format
     */
    compileTracePair(pair: TelemetryTracePair): string {
        const record = {
            prompt: pair.prompt.trim(),
            chosen: pair.chosenResponse.trim(),
            rejected: pair.rejectedResponse.trim(),
            metadata: pair.metadata || {}
        };
        return JSON.stringify(record);
    },

    /**
     * Compiles a batch of telemetry trace pairs into a DPO training dataset
     */
    compileDpoDataset(
        pairs: TelemetryTracePair[],
        targetModelFormat: "huggingface_dpo" | "unsloth_dpo" | "llama_factory" = "huggingface_dpo"
    ): DpoDatasetExport {
        const lines: string[] = [];

        for (const pair of pairs) {
            if (pair.prompt && pair.chosenResponse && pair.rejectedResponse) {
                lines.push(this.compileTracePair(pair));
            }
        }

        return {
            jsonlLines: lines,
            recordCount: lines.length,
            exportTimestamp: new Date().toISOString(),
            targetModelFormat
        };
    }
};
