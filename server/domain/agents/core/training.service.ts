import { createLogger } from "../../../utils/logger.js";
import { db } from "../../../database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fineTuningDatasets, fineTuningExamples, fineTuningPreferences } from "@shared/schema/training.js";

const logger = createLogger("StudentTrainingService");

export class StudentTrainingService {
    private readonly MIN_SAMPLES_FOR_TRAINING = 10; // set low for demo purposes

    /**
     * Periodically check all datasets and trigger fine-tuning if critical mass is reached.
     * Jobs run one at a time to avoid spawning N Python processes simultaneously.
     */
    async evaluateTrainingNeeds() {
        try {
            // 1. Evaluate SFT training needs
            const sftDatasets = await db.select({
                datasetId: fineTuningExamples.datasetId,
                agentId: fineTuningExamples.sourceJobId,
                count: sql<number>`count(*)`.mapWith(Number)
            })
            .from(fineTuningExamples)
            .groupBy(fineTuningExamples.datasetId, fineTuningExamples.sourceJobId);

            for (const ds of sftDatasets) {
                if (ds.agentId && ds.count >= this.MIN_SAMPLES_FOR_TRAINING) {
                    logger.info(`[StudentTraining] Dataset ${ds.datasetId} for Agent ${ds.agentId} has ${ds.count} SFT samples. Reached critical mass.`);
                    const examples = await db.select().from(fineTuningExamples).where(eq(fineTuningExamples.datasetId, ds.datasetId!));
                    // Sequential: await each job before starting the next to cap subprocess count at 1
                    await this.triggerTrainingJob(ds.agentId, examples, false);
                }
            }

            // 2. Evaluate DPO training needs
            const dpoDatasets = await db.select({
                datasetId: fineTuningPreferences.datasetId,
                agentId: fineTuningPreferences.sourceJobId,
                count: sql<number>`count(*)`.mapWith(Number)
            })
            .from(fineTuningPreferences)
            .groupBy(fineTuningPreferences.datasetId, fineTuningPreferences.sourceJobId);

            for (const ds of dpoDatasets) {
                if (ds.agentId && ds.count >= this.MIN_SAMPLES_FOR_TRAINING) {
                    logger.info(`[StudentTraining] Dataset ${ds.datasetId} for Agent ${ds.agentId} has ${ds.count} DPO samples. Reached critical mass.`);
                    const preferences = await db.select().from(fineTuningPreferences).where(eq(fineTuningPreferences.datasetId, ds.datasetId!));
                    await this.triggerTrainingJob(ds.agentId, preferences, true);
                }
            }
        } catch (err: any) {
            logger.error(`[StudentTraining] Error evaluating training needs: ${err.message}`);
        }
    }

    /**
     * Manually trigger training for a specific agent and type
     */
    async triggerManualTraining(agentId: number, isDpo: boolean) {
        logger.info(`[StudentTraining] Manual training trigger received for Agent ${agentId} (DPO=${isDpo})`);
        
        // Find dataset for the agent
        const datasetName = `Agent ${agentId} Specialized Dataset`;
        const [dataset] = await db.select().from(fineTuningDatasets).where(eq(fineTuningDatasets.name, datasetName)).limit(1);
        
        if (!dataset) {
            throw new Error(`Dataset not found for Agent ${agentId}`);
        }

        if (isDpo) {
            const preferences = await db.select().from(fineTuningPreferences).where(eq(fineTuningPreferences.datasetId, dataset.id));
            if (preferences.length === 0) {
                throw new Error(`No DPO examples found for Agent ${agentId}`);
            }
            await this.triggerTrainingJob(agentId, preferences, true);
        } else {
            const examples = await db.select().from(fineTuningExamples).where(eq(fineTuningExamples.datasetId, dataset.id));
            if (examples.length === 0) {
                throw new Error(`No SFT examples found for Agent ${agentId}`);
            }
            await this.triggerTrainingJob(agentId, examples, false);
        }
    }

