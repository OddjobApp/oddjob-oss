
import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";

export class RerankerExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "reranker" || jobType.trim() === "reranker";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig;

        // Dynamic import as per original pattern
        const { semanticRerank } = await import("@domain/knowledge/core/rag-langchain.service.js");

        let docs: any[] = [];
        try {
            docs = JSON.parse(config.documents);
        } catch {
            docs = [config.documents];
        }

        if (!Array.isArray(docs)) docs = [docs];

        // Prepare for semanticRerank
        const rDocs = docs.map((d, i) => {
            let content = "";
            if (typeof d === "string") content = d;
            else if (d.pageContent) content = d.pageContent;
            else if (d.text) content = d.text;
            else content = JSON.stringify(d);

            return {
                pageContent: content,
                metadata: { order: i },
                adjustedScore: 1.0,
            };
        });

        const reranked = await semanticRerank(rDocs, config.query, config.credentialId, {
            semanticWeight: config.semanticWeight || 0.7,
            baseWeight: config.baseWeight || 0.3,
            negativePrompt: config.negativePrompt
        });

        const output = JSON.stringify(reranked.slice(0, config.topK), null, 2);

        const telemetry = {
            doc_count: docs.length,
            top_k: config.topK,
            semantic_weight: config.semanticWeight,
            reranked_count: reranked.length
        };

        return {
            success: true,
            output,
            status: "success",
            telemetry
        };
    }
}


