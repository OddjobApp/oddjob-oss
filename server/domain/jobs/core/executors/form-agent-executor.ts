
import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger('FormAgentExecutor');

export interface FormAgentConfig {
    documentTemplateId: number;
    formSchema: {
        fields: Array<{
            key: string;
            type: string;
            label: string;
            required?: boolean;
            options?: string[];
            defaultValue?: any;
        }>;
    };
    outputDataset?: string;
    variableMappings: Record<string, string>;
    timeoutMinutes: number;
    retryOnFailure: boolean;
}

export class FormAgentExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "form_agent";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: any,
        stepExecutionId?: number
    ): Promise<StepExecutionResult> {

        const config = resolvedConfig as FormAgentConfig;

        // If this is a real execution (stepExecutionId present), it should wait for input
        if (stepExecutionId && stepExecutionId !== 0) {
            // In a real pipeline, we wait for a human to fill the form
            // For now, let's behave like human_approval but specific to form_agent
            return {
                success: true,
                status: "waiting_external_input",
                output: JSON.stringify({
                    _type: "form_agent_context",
                    message: `Waiting for form submission...`,
                    formSchema: config.formSchema,
                    stepExecutionId
                })
            };
        }

        // If this is a test/dry run (stepExecutionId is 0 or missing), 
        // we return a mock output to allow schema capture.
        const mockOutput: Record<string, any> = {};
        if (config.formSchema?.fields) {
            config.formSchema.fields.forEach(field => {
                let val: any = "Sample Value";
                if (field.type === 'number') val = 123;
                if (field.type === 'boolean') val = true;
                if (field.type === 'date') val = new Date().toISOString();
                if (field.type === 'select' && field.options && field.options.length > 0) val = field.options[0];
                if (field.defaultValue !== undefined && field.defaultValue !== null) val = field.defaultValue;

                mockOutput[field.key] = val;
            });
        }

        return {
            success: true,
            status: "success",
            output: JSON.stringify(mockOutput)
        };
    }
}


