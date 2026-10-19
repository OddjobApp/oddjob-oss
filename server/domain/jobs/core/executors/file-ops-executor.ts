
import { Job, Pipeline, FileOpsConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import fs from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { AppError, ErrorCode } from "@server/utils/errors.js";

export class FileOpsExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "file_ops";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as FileOpsConfig;

        // 1. Safety Check
        const safeRoot = process.cwd();
        const validatePath = (p: string | undefined, allowUnsafe: boolean) => {
            if (!p) return;
            if (allowUnsafe) return;
            const absolutePath = path.resolve(p);
            if (!absolutePath.startsWith(safeRoot)) {
                throw new AppError(
                    `Path '${p}' is outside the safe root directory. Enable 'allowUnsafePaths' to bypass.`,
                    403,
                    ErrorCode.VALIDATION_FAILED
                );
            }
        };

        validatePath(config.sourcePath, config.allowUnsafePaths);
        validatePath(config.destinationPath, config.allowUnsafePaths);
        if (config.preChecks) {
            config.preChecks.forEach(c => validatePath(c.path, config.allowUnsafePaths));
        }
        if (config.postChecks) {
            config.postChecks.forEach(c => validatePath(c.path, config.allowUnsafePaths));
        }

        // 2. Pre-Checks
        if (config.preChecks && config.preChecks.length > 0) {
            await this.runChecks(config.preChecks, config.sourcePath);
        }

        // 3. Operation
        let output: any = { message: "Operation completed" };
        const src = path.resolve(config.sourcePath);
        const dest = config.destinationPath ? path.resolve(config.destinationPath) : undefined;

        try {
            switch (config.operation) {
                case "copy":
                    if (!dest) throw new Error("Destination path is required for copy");
                    await fs.cp(src, dest, {
                        recursive: config.recursive,
                        force: config.force,
                        errorOnExist: !config.force
                    });
                    output = { message: `Copied ${src} to ${dest}` };
                    break;

                case "move":
                    if (!dest) throw new Error("Destination path is required for move");
                    // fs.rename handles moves, but requires parent dir to exist.
                    // We might want to ensure dest dir exists if recursive is true? 
                    // Standard 'mv' doesn't auto-create parents usually, but let's be strict.
                    await fs.rename(src, dest);
                    output = { message: `Moved ${src} to ${dest}` };
                    break;

                case "delete":
                    await fs.rm(src, {
                        recursive: config.recursive,
                        force: config.force
                    });
                    output = { message: `Deleted ${src}` };
                    break;

                case "create_dir":
                    await fs.mkdir(src, { recursive: config.recursive });
                    output = { message: `Created directory ${src}` };
                    break;

                case "list":
                    const files = await fs.readdir(src);
                    output = { files, count: files.length, path: src };
                    break;

                case "get_metadata":
                    const stat = await fs.stat(src);
                    output = {
                        path: src,
                        size: stat.size,
                        isFile: stat.isFile(),
                        isDirectory: stat.isDirectory(),
                        created: stat.birthtime,
                        modified: stat.mtime
                    };
                    break;

                case "calculate_checksum":
                    // Default to sha256 if not specified in check, but operation technically doesn't have algorithm field in schema yet.
                    // We should probably rely on a convention or check field, but simpler to just do sha256 or read file.
                    // The schema for config doesn't have 'algorithm'. Let's default to sha256 or check if we can add it.
                    // Since I didn't add 'algorithm' to fileOpsConfigSchema (only to check schema), I'll hardcode SHA256 for the main operation 
                    // OR I should update schema to have 'algorithm' at top level. 
                    // For now, let's output both MD5 and SHA256 to be helpful.
                    const content = await fs.readFile(src);
                    const md5 = createHash('md5').update(content).digest('hex');
                    const sha256 = createHash('sha256').update(content).digest('hex');
                    output = { path: src, md5, sha256 };
                    break;
            }
        } catch (err: any) {
            throw new AppError(
                `File Operation '${config.operation}' failed: ${err.message}`,
                500,
                ErrorCode.INTERNAL_ERROR,
                { details: err }
            );
        }

        // 4. Post-Checks
        if (config.postChecks && config.postChecks.length > 0) {
            await this.runChecks(config.postChecks, config.sourcePath);
        }

        return {
            success: true,
            status: "success",
            output
        };
    }

    private async runChecks(checks: NonNullable<FileOpsConfig['preChecks']>, defaultPath: string) {
        for (const check of checks) {
            const checkPath = check.path ? path.resolve(check.path) : path.resolve(defaultPath);
            try {
                // For checks like "does_not_exist", checkExists returning false is GOOD.
                // For "exists", checkExists returning false is BAD.

                let stat;
                try {
                    stat = await fs.stat(checkPath);
                } catch {
                    stat = null;
                }

                switch (check.type) {
                    case "exists":
                        if (!stat) throw new Error(`Path '${checkPath}' does not exist.`);
                        break;
                    case "does_not_exist":
                        if (stat) throw new Error(`Path '${checkPath}' exists but should not.`);
                        break;
                    case "is_file":
                        if (!stat || !stat.isFile()) throw new Error(`Path '${checkPath}' is not a file.`);
                        break;
                    case "is_directory":
                        if (!stat || !stat.isDirectory()) throw new Error(`Path '${checkPath}' is not a directory.`);
                        break;
                    case "size_gt":
                        if (!stat) throw new Error(`Path '${checkPath}' not found for size check.`);
                        if (stat.size <= Number(check.value)) throw new Error(`File size ${stat.size} is not greater than ${check.value}.`);
                        break;
                    case "size_lt":
                        if (!stat) throw new Error(`Path '${checkPath}' not found for size check.`);
                        if (stat.size >= Number(check.value)) throw new Error(`File size ${stat.size} is not less than ${check.value}.`);
                        break;
                    case "extension_is":
                        if (path.extname(checkPath) !== check.value) throw new Error(`Extension '${path.extname(checkPath)}' does not match '${check.value}'.`);
                        break;
                    case "checksum_equals":
                        if (!stat) throw new Error(`Path '${checkPath}' not found for checksum.`);
                        if (!stat.isFile()) throw new Error(`Path '${checkPath}' is not a file, cannot verify checksum.`);
                        const fileBuffer = await fs.readFile(checkPath);
                        const algo = check.algorithm || 'sha256';
                        const hash = createHash(algo).update(fileBuffer).digest('hex');
                        if (hash !== check.value) {
                            throw new Error(`${algo.toUpperCase()} checksum mismatch. Expected ${check.value}, got ${hash}`);
                        }
                        break;
                }
            } catch (err: any) {
                // Re-throw as validation error to stop execution
                throw new AppError(
                    `Check Failed: ${err.message}`,
                    400,
                    ErrorCode.VALIDATION_FAILED
                );
            }
        }
    }
}


