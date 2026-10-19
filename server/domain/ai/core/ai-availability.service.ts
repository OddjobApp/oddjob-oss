/**
 * AI Availability — the signal that puts agents into limp mode.
 *
 * Nothing in the platform previously asked "is the model layer actually
 * usable right now?". Callers just called, and under a provider outage the
 * failover chain absorbed the failure by degrading to progressively slower
 * backends (cloud -> Qwen -> local Ollama -> MockAIClient), which converts an
 * outage into a multi-minute hang rather than a fast, honest degradation.
 *
 * This service makes availability an explicit, cheap-to-read state so request
 * paths can choose a deterministic route *before* paying that cost.
 *
 * Two independent triggers, because they fail differently:
 *   - Consecutive failures: the provider is erroring. Fast to detect.
 *   - Quota cooldown: AiQuotaManager has already blocked background calls
 *     after a 429. The provider is up but refusing us.
 *
 * Deliberately in-memory for the read path. isDegraded() sits in front of every
 * interactive agent turn; a Redis round-trip there would add latency to exactly
 * the requests we are trying to keep fast. The Redis view is advisory and read
 * opportunistically, so a multi-process fleet converges without blocking.
 */
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AiAvailability");

/** Consecutive failures before we declare the model layer unusable. */
const FAILURE_THRESHOLD = Number(process.env.AI_DEGRADE_FAILURE_THRESHOLD || 3);

/**
 * How long a degraded verdict stands before we retry the real model.
 * Short enough that a brief blip self-heals without operator action.
 */
const DEGRADE_TTL_MS = Number(process.env.AI_DEGRADE_TTL_MS || 60_000);

/**
 * Wall-clock budget for a single interactive agent turn.
 *
 * The model layer's own ceiling is AI_FETCH_TIMEOUT_MS (default 20 minutes,
 * sized for local Ollama) multiplied by up to 20 agent iterations — unbounded
 * from a caller's point of view. Interactive HTTP requests need their own
 * budget, and it has to be well under the client's patience, not the model's.
 */
export const INTERACTIVE_AI_DEADLINE_MS = Number(process.env.AI_INTERACTIVE_DEADLINE_MS || 45_000);

const GLOBAL_AI_BLOCK_KEY = "global:ai:block_until";

interface AvailabilityState {
    consecutiveFailures: number;
    degradedUntil: number;
    lastReason: string | null;
}

const state: AvailabilityState = {
    consecutiveFailures: 0,
    degradedUntil: 0,
    lastReason: null,
};

/** Raised when a turn exceeds INTERACTIVE_AI_DEADLINE_MS. */
export class AIDeadlineExceededError extends Error {
    constructor(ms: number) {
        super(`AI turn exceeded its ${Math.round(ms / 1000)}s interactive deadline`);
        this.name = "AIDeadlineExceededError";
    }
}

/** Raised when a caller asks for the model layer while it is known-degraded. */
export class AIUnavailableError extends Error {
    constructor(reason: string) {
        super(`AI is unavailable: ${reason}`);
        this.name = "AIUnavailableError";
    }
}

export const aiAvailability = {
    /**
     * True when interactive callers should skip the model and serve a
     * deterministic route instead.
     */
    isDegraded(): boolean {
        if (process.env.AI_FORCE_DEGRADED === "true") return true;
        if (state.degradedUntil > Date.now()) return true;
        if (state.degradedUntil !== 0) {
            // The window lapsed — give the real model another chance.
            state.degradedUntil = 0;
            state.consecutiveFailures = 0;
            state.lastReason = null;
            logger.info("[AiAvailability] Degrade window elapsed; retrying live model on next turn.");
        }
        return false;
    },

    /** Why we are degraded, for the notice shown to the user and for telemetry. */
    reason(): string | null {
        if (process.env.AI_FORCE_DEGRADED === "true") return "manually forced into degraded mode";
        return state.degradedUntil > Date.now() ? state.lastReason : null;
    },

    recordSuccess(): void {
        if (state.consecutiveFailures > 0 || state.degradedUntil > 0) {
            logger.info("[AiAvailability] Live model responded; clearing degraded state.");
        }
        state.consecutiveFailures = 0;
        state.degradedUntil = 0;
        state.lastReason = null;
    },

    recordFailure(err: unknown): void {
        state.consecutiveFailures += 1;
        const message = err instanceof Error ? err.message : String(err);

        if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
            state.degradedUntil = Date.now() + DEGRADE_TTL_MS;
            state.lastReason = message.slice(0, 200);
            logger.warn(
                `[AiAvailability] ${state.consecutiveFailures} consecutive AI failures — entering degraded mode for ${Math.round(DEGRADE_TTL_MS / 1000)}s. Last error: ${state.lastReason}`,
            );
        }
    },

    /**
     * Fold in the quota manager's cooldown. Called opportunistically (never on
     * the hot read path) so a 429-driven block propagates across processes.
     */
    async syncFromQuotaManager(): Promise<void> {
        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            const blockUntil = await redis?.get(GLOBAL_AI_BLOCK_KEY);
            if (!blockUntil) return;
            const until = parseInt(blockUntil, 10);
            if (Number.isFinite(until) && until > Date.now()) {
                state.degradedUntil = Math.max(state.degradedUntil, until);
                state.lastReason = state.lastReason || "provider quota cooldown (429)";
            }
        } catch {
            // Redis is optional here — a missing view just means we rely on
            // local failure counting.
        }
    },

    /**
     * Run an AI-backed operation under a hard wall-clock budget, recording the
     * outcome so repeated failures trip the degraded state.
     *
     * The timer does NOT cancel the underlying work — the agent loop has no
     * cancellation token today. It bounds how long the *caller* waits, which is
     * what turns a hang into a degradation. Orphaned work still completes and
     * persists its messages, so nothing is lost.
     */
    async withDeadline<T>(fn: () => Promise<T>, ms: number = INTERACTIVE_AI_DEADLINE_MS): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        try {
            const result = await Promise.race([
                fn(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new AIDeadlineExceededError(ms)), ms);
                }),
            ]);
            this.recordSuccess();
            return result;
        } catch (err) {
            this.recordFailure(err);
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }
    },

    /** Test seam — reset between cases. */
    __reset(): void {
        state.consecutiveFailures = 0;
        state.degradedUntil = 0;
        state.lastReason = null;
    },
};
