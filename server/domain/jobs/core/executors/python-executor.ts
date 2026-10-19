
import { Job, Pipeline, PythonConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AppError, ErrorCode } from "@server/utils/errors.js";
import { sandboxService } from "../../../../services/sandbox.service.js";
import { mustSandboxUserCode } from "./sandbox-policy.js";

const execAsync = promisify(exec) as (command: string, options?: any) => Promise<{ stdout: string, stderr: string }>;

export class PythonExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "python";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as PythonConfig;
        const scriptContent = config.scriptContent;

        if (scriptContent === undefined || scriptContent === null) {
            throw new Error(`Python execution failed: Job configuration for "${job.name}" (ID: ${job.id}) is missing "scriptContent". Current config: ${JSON.stringify(config)}`);
        }

        let tempDir: string | undefined;
        let tempFile: string | undefined;

        try {
            // Create a temporary directory for the script and any potential outputs
            tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oddjob-python-"));
            tempFile = path.join(tempDir, "script.py");

            // Write script to temp file
            await fs.promises.writeFile(tempFile, scriptContent || "");

            // Write input data if available
            if (context.data) {
                const inputFile = path.join(tempDir, "input.json");
                await fs.promises.writeFile(inputFile, JSON.stringify(context.data, null, 2));
            }

            // Execute
            console.log(`[PythonExecutor] Running Python script: ${tempFile} (Job: ${job.id})`);

            let stdout: string;
            let stderr: string;

            const useSandbox = mustSandboxUserCode(config);
            if (useSandbox) {
                const res = await sandboxService.runPython(scriptContent, { timeoutMs: 30000 });
                stdout = res.stdout;
                stderr = res.stderr;
            } else {
                // Cross-platform command selection
                const pythonCommand = os.platform() === 'win32' ? 'python' : 'python3';
                const res = await execAsync(`${pythonCommand} ${tempFile}`, {
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
                    timeout: 30000 // 30s timeout to prevent hangs
                });
                stdout = res.stdout;
                stderr = res.stderr;
            }

            if (stderr && stderr.trim().length > 0) {
                console.warn(`[PythonExecutor] Python stderr: ${stderr}`);
            }

            const telemetry = {
                script_size: config.scriptContent.length,
                stdout_size: stdout.length,
                stderr_size: stderr ? stderr.length : 0
            };

            return {
                success: true,
                output: stdout.trim(),
                status: "success",
                telemetry
            };
        } catch (error: any) {
            throw new AppError(`Python execution failed: ${error.message}`, 500, ErrorCode.INTERNAL_ERROR, { details: { originalError: error.message } });
        } finally {
            // Cleanup
            if (tempFile) {
                try {
                    await fs.promises.unlink(tempFile);
                } catch (e) {
                    console.error(`[PythonExecutor] Failed to delete temp file ${tempFile}:`, e);
                }
            }
            if (tempDir) {
                try {
                    await fs.promises.rm(tempDir, { recursive: true, force: true });
                } catch (e) {
                    console.error(`[PythonExecutor] Failed to delete temp dir ${tempDir}:`, e);
                }
            }
        }
    }
}