    /**
     * Export data to a temp file and trigger the Python Unsloth worker
     */
    private async triggerTrainingJob(agentId: number, examples: any[], isDpo: boolean) {
        logger.info(`[StudentTraining] Queuing LoRA ${isDpo ? 'DPO' : 'SFT'} fine-tuning for agent ${agentId} with ${examples.length} samples.`);
        
        try {
            // 1. Export to temp JSONL
            const tempDir = path.join(process.cwd(), 'temp_training');
            await fs.mkdir(tempDir, { recursive: true });
            const datasetPath = path.join(tempDir, `agent_${agentId}_${isDpo ? 'dpo' : 'sft'}_dataset_${Date.now()}.jsonl`);
            
            let lines = "";
            for (const ex of examples) {
                if (isDpo) {
                    lines += JSON.stringify({ prompt: ex.prompt, chosen: ex.chosenResponse, rejected: ex.rejectedResponse }) + "\n";
                } else {
                    lines += JSON.stringify({ input: ex.input, output: ex.output }) + "\n";
                }
            }
            await fs.writeFile(datasetPath, lines);

            // 2. Spawn Python Worker
            const suffix = isDpo ? '_dpo' : '_sft';
            const outputDir = path.join(process.cwd(), 'adapters', `agent_${agentId}${suffix}_v1`);
            const scriptPath = path.join(process.cwd(), 'server', 'domain', 'python', 'train_worker.py');
            
            logger.info(`[StudentTraining] Spawning Python worker: ${scriptPath}`);
            const args = [
                scriptPath,
                '--dataset', datasetPath,
                '--base_model', 'unsloth/llama-3-8b-bnb-4bit',
                '--output_dir', outputDir,
                '--max_steps', '60'
            ];
            
            if (isDpo) {
                args.push('--dpo');
            }

            const pythonProcess = spawn('python', args);

            pythonProcess.stdout.on('data', (data) => {
                logger.info(`[UnslothWorker] ${data.toString().trim()}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                logger.error(`[UnslothWorker] ${data.toString().trim()}`);
            });

            pythonProcess.on('close', async (code) => {
                logger.info(`[StudentTraining] Python worker exited with code ${code}`);

                // Always clean up the temp dataset file regardless of exit code
                fs.unlink(datasetPath).catch(() => {});

                if (code === 0) {
                    // 3. Update the agent's config to point to the new LoRA adapter
                    const [agent] = await db.select().from(jobs).where(eq(jobs.id, agentId)).limit(1);
                    if (agent) {
                        const currentConfig = (agent.config as any) || {};
                        currentConfig.studentModel = {
                            baseModel: 'llama-3-8b',
                            adapterPath: outputDir,
                            trainedAt: new Date().toISOString(),
                            sampleCount: examples.length,
                            type: isDpo ? 'dpo' : 'sft'
                        };

                        await db.update(jobs)
                            .set({ config: currentConfig })
                            .where(eq(jobs.id, agentId));

                        logger.info(`[StudentTraining] Agent ${agentId} updated with new student model config.`);
                    }
                }
            });

        } catch (err: any) {
            logger.error(`[StudentTraining] Failed to trigger Python worker: ${err.message}`);
        }
    }

    /**
     * Get routing statistics and recent timeline telemetry.
     */
    async getRoutingStats() {
        const { routingTelemetry } = await import("@shared/schema/training.js");
        const { desc } = await import("drizzle-orm");

        const [statsResult] = await db.select({
            totalCount: sql<number>`COUNT(*)`.mapWith(Number),
            studentCount: sql<number>`SUM(CASE WHEN ${routingTelemetry.routingDecision} = 'student' THEN 1 ELSE 0 END)`.mapWith(Number),
            teacherCount: sql<number>`SUM(CASE WHEN ${routingTelemetry.routingDecision} = 'teacher' THEN 1 ELSE 0 END)`.mapWith(Number),
            avgEntropy: sql<number>`COALESCE(AVG(${routingTelemetry.entropy}), 0)`.mapWith(Number),
            totalSavings: sql<number>`COALESCE(SUM(${routingTelemetry.costSavings}), 0)`.mapWith(Number)
        }).from(routingTelemetry);

        const recentTimeline = await db.select()
            .from(routingTelemetry)
            .orderBy(desc(routingTelemetry.createdAt))
            .limit(30);

        return {
            stats: {
                totalCount: statsResult?.totalCount || 0,
                studentCount: statsResult?.studentCount || 0,
                teacherCount: statsResult?.teacherCount || 0,
                avgEntropy: statsResult?.avgEntropy || 0,
                totalSavings: statsResult?.totalSavings || 0
            },
            timeline: recentTimeline
        };
    }

    /**
     * Get summary of fine-tuning datasets.
     */
    async getDatasetsSummary() {
        return await db.select({
            id: fineTuningDatasets.id,
            name: fineTuningDatasets.name,
            description: fineTuningDatasets.description,
            organizationId: fineTuningDatasets.organizationId,
            createdAt: fineTuningDatasets.createdAt,
            updatedAt: fineTuningDatasets.updatedAt,
            sftCount: sql<number>`(SELECT COUNT(*) FROM ${fineTuningExamples} WHERE ${fineTuningExamples.datasetId} = ${fineTuningDatasets.id})`.mapWith(Number),
            dpoCount: sql<number>`(SELECT COUNT(*) FROM ${fineTuningPreferences} WHERE ${fineTuningPreferences.datasetId} = ${fineTuningDatasets.id})`.mapWith(Number),
        }).from(fineTuningDatasets);
    }
}

export const studentTrainingService = new StudentTrainingService();
