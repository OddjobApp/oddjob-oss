import { z } from "zod";
import { PipelineStepFormSchema } from "@/schemas/pipeline-schemas";

export type FormStep = Omit<z.infer<typeof PipelineStepFormSchema>, 'onFailureAction' | 'runOnCondition'> & {
    tempId: string;
    // Add any UI-only properties that might not be in the schema but are used in the form
    name?: string;
    destinationStepId?: number | null;
    decisionNodeConfig?: any;
    transformerConfig?: any;
    iteratorConfig?: any;
    decisionConfig?: any;
    inputMapping?: any;
    runOnCondition?: "on_success" | "on_failure" | "always";
    onFailureAction?: "Stop Pipeline" | "Continue to Next" | "Execute Fallback Job";
    fallbackJobId?: number | null;
    retryConfig?: any;
    [key: string]: any;
};
