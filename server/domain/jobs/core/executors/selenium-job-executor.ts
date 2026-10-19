// @ts-nocheck

import path from 'path';
import { Job, Pipeline, SeleniumConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { JobExecutionError } from "@server/utils/errors.js";
import datasetService from "@domain/knowledge/core/dataset-service.js";
import type { OrgContext } from "../../job.service.js";
import { queueService } from "@domain/core/infrastructure/queue/queue-service.js";

export class SeleniumJobExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "selenium";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as SeleniumConfig;

        console.log(`[SeleniumJobExecutor] Queueing Selenium job (mode: ${config.mode}, steps: ${config.steps?.length || 0})`);

        let result;

        if (config.mode === "auto_pilot") {
            console.log(`[SeleniumJobExecutor] Running Auto-Pilot for URL: ${config.startUrl}`);
            const orgContext: OrgContext = {
                organizationId: job.organizationId || null,
                userId: job.createdBy
            };
            const datasetId = (config as any).datasetId;
            const { seleniumAgentService } = await import("@domain/agents/core/selenium-agent.service.js");

            const steps = await seleniumAgentService.runAutoPilot(
                config.startUrl!,
                config.goal || "Explore and extract knowledge",
                orgContext,
                datasetId
            );

            // Collect any extracted snapshots from the steps
            const extracted: Record<string, any> = {};
            steps.forEach((s: any, idx) => {
                if (s.action === 'extract_knowledge' && s.updates) {
                    Object.assign(extracted, s.updates);
                }
            });

            result = {
                success: true,
                extracted,
                screenshots: {},
                timing: { totalMs: 0, pageLoads: 1, steps: [] }
            };

            return {
                success: true,
                output: JSON.stringify({ steps, extracted }),
                status: "success",
                telemetry: { selenium_steps: steps.length }
            };
        }

        if (process.env.DISABLE_JOB_QUEUE === 'true') {
            console.log(`[SeleniumJobExecutor] Job queue disabled, running Selenium locally`);
            const { SeleniumRunner } = await import("@domain/mission/selenium/runner.js");
            const runner = new SeleniumRunner();
            result = await runner.execute(config, context);
        } else {
            // Offload to distributed browser worker
            const browserJob = await queueService.browserQueue.add("selenium-execution", {
                config,
                context
            });

            result = await queueService.waitForJob(queueService.browserEvents, browserJob);
        }

        if (!result.success) {
            throw new JobExecutionError(job.id, result.error || "Selenium execution failed", {
                screenshots: result.screenshots,
                timing: result.timing,
                extracted: result.extracted
            });
        }

        // Save to Dataset if configured
        // Cast config to any to avoid stale type errors for datasetId
        const datasetId = (config as any).datasetId;

        if (datasetId && result.extracted) {
            try {
                // Construct OrgContext matching the interface in job-service.ts
                const orgContext: OrgContext = {
                    organizationId: job.organizationId || null,
                    userId: job.createdBy
                };

                const itemsToSave: any[] = [];
                // Execution ID might be attached to context at runtime even if not in the strict interface
                const executionId = (context as any).executionId || undefined;

                // Check if we have array data (from extractAll)
                const arrayData = Object.values(result.extracted).find(val => Array.isArray(val) && val.length > 0 && typeof val[0] === 'object');

                if (Array.isArray(arrayData)) {
                    itemsToSave.push(...(arrayData as any[]).map((row: any) => ({
                        data: row,
                        pipelineExecutionId: executionId,
                        rawData: { source: 'selenium_extraction' }
                    })));
                } else {
                    // Treat strict key-values as one row
                    itemsToSave.push({
                        data: result.extracted,
                        pipelineExecutionId: executionId,
                        rawData: { source: 'selenium_extraction' }
                    });
                }

                if (itemsToSave.length > 0) {
                    await datasetService.addItems(datasetId, itemsToSave, orgContext);
                    console.log(`[SeleniumJobExecutor] Saved ${itemsToSave.length} items to dataset ${datasetId}`);
                }
            } catch (err) {
                console.error("[SeleniumJobExecutor] Failed to save to dataset:", err);
                // We don't fail the job, just log the error
            }
        }

        if ((result.screenshots && config.saveScreenshotsToFile) || (result.extracted && config.saveExtractionsToFile)) {
            try {
                const { fileStorageSuccess } = await import("@domain/knowledge/core/file-storage.js");
                const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); // YYYYMMDDHHMM
                const jobNameSafe = job.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const folderName = `${jobNameSafe}_${timestamp}`;

                const baseDir = config.screenshotDirectory || 'screenshots';
                const orgId = job.organizationId || null;

                // Save screenshots
                if (result.screenshots && config.saveScreenshotsToFile) {
                    for (const [name, base64] of Object.entries(result.screenshots)) {
                        const fileName = `${name}.png`;
                        const filePath = path.join(baseDir, folderName, fileName);
                        const buffer = Buffer.from(base64 as string, 'base64');

                        await fileStorageSuccess.saveFile(orgId, filePath, buffer);
                    }
                }

                // Save extractions
                if (result.extracted && config.saveExtractionsToFile) {
                    const fileName = `extractions.json`;
                    const filePath = path.join(baseDir, folderName, fileName);
                    const content = JSON.stringify(result.extracted, null, 2);
                    await fileStorageSuccess.saveFile(orgId, filePath, content);
                }

                console.log(`[SeleniumJobExecutor] Saved files to ${path.join(baseDir, folderName)}`);
            } catch (err) {
                console.error("[SeleniumJobExecutor] Failed to save output files:", err);
            }
        }

        const telemetry = {
            selenium_steps: config.steps?.length || 0,
            screenshots_count: result.screenshots ? Object.keys(result.screenshots).length : 0,
            extracted_data_keys: Object.keys(result.extracted || {}).length,
            page_title: result.extracted?.title || undefined
        };

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry
        };
    }
}


