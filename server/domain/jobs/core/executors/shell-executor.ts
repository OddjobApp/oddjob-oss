
import { Job, Pipeline, ShellConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { exec } from "child_process";
import { promisify } from "util";
import { AppError, ErrorCode } from "@server/utils/errors.js";
import { sandboxService } from "../../../../services/sandbox.service.js";
import { mustSandboxUserCode } from "./sandbox-policy.js";

const execAsync = promisify(exec) as (command: string, options?: any) => Promise<{ stdout: string, stderr: string }>;

export class ShellExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType.trim() === "shell" || (jobType === "shell"); // handle weird whitespace or legacy
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as any;
        try {
            let command = "";
            if (config.command) {
                command = config.command;
            } else {
                if (!config.executable) {
                    throw new AppError("Shell executable is not configured", 400, ErrorCode.INVALID_INPUT);
                }
                command = `${config.executable} ${config.parameters || ""}`;
            }
            console.log(`[ShellExecutor] Running shell command: ${command}`);
            let stdout: string;
            let stderr: string;

            const useSandbox = mustSandboxUserCode(config);
            if (useSandbox) {
                const res = await sandboxService.runShell(command, { timeoutMs: 30000 });
                stdout = res.stdout;
                stderr = res.stderr;
            } else {
                const options: any = {};
                if (config.workingDirectory) {
                    options.cwd = config.workingDirectory;
                }
                const res = await execAsync(command, options);
                stdout = res.stdout;
                stderr = res.stderr;
            }

            if (stderr && stderr.trim().length > 0) {
                console.warn(`[ShellExecutor] Shell stderr: ${stderr}`);
            }

            const telemetry = {
                command_length: command.length,
                stdout_size: stdout.length,
                stderr_size: stderr ? stderr.length : 0,
                has_stderr: !!(stderr && stderr.trim().length > 0)
            };

            return {
                success: true,
                output: stdout.trim(),
                status: "success",
                telemetry
            };
        } catch (error: any) {
            throw new AppError(`Shell execution failed: ${error.message}`, 500, ErrorCode.INTERNAL_ERROR, { details: { originalError: error.message } });
        }
    }
}



