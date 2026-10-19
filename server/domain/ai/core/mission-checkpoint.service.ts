import { createLogger } from "@server/utils/logger.js";
import { redisService } from "@domain/core/infrastructure/redis/redis-client.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("MissionCheckpointService");

export type CheckpointStatus =
    | "in_progress"
    | "verified"
    | "failed"
    | "circuit_breaker_tripped"
    | "rolled_back"
    /**
     * Halted deliberately rather than by failure — the budget governor stopping
     * a mission that has spent its allowance. Distinct from "failed", because a
     * paused mission is resumable and its last checkpoint is still valid; the
     * worker already writes this state and broadcasts it as "budget_paused".
     */
    | "paused";

export interface MissionCheckpoint {
    checkpointId: string;
    sessionId: string;
    missionId?: string | number;
    agentId: number;
    stepId: string;
    stepIndex: number;
    totalSteps: number;
    status: CheckpointStatus;
    workingMemorySnapshot: Record<string, any>;
    completedStepIds: string[];
    consecutiveFailures: number;
    traceId?: string;
    timestamp: string;
}

export interface StepOutcomeParams {
    sessionId: string;
    missionId?: string | number;
    agentId: number;
    stepId: string;
    stepIndex: number;
    totalSteps: number;
    success: boolean;
    memorySnapshot?: Record<string, any>;
    traceId?: string;
}

export interface StepOutcomeResult {
    checkpoint: MissionCheckpoint;
    circuitBreakerTripped: boolean;
    reason?: string;
}

export interface ResumePlanResult<T extends { id: string }> {
    canResume: boolean;
    latestCheckpoint: MissionCheckpoint | null;
    pendingSteps: T[];
    completedStepIds: string[];
}

