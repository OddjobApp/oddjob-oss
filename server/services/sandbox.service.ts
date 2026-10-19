import { execFile, exec } from "child_process";
import { createLogger } from "@server/utils/logger.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SandboxSafety } from "./sandbox-safety.js";

const logger = createLogger("SandboxService");

/**
 * Opt-in escape hatch for local development without Docker. OFF by default:
 * running untrusted / model-generated code unsandboxed on the host is a security
 * risk, so the sandbox fails closed unless an operator explicitly opts in.
 */
const ALLOW_UNSANDBOXED = process.env.SANDBOX_ALLOW_UNSANDBOXED === "true";

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10MB (default execFile buffer is only 1MB)

export interface SandboxOptions {
    timeoutMs?: number;
    memoryLimitMb?: number;
    cpuLimit?: number;
}

interface ExecResult {
    stdout: string;
    stderr: string;
}

export class SandboxService {
    async runPython(scriptContent: string, options: SandboxOptions = {}): Promise<ExecResult> {
        // Pre-flight static AST inspection
        const safety = SandboxSafety.validatePython(scriptContent);
        if (!safety.isSafe) {
            throw new Error(`[SandboxSecurityError] Python execution blocked: ${safety.violations.join("; ")}`);
        }

        const timeout = options.timeoutMs ?? 30000;
        const memory = options.memoryLimitMb ?? 128;
        const cpu = options.cpuLimit ?? 0.5;

        const tempDir = os.tmpdir();
        const fileName = `sandbox-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.py`;
        const tempFilePath = path.join(tempDir, fileName);

        await fs.writeFile(tempFilePath, scriptContent);

        try {
            if (await this.isDockerAvailable()) {
                logger.info(`Running Python script in Docker container sandbox: ${fileName}`);
                const mountPath = tempDir.replace(/\\/g, "/");
                // argv array — nothing is interpolated into a shell command string, so
                // there is no host-side shell to inject into. Values with special chars
                // are passed verbatim as individual arguments to the docker CLI.
                return await this.execFileAsync("docker", [
                    "run", "--rm", "--network", "none",
                    `--memory=${memory}m`, `--cpus=${cpu}`,
                    "-v", `${mountPath}:/app`, "-w", "/app",
                    "python:3.10-slim", "python", `/app/${fileName}`,
                ], timeout);
            }

            if (!ALLOW_UNSANDBOXED) {
                throw new Error(
                    "Docker is not available and SANDBOX_ALLOW_UNSANDBOXED is not set — refusing to execute Python unsandboxed on the host."
                );
            }
            logger.warn("Docker not available and SANDBOX_ALLOW_UNSANDBOXED=true — running Python UNISOLATED on the host.");
            return await this.execFileAsync("python3", [tempFilePath], timeout);
        } finally {
            try {
                await fs.unlink(tempFilePath);
            } catch (err: any) {
                logger.warn(`Failed to cleanup temp script file ${tempFilePath}: ${err.message}`);
            }
        }
    }

    async runShell(command: string, options: SandboxOptions = {}): Promise<ExecResult> {
        // Pre-flight static shell inspection
        const safety = SandboxSafety.validateShell(command);
        if (!safety.isSafe) {
            throw new Error(`[SandboxSecurityError] Shell execution blocked: ${safety.violations.join("; ")}`);
        }

        const timeout = options.timeoutMs ?? 30000;
        const memory = options.memoryLimitMb ?? 128;
        const cpu = options.cpuLimit ?? 0.5;

        if (await this.isDockerAvailable()) {
            logger.info("Running shell command in Docker container sandbox");
            // `command` is handed to `sh -c` INSIDE the container as a single argv
            // element. The host shell is never invoked, so host-side command injection
            // is impossible; any shell interpretation happens in the disposable,
            // network-isolated container.
            return await this.execFileAsync("docker", [
                "run", "--rm", "--network", "none",
                `--memory=${memory}m`, `--cpus=${cpu}`,
                "debian:stable-slim", "sh", "-c", command,
            ], timeout);
        }

        if (!ALLOW_UNSANDBOXED) {
            throw new Error(
                "Docker is not available and SANDBOX_ALLOW_UNSANDBOXED is not set — refusing to execute shell command unsandboxed on the host."
            );
        }
        logger.warn("Docker not available and SANDBOX_ALLOW_UNSANDBOXED=true — running shell command UNISOLATED on the host.");
        // Explicit opt-in only: the caller asked to run a shell command, so a shell is
        // expected here. Uses the OS default shell via exec (no nested string building).
        return await this.execAsync(command, timeout);
    }

    private async isDockerAvailable(): Promise<boolean> {
        try {
            await this.execFileAsync("docker", ["ps"], 3000);
            return true;
        } catch {
            return false;
        }
    }

    /** Run an executable with an argv array — never spawns a shell, so args cannot inject. */
    private execFileAsync(file: string, args: string[], timeoutMs: number): Promise<ExecResult> {
        return new Promise((resolve, reject) => {
            execFile(
                file,
                args,
                { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: MAX_OUTPUT_BYTES },
                (error, stdout, stderr) => {
                    if (error) {
                        if ((error as any).killed) {
                            return reject(new Error(`Execution timed out after ${timeoutMs}ms`));
                        }
                        return reject(error);
                    }
                    resolve({ stdout, stderr });
                }
            );
        });
    }

    /** Opt-in unisolated shell fallback only. */
    private execAsync(command: string, timeoutMs: number): Promise<ExecResult> {
        return new Promise((resolve, reject) => {
            exec(
                command,
                { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: MAX_OUTPUT_BYTES },
                (error, stdout, stderr) => {
                    if (error) {
                        if ((error as any).killed) {
                            return reject(new Error(`Execution timed out after ${timeoutMs}ms`));
                        }
                        return reject(error);
                    }
                    resolve({ stdout, stderr });
                }
            );
        });
    }
}

export const sandboxService = new SandboxService();
