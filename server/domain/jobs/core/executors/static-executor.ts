
import { Job, Pipeline, StaticResponseConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";

export class StaticExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "static_response";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: any }
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as StaticResponseConfig;

        // Check for required variables
        if (config.requiredVariables && config.requiredVariables.length > 0) {
            const missingVars: string[] = [];

            for (let varName of config.requiredVariables) {
                // Sanitize: Remove {{ and }} if present (common user error in config)
                varName = varName.replace(/^{{\s*/, '').replace(/\s*}}$/, '');

                // Simple existence check in top-level context buckets
                const inData = context.data && context.data[varName] !== undefined;
                const inNamed = context.named && context.named[varName] !== undefined;
                const inPositional = context.positional && !isNaN(parseInt(varName)) && context.positional[parseInt(varName)] !== undefined;

                // Check if it's nested data (e.g. "ticket.id")
                let inNestedData = false;
                if (varName.includes('.') && context.data) {
                    const parts = varName.split('.');
                    let current: any = context.data;
                    for (const part of parts) {
                        if (current === null || current === undefined || typeof current !== 'object') {
                            current = undefined;
                            break;
                        }
                        current = current[part];
                    }
                    inNestedData = current !== undefined;
                }

                if (!(inData || inNamed || inPositional || inNestedData)) {
                    missingVars.push(varName);
                }
            }

            if (missingVars.length > 0) {
                return {
                    success: false,
                    output: `Error: Missing required input variables: ${missingVars.join(", ")}`,
                    status: "failed"
                };
            }
        }

        let outputContent = config.content || "";

        // Process output mapping
        if (config.outputMapping && Object.keys(config.outputMapping).length > 0) {
            // Note: Since 'resolvedConfig' already has variables resolved by the variable-resolver, 
            // the values in outputMapping should already be resolved if they were templates.
            // However, verify-static-job.ts shows we need to check if we need to manually resolve them 
            // or if variable-resolver handles it. 
            // Looking at variable-resolver.ts, it only resolves specific fields. 
            // We need to add 'outputMapping' to variable-resolver.ts OR resolve it here if we want dynamic values.
            // But 'resolvedConfig' passed here is ALREADY resolved. 
            // Let's check variable-resolver.ts... it doesn't handle outputMapping yet.
            // So we rely on the fact that we should update variable-resolver.ts too, OR just take the values as is 
            // (assuming the user wants static values or we add it to resolver).

            // Wait, if we want `{{variable}}` in output mapping to work, we must update variable-resolver.ts.
            // Implementation plan said: "Update execute method to process outputMapping."
            // But standard pattern is to update variable-resolver for config fields.
            // Let's assume we will update variable-resolver to handle it.

            // Construct JSON object from mapping
            const outputJson: Record<string, any> = {};
            for (const [key, value] of Object.entries(config.outputMapping)) {
                outputJson[key] = value;
            }

            // Append to output content? Or replace? 
            // If content is typically a string message, maybe we want to keep it. 
            // But pipeline runner expects `output` to be the result. 
            // If we return a JSON string, it parses it. 
            // If we return a plain string, it's just a string.
            // MIXING plain text and JSON output is tricky. 
            // If the user wants structured output, the 'content' should probably BE the JSON, 
            // or we return a JSON string that HAS a 'message' field plus the variables.

            // Let's create a combined object if mapping exists
            if (outputContent) {
                outputJson['message'] = outputContent;
            }
            outputContent = JSON.stringify(outputJson);
        }

        return {
            success: true,
            output: outputContent,
            status: "success"
        };
    }
}