const REDIS_KEY_PREFIX = "oddjob:ai:checkpoints:";
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export class MissionCheckpointService {
    private static instance: MissionCheckpointService;
    private memoryStore = new Map<string, MissionCheckpoint[]>();

    public static getInstance(): MissionCheckpointService {
        if (!MissionCheckpointService.instance) {
            MissionCheckpointService.instance = new MissionCheckpointService();
        }
        return MissionCheckpointService.instance;
    }

    private constructor() {}

    /**
     * Retrieves all checkpoints for a session, ordered from earliest to latest.
     */
    public getCheckpoints(sessionId: string): MissionCheckpoint[] {
        return this.memoryStore.get(sessionId) ?? [];
    }

    /**
     * Retrieves the latest checkpoint recorded for a session.
     */
    public getLatestCheckpoint(sessionId: string): MissionCheckpoint | null {
        const checkpoints = this.getCheckpoints(sessionId);
        return checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
    }

    /**
     * Saves a checkpoint to the in-memory cache and asynchronously persists to Redis.
     */
    public async saveCheckpoint(checkpoint: MissionCheckpoint): Promise<MissionCheckpoint> {
        let sessionCheckpoints = this.memoryStore.get(checkpoint.sessionId);
        if (!sessionCheckpoints) {
            sessionCheckpoints = [];
            this.memoryStore.set(checkpoint.sessionId, sessionCheckpoints);
        }

        sessionCheckpoints.push(checkpoint);

        // Asynchronous persistence to Redis with 7-day TTL
        this.persistToRedis(checkpoint.sessionId, sessionCheckpoints).catch((err) => {
            logger.debug(`Redis checkpoint persist failed for session ${checkpoint.sessionId}: ${err.message}`);
        });

        logger.debug(
            `[MissionCheckpointService] Checkpoint ${checkpoint.checkpointId} saved: step='${checkpoint.stepId}' status='${checkpoint.status}' failures=${checkpoint.consecutiveFailures}`
        );
        return checkpoint;
    }

    /**
     * Records the outcome of a step verification.
     * Evaluates 3-strike circuit breaker and creates a durable checkpoint.
     */
    public recordStepOutcome(params: StepOutcomeParams): StepOutcomeResult {
        const {
            sessionId,
            missionId,
            agentId,
            stepId,
            stepIndex,
            totalSteps,
            success,
            memorySnapshot = {},
            traceId,
        } = params;

        const previousCheckpoint = this.getLatestCheckpoint(sessionId);
        const completedStepIds = new Set<string>(previousCheckpoint?.completedStepIds ?? []);

        let consecutiveFailures = previousCheckpoint?.consecutiveFailures ?? 0;
        let status: CheckpointStatus = "in_progress";
        let circuitBreakerTripped = false;
        let reason: string | undefined;

        if (success) {
            consecutiveFailures = 0;
            status = "verified";
            completedStepIds.add(stepId);
        } else {
            consecutiveFailures += 1;
            status = "failed";

            if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
                status = "circuit_breaker_tripped";
                circuitBreakerTripped = true;
                reason = `Circuit breaker tripped: ${consecutiveFailures} consecutive failures recorded on step '${stepId}'. Execution halted to avoid token burn.`;
                logger.warn(`[MissionCheckpointService] ${reason}`);
            }
        }

        const checkpoint: MissionCheckpoint = {
            checkpointId: uuidv4(),
            sessionId,
            missionId,
            agentId,
            stepId,
            stepIndex,
            totalSteps,
            status,
            workingMemorySnapshot: { ...memorySnapshot },
            completedStepIds: Array.from(completedStepIds),
            consecutiveFailures,
            traceId,
            timestamp: new Date().toISOString(),
        };

        this.saveCheckpoint(checkpoint);

        return {
            checkpoint,
            circuitBreakerTripped,
            reason,
        };
    }

    /**
     * Rolls back to the last known cleanly verified checkpoint.
     */
    public rollbackToLastClean(sessionId: string): { rolledBack: boolean; checkpoint: MissionCheckpoint | null } {
        const checkpoints = this.getCheckpoints(sessionId);
        const lastVerified = [...checkpoints].reverse().find((cp) => cp.status === "verified");

        if (!lastVerified) {
            logger.warn(`[MissionCheckpointService] No verified checkpoint found for rollback in session '${sessionId}'`);
            return { rolledBack: false, checkpoint: null };
        }

        const rollbackCheckpoint: MissionCheckpoint = {
            checkpointId: uuidv4(),
            sessionId,
            missionId: lastVerified.missionId,
            agentId: lastVerified.agentId,
            stepId: lastVerified.stepId,
            stepIndex: lastVerified.stepIndex,
            totalSteps: lastVerified.totalSteps,
            status: "rolled_back",
            workingMemorySnapshot: { ...lastVerified.workingMemorySnapshot },
            completedStepIds: [...lastVerified.completedStepIds],
            consecutiveFailures: 0, // reset failure count on deliberate rollback
            traceId: lastVerified.traceId,
            timestamp: new Date().toISOString(),
        };

        this.saveCheckpoint(rollbackCheckpoint);
        logger.info(`[MissionCheckpointService] Rolled back session '${sessionId}' to verified step '${lastVerified.stepId}'`);

        return { rolledBack: true, checkpoint: rollbackCheckpoint };
    }

    /**
     * Resolves an execution plan for resuming an interrupted manifest.
     * Filters out already verified steps so execution skips directly to pending steps.
     */
    public getResumePlan<T extends { id: string }>(
        sessionId: string,
        manifestSteps: T[]
    ): ResumePlanResult<T> {
        const latestCheckpoint = this.getLatestCheckpoint(sessionId);

        if (!latestCheckpoint || latestCheckpoint.completedStepIds.length === 0) {
            return {
                canResume: false,
                latestCheckpoint: null,
                pendingSteps: manifestSteps,
                completedStepIds: [],
            };
        }

        const verifiedSet = new Set(latestCheckpoint.completedStepIds);
        const pendingSteps = manifestSteps.filter((s) => !verifiedSet.has(s.id));

        return {
            canResume: true,
            latestCheckpoint,
            pendingSteps,
            completedStepIds: latestCheckpoint.completedStepIds,
        };
    }

    /**
     * Asynchronously loads checkpoints from Redis if not present in memory.
     */
    public async hydrateFromRedis(sessionId: string): Promise<boolean> {
        if (this.memoryStore.has(sessionId)) return true;

        try {
            const client = redisService.client;
            if (client && client.status === "ready") {
                const data = await client.get(`${REDIS_KEY_PREFIX}${sessionId}`);
                if (data) {
                    const parsed = JSON.parse(data) as MissionCheckpoint[];
                    this.memoryStore.set(sessionId, parsed);
                    return true;
                }
            }
        } catch (err: any) {
            logger.debug(`Redis checkpoint hydration failed for session ${sessionId}: ${err.message}`);
        }
        return false;
    }

    private async persistToRedis(sessionId: string, checkpoints: MissionCheckpoint[]): Promise<void> {
        try {
            const client = redisService.client;
            if (client && client.status === "ready") {
                await client.set(`${REDIS_KEY_PREFIX}${sessionId}`, JSON.stringify(checkpoints), "EX", 86400 * 7);
            }
        } catch {
            // Keep running in-memory
        }
    }

    /**
     * Clears checkpoints for a completed session.
     */
    public clearCheckpoints(sessionId: string): void {
        this.memoryStore.delete(sessionId);
        try {
            const client = redisService.client;
            if (client && client.status === "ready") {
                client.del(`${REDIS_KEY_PREFIX}${sessionId}`).catch(() => {});
            }
        } catch {
            // Ignore
        }
    }

    /**
     * Resets service state for tests.
     */
    public reset(): void {
        this.memoryStore.clear();
    }
}

export const missionCheckpointService = MissionCheckpointService.getInstance();
