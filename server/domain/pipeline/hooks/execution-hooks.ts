import { PipelineStep } from "@shared/schema/index.js";

export interface HookParams {
    result: any;
    currentStep: PipelineStep;
    pipeline: any;
    pipelineExecution: any;
    stepExecution: any;
    context: any;
    userId?: string;
    orgId: number;
    /** Set by hooks when a Golden Record is written (fine_tuning_examples, KG, or knowledge doc) */
    goldenRecordWritten?: boolean;
    /** Map of anchor external IDs to Knowledge Node IDs created during this step */
    knowledgeNodeIds?: Map<string, number>;
}

export interface PipelineCompleteParams {
    pipeline: any;
    pipelineExecution: any;
    stepResults: any[];
    userId?: string;
    orgId: number;
}

export interface ExecutionHook {
    name: string;
    onStepComplete?(params: HookParams): Promise<void>;
    onPipelineComplete?(params: PipelineCompleteParams): Promise<void>;
}

import { createLogger } from "@server/utils/logger.js";
const logger = createLogger("HookRegistry");

class HookRegistry {
    public hooks: ExecutionHook[] = [];
    public id = Math.random().toString(36).substring(7);

    constructor() {
        logger.info(`Created new instance: ${this.id}`);
    }

    register(hook: ExecutionHook) {
        // Idempotent by hook name. initializeHooks() registers unconditionally, so a
        // second call — two bootstraps in one process, or a test suite readying the
        // runtime — would stack duplicates and run every hook twice per step. That is
        // not merely wasteful: these hooks WRITE (knowledge nodes, dataset rows), so
        // duplicate registration silently duplicates data.
        if (this.hooks.some((existing) => existing.name === hook.name)) {
            logger.debug(`[Instance ${this.id}] Hook already registered, skipping: ${hook.name}`);
            return;
        }
        logger.info(`[Instance ${this.id}] Registering hook: ${hook.name}`);
        this.hooks.push(hook);
    }

    async triggerStepComplete(params: HookParams) {
        logger.info(`Triggering step complete for ${this.hooks.length} hooks. Step: ${params.currentStep?.id}, Result success: ${params.result?.success}`);
        for (const hook of this.hooks) {
            if (hook.onStepComplete) {
                try {
                    console.log(`[HookRegistry] Calling ${hook.name}.onStepComplete`);
                    await hook.onStepComplete(params);
                } catch (error) {
                    console.error(`[HookRegistry] Error in hook ${hook.name}.onStepComplete:`, error);
                }
            }
        }
    }

    async triggerPipelineComplete(params: PipelineCompleteParams) {
        for (const hook of this.hooks) {
            if (hook.onPipelineComplete) {
                try {
                    await hook.onPipelineComplete(params);
                } catch (error) {
                    console.error(`[HookRegistry] Error in hook ${hook.name}.onPipelineComplete:`, error);
                }
            }
        }
    }
}

export const hookRegistry = new HookRegistry();


