import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@server/database_service.js";
import { transferenceRules, aiExecutionLogs } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "../../core/infrastructure/event-stream.service.js";

const execAsync = promisify(exec);
const logger = createLogger("TransferenceRouter");

export interface FidelityResult {
    isMatch: boolean;
    score: number;
}

export interface DriftMetrics {
    accuracy: number;
    driftDetected: boolean;
    shouldPromote: boolean;
    shouldDemote: boolean;
}

/**
 * Evaluates semantic fidelity between a distilled model prediction and ground truth LLM output.
 */
export function evaluateFidelity(prediction: string, groundTruth: string): FidelityResult {
    if (!prediction || !groundTruth) {
        return { isMatch: false, score: 0 };
    }
    const cleanPred = prediction.trim().toLowerCase();
    const cleanTruth = groundTruth.trim().toLowerCase();

    if (cleanPred === cleanTruth) {
        return { isMatch: true, score: 1.0 };
    }

    // Try parsing as JSON to compare structurally
    try {
        const predObj = JSON.parse(cleanPred);
        const truthObj = JSON.parse(cleanTruth);
        if (JSON.stringify(predObj) === JSON.stringify(truthObj)) {
            return { isMatch: true, score: 1.0 };
        }
    } catch {
        // Fall back to token overlap
    }

    // Substring containment or partial match
    if (cleanTruth.includes(cleanPred) || cleanPred.includes(cleanTruth)) {
        return { isMatch: true, score: 0.95 };
    }

    return { isMatch: false, score: 0.0 };
}

/**
 * Computes statistical drift and promotion/demotion gates for transference candidates.
 */
export function computeDriftMetrics(totalShadow: number, mismatchCount: number): DriftMetrics {
    if (totalShadow <= 0) {
        return { accuracy: 0, driftDetected: false, shouldPromote: false, shouldDemote: false };
    }
    const accuracy = Math.round(((totalShadow - mismatchCount) / totalShadow) * 100);
    const shouldPromote = totalShadow >= 500 && accuracy >= 98;
    const shouldDemote = totalShadow >= 50 && accuracy < 90;
    const driftDetected = accuracy < 95;

    return {
        accuracy,
        driftDetected,
        shouldPromote,
        shouldDemote,
    };
}

export class TransferenceRouter {
    /**
     * Executes local Python model or remote SLM endpoint
     */
    static async executeTargetModel(
        handlerOrEndpoint: string,
        inputJson: string
    ): Promise<{ prediction: string; confidence?: number }> {
        if (handlerOrEndpoint.startsWith("http://") || handlerOrEndpoint.startsWith("https://")) {
            const resp = await fetch(handlerOrEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: inputJson,
            });
            if (!resp.ok) {
                throw new Error(`SLM endpoint returned HTTP ${resp.status}`);
            }
            const data: any = await resp.json();
            return {
                prediction: data.prediction ?? data.response ?? data.output ?? JSON.stringify(data),
                confidence: typeof data.confidence === "number" ? data.confidence : 1.0,
            };
        }

        const { stdout } = await execAsync(`python "${handlerOrEndpoint}"`, {
            env: { ...process.env },
            input: inputJson,
        } as any);

