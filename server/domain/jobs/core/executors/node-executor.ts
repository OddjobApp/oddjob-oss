
import { Job, Pipeline, NodeScriptConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor, ExecuteJobFn } from "./index.js";
import * as vm from "node:vm";

export class NodeExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "node_script";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as NodeScriptConfig;

        // Prepare Log Capture
        const logs: string[] = [];
        const captureLog = (...args: any[]) => {
            logs.push(args.map(a =>
                typeof a === 'object' ? JSON.stringify(a) : String(a)
            ).join(' '));
        };

        // Prepare Context Sandbox
        // We expose a limited API for security and simplicity
        const sandbox = {
            inputs: resolvedConfig.inputs || {},
            console: {
                log: captureLog,
                error: captureLog,
                warn: captureLog,
                info: captureLog,
            },
            // Include basic utilities
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            fetch: global.fetch,
            // Expose a way to return result? 
            // In VM, the last expression is returned, or they can return explicitly.
        };

        const vmContext = vm.createContext(sandbox);

        // Wrap script in an async function to allow 'await' and better control
        // We basically execute: (async () => { ... user code ... })()
        const wrapperScript = `
            (async () => {
                ${config.script}
            })()
        `;

        try {
            const result = await vm.runInContext(wrapperScript, vmContext, {
                timeout: config.timeoutMs || 5000,
                displayErrors: true,
            });

            // If the script returns a Promise (because it's async), wait for it
            const finalResult = await Promise.resolve(result);

            let output = "";
            if (typeof finalResult === 'object') {
                output = JSON.stringify(finalResult);
            } else if (finalResult !== undefined) {
                output = String(finalResult);
            } else {
                // If no return value, use logs or empty object
                output = logs.length > 0 ? logs.join('\n') : "{}";
            }

            return {
                success: true,
                output: output,
                status: "success",
            };

        } catch (error: any) {
            return {
                success: false,
                output: logs.join('\n'), // Return logs even on failure for debugging
                status: "failure",
                error: error.message || String(error),
            };
        }
    }
}


