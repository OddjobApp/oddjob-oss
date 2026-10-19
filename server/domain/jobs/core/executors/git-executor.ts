import { simpleGit, SimpleGit } from 'simple-git';
import { Job, Pipeline, GitConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { credentialsService } from "../../../auth/core/credentials-service.js";
import fs from 'fs';
import path from 'path';
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export class GitExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "git_op";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as GitConfig;

        // Determine working directory
        // If config.workingDirectory is provided, use it (security risk? assuming internal tool for now)
        // Check if it is absolute.
        let workingDir = "";
        if (config.workingDirectory) {
            workingDir = path.isAbsolute(config.workingDirectory)
                ? config.workingDirectory
                : path.resolve(process.cwd(), config.workingDirectory);
        } else {
            // Default to a workspace for this pipeline/job
            // Use pipeline_id to allow sharing between jobs in same pipeline?
            // Or maybe we want a persistent workspace across pipelines?
            // For now: /workspace/git/pipeline_<id>/repo
            // We don't know repo name easily without parsing URL.
            // Let's use job_id to be safe for now, or user must specify path.
            workingDir = path.resolve(process.cwd(), 'workspace', 'git', `pipeline_${pipeline.id}_job_${job.id}`);
        }

        // Prepare Credentials
        let remoteUrl = config.repoUrl;
        if (config.credentialId) {
            const credential = await credentialsService.getForExecution(config.credentialId, pipeline.organizationId);
            if (credential) {
                const token = (await resolveCredentialSecret(credential));
                if (token) {
                    const metadata = credential.metadata as { username?: string };
                    const username = metadata?.username || 'oauth2';
                    try {
                        const urlObj = new URL(remoteUrl);
                        urlObj.username = encodeURIComponent(username);
                        urlObj.password = encodeURIComponent(token);
                        remoteUrl = urlObj.toString();
                    } catch (e) {
                        throw new Error("Invalid Repo URL for authentication injection");
                    }
                } else {
                    console.warn(`Credential env var ${credential.envVarName} not found`);
                }
            }
        }

        let output = "";

        try {
            if (config.action === 'clone') {
                // Ensure parent dir exists
                const parentDir = path.dirname(workingDir);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }

                // Clone
                // output: 'Cloning into...'
                await simpleGit().clone(remoteUrl, workingDir);
                output = `Cloned ${config.repoUrl} to ${workingDir}`;
            } else {
                // Determine if we need to initialize
                if (!fs.existsSync(workingDir)) {
                    throw new Error(`Working directory ${workingDir} does not exist. Did you run clone first?`);
                }

                const git = simpleGit(workingDir);

                // Configure identity if needed (global or local)
                // Perhaps getting from credential?
                // For now, simpler implementation.

                switch (config.action) {
                    case "pull":
                        await git.pull(remoteUrl);
                        output = `Pulled from ${config.repoUrl}`;
                        break;
                    case "checkout":
                        if (!config.branch) throw new Error("Branch is required for checkout");
                        // Check if local branch exists
                        const isLocal = (await git.branchLocal()).all.includes(config.branch);
                        if (isLocal) {
                            await git.checkout(config.branch);
                        } else {
                            // checkout -b if creating new? Or just checkout remote?
                            // simple-git checkout supports options.
                            await git.checkout(config.branch);
                        }
                        output = `Checked out ${config.branch}`;
                        break;
                    case "create_branch":
                        if (!config.branch) throw new Error("Branch is required for create_branch");
                        await git.checkoutLocalBranch(config.branch);
                        output = `Created and checked out branch ${config.branch}`;
                        break;
                    case "commit":
                        const message = config.commitMessage || "Automated commit from pipeline";
                        if (config.files && config.files.length > 0) {
                            await git.add(config.files);
                        } else {
                            await git.add('.');
                        }
                        await git.commit(message);
                        output = `Committed with message: ${message}`;
                        break;
                    case "push":
                        // push [remote] [branch]
                        // git.push(remote, branch)
                        // defaults to origin and current branch if not specified
                        await git.push(remoteUrl, config.branch);
                        output = `Pushed to ${config.repoUrl}`;
                        break;
                    default:
                        throw new Error(`Unsupported action: ${config.action}`);
                }
            }
        } catch (e: any) {
            console.error("Git execution error:", e);
            return {
                success: false,
                status: 'failure',
                error: e.message || String(e),
                output: output // Return partial output
            };
        }

        return {
            success: true,
            status: 'success',
            output
        };
    }
}