        const result = JSON.parse(stdout.toString());
        return {
            prediction: result.prediction,
            confidence: result.confidence,
        };
    }

    /**
     * Intercepts LLM calls and executes local Python models or SLM endpoints if a rule is active
     */
    static async routeCall(
        promptHash: string, 
        inputVariables: Record<string, any>
    ): Promise<{ output: string; confidence?: number } | null> {
        try {
            const [rule] = await db.select()
                .from(transferenceRules)
                .where(eq(transferenceRules.promptHash, promptHash))
                .limit(1);

            if (!rule || rule.mode === "disabled") {
                return null;
            }

            const inputJson = JSON.stringify(inputVariables);
            const result = await this.executeTargetModel(rule.handlerPath, inputJson);
            
            if (rule.mode === "active") {
                if (result.confidence !== undefined && result.confidence < 0.90) {
                    logger.info(`[Transference Router] Low confidence fallback for ${promptHash}`);
                    return null;
                }
                return { output: result.prediction, confidence: result.confidence };
            }
            
            if (rule.mode === "shadow") {
                logger.debug(`[Transference Router] Shadow run logged for ${promptHash}`);
            }
        } catch (err) {
            logger.warn(`[Transference Router] Execution skipped: ${err}`);
        }

        return null;
    }

    /**
     * Executes the shadow verification check asynchronously based on prompt hash.
     * Compares model prediction with the ground truth LLM output.
     */
    static async trackShadowAccuracyForHash(
        promptHash: string,
        llmOutput: string,
        inputVariables: Record<string, any>
    ): Promise<void> {
        try {
            const [rule] = await db.select()
                .from(transferenceRules)
                .where(eq(transferenceRules.promptHash, promptHash))
                .limit(1);

            if (!rule || rule.mode !== "shadow") return;

            const inputJson = JSON.stringify(inputVariables);
            const result = await this.executeTargetModel(rule.handlerPath, inputJson);
            const fidelity = evaluateFidelity(result.prediction, llmOutput);

            const totalShadow = rule.totalShadowCount + 1;
            const mismatch = rule.mismatchCount + (fidelity.isMatch ? 0 : 1);
            const metrics = computeDriftMetrics(totalShadow, mismatch);

            const mode = metrics.shouldPromote ? "active" : metrics.shouldDemote ? "disabled" : "shadow";

            await db.update(transferenceRules)
                .set({
                    totalShadowCount: totalShadow,
                    mismatchCount: mismatch,
                    accuracyScore: metrics.accuracy,
                    mode,
                    updatedAt: new Date()
                })
                .where(eq(transferenceRules.id, rule.id));

            if (metrics.shouldPromote) {
                logger.info(`[Transference Engine] Rule ${rule.id} (${promptHash}) promoted to ACTIVE (Accuracy: ${metrics.accuracy}%). Initiating SLM Adapter Distillation...`);
                try {
                    const { slmAdapterDistillerService } = await import("./slm-adapter-distiller.service.js");
                    await slmAdapterDistillerService.distillAdapterForPromptHash(promptHash);
                } catch (distillErr: any) {
                    logger.warn(`[Transference Engine] SLM distillation deferred: ${distillErr.message}`);
                }

                try {
                    await eventStream.publish(
                        "CAPABILITY_TRANSFERRED",
                        {
                            promptHash,
                            ruleId: rule.id,
                            modelPath: rule.modelPath,
                            handlerPath: rule.handlerPath,
                            accuracyScore: metrics.accuracy,
                            totalShadowCount: totalShadow,
                            promotedAt: new Date().toISOString()
                        },
                        { entityId: String(rule.id) },
                        "transference_engine"
                    );
                } catch (evErr: any) {
                    logger.warn(`[Transference Engine] Failed to emit CAPABILITY_TRANSFERRED event: ${evErr.message}`);
                }
            }
        } catch (err: any) {
            logger.warn(`[Transference Router] Shadow tracking skipped: ${err.message}`);
        }
    }

    /**
     * Mines execution logs to identify prompt templates with high frequency and low entropy.
     * Registers new candidates in transference_rules table under shadow mode.
     */
    static async mineTransferenceCandidates(): Promise<void> {
        try {
            const { aiExecutionLogs } = await import("@shared/schema/index.js");
            const { sql } = await import("drizzle-orm");

            // For prototyping: identify templates with >= 100 calls in logs
            const stats = await db.select({
                promptHash: aiExecutionLogs.promptHash,
                systemPrompt: aiExecutionLogs.systemPrompt,
                totalCalls: sql<number>`COUNT(*)::int`,
                uniqueOutputs: sql<number>`COUNT(DISTINCT raw_output)::int`
            })
            .from(aiExecutionLogs)
            .groupBy(aiExecutionLogs.promptHash, aiExecutionLogs.systemPrompt)
            .having(sql`COUNT(*) >= 100`);

            logger.info(`[Transference Miner] Found ${stats.length} high-frequency templates to analyze`);

            for (const row of stats) {
                const recentOutputs = await db.select({ rawOutput: aiExecutionLogs.rawOutput })
                    .from(aiExecutionLogs)
                    .where(eq(aiExecutionLogs.promptHash, row.promptHash))
                    .limit(500);

                const outputs = recentOutputs.map(o => o.rawOutput);
                const entropy = this.calculateShannonEntropy(outputs);

                logger.debug(`[Transference Miner] Template ${row.promptHash} entropy: ${entropy.toFixed(2)}`);

                if (entropy < 1.8) {
                    const [existing] = await db.select()
                        .from(transferenceRules)
                        .where(eq(transferenceRules.promptHash, row.promptHash))
                        .limit(1);

                    if (!existing) {
                        const mockHandlerPath = `server/config/transference/handlers/${row.promptHash}_handler.py`;
                        
                        await db.insert(transferenceRules).values({
                            promptHash: row.promptHash,
                            systemPrompt: row.systemPrompt,
                            mode: "shadow",
                            tier: 2,
                            handlerPath: mockHandlerPath,
                            accuracyScore: 0,
                            totalShadowCount: 0,
                            mismatchCount: 0
                        });
                        logger.info(`[Transference Miner] Registered new shadow classifier candidate: ${row.promptHash}`);
                    }
                }
            }
        } catch (err: any) {
            logger.error(`[Transference Miner] Analysis failed: ${err.message}`);
        }
    }

    private static calculateShannonEntropy(outputs: string[]): number {
        const counts = new Map<string, number>();
        for (const out of outputs) {
            counts.set(out, (counts.get(out) || 0) + 1);
        }
        
        let entropy = 0;
        const total = outputs.length;
        for (const count of counts.values()) {
            const p = count / total;
            entropy -= p * Math.log2(p);
        }
        return entropy;
    }
}
