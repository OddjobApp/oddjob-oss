import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SharedBeliefProtocol");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BeliefAssertion {
    agentId: string;
    nodeId: number;
    assertedState: Record<string, any>;
    confidenceScore: number;           // 0.0–1.0
    evidenceRefs: string[];            // 1–10 references
    organizationId: number;
    topicClusterId: string;
}

export interface ReconciliationResult {
    reconciledState: Record<string, any>;
    winningAgentId: string;
    votingDetails: Array<{ agentId: string; weight: number; vote: string }>;
    timestamp: Date;
}

/**
 * Represents a timestamped belief assertion stored in the conflict window.
 */
interface TimestampedAssertion extends BeliefAssertion {
    receivedAt: Date;
}

/**
 * Tracks deferred reconciliation retry state.
 */
interface DeferredReconciliation {
    nodeId: number;
    organizationId: number;
    topicClusterId: string;
    attempts: number;
    timerId: ReturnType<typeof setTimeout> | null;
}

/**
 * Interface for the Redis pub/sub transport layer.
 * This abstraction allows mocking without a real Redis connection.
 */
export interface IBeliefTransport {
    publish(channel: string, message: string): Promise<void>;
    subscribe(channel: string, handler: (message: string) => void): void;
    unsubscribe(channel: string): void;
}

/**
 * Interface for the temporal version store integration.
 * Allows recording reconciliation results as version records.
 */
export interface ITemporalVersionStore {
    recordNodeVersion(
        nodeId: number,
        previousState: Record<string, any>,
        newState: Record<string, any>,
        actorId: string,
        causalAnnotation?: string,
    ): Promise<void>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Time window (ms) for detecting conflicting assertions on the same node */
const CONFLICT_WINDOW_MS = 30_000;

/** Acknowledgment timeout (ms) before marking agent as "belief-stale" */
const ACK_TIMEOUT_MS = 5_000;

/** Retry interval (ms) for deferred reconciliation */
const DEFERRED_RETRY_INTERVAL_MS = 10_000;

/** Max retry attempts for deferred reconciliation */
const MAX_DEFERRED_ATTEMPTS = 3;

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * SharedBeliefProtocol
 *
 * Enables multiple agents to communicate beliefs about knowledge node states
 * and reach consensus via confidence-weighted voting.
 *
 * Transport: Redis pub/sub via injectable IBeliefTransport.
 * Channel pattern: `beliefs:{orgId}:{topicClusterId}`
 *
 * Reconciliation process:
 * 1. Conflicting assertions within 30s window → trigger reconciliation.
 * 2. Weight each assertion by confidenceScore.
 * 3. Highest weighted vote wins. Ties broken by earliest timestamp.
 * 4. Publish reconciled belief, record in TemporalVersionStore.
 *
 * Staleness: 5s ack timeout → "belief-stale", excluded from voting.
 * Deferred: If all agents stale, retry every 10s max 3 attempts, then discard.
 */
export class SharedBeliefProtocolService {
    // ─── Internal State ─────────────────────────────────────────────────────

    /** Maps topicClusterId → Set of subscribed agentIds */
    private subscriptions: Map<string, Set<string>> = new Map();

    /** Maps agentId → "active" | "belief-stale" */
    private agentStatus: Map<string, "active" | "belief-stale"> = new Map();

    /** Maps `${nodeId}:${orgId}` → array of assertions within the conflict window */
    private assertionWindows: Map<string, TimestampedAssertion[]> = new Map();

    /** Maps agentId → ack timeout timer */
    private ackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    /** Maps `${nodeId}:${orgId}` → deferred reconciliation state */
    private deferredReconciliations: Map<string, DeferredReconciliation> = new Map();

    /** Maps `${nodeId}:${orgId}` → timer for conflict window expiration */
    private windowTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    // ─── Dependencies ───────────────────────────────────────────────────────

    private transport: IBeliefTransport;
    private versionStore: ITemporalVersionStore;

    constructor(transport: IBeliefTransport, versionStore: ITemporalVersionStore) {
        this.transport = transport;
        this.versionStore = versionStore;
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    /**
     * Publish a belief assertion.
     *
     * Validates:
     * - evidenceRefs: 1–10 references
     * - confidenceScore: 0.0–1.0
     *
     * On valid assertion:
     * - Broadcasts to all subscribers on the topic channel
     * - Tracks assertion in conflict window
     * - Triggers reconciliation when conflict detected
     */
    async publishBelief(assertion: BeliefAssertion): Promise<void> {
        // ── Validation ──────────────────────────────────────────────────────
        if (
            !assertion.evidenceRefs ||
            assertion.evidenceRefs.length < 1 ||
            assertion.evidenceRefs.length > 10
        ) {
            throw new Error(
                `Invalid evidenceRefs: must contain 1–10 references, got ${assertion.evidenceRefs?.length ?? 0}`,
            );
        }

        if (
            typeof assertion.confidenceScore !== "number" ||
            assertion.confidenceScore < 0 ||
            assertion.confidenceScore > 1
        ) {
            throw new Error(
                `Invalid confidenceScore: must be between 0 and 1, got ${assertion.confidenceScore}`,
            );
        }

        // ── Mark agent as active on publish ─────────────────────────────────
        this.agentStatus.set(assertion.agentId, "active");

        // ── Broadcast to topic channel ──────────────────────────────────────
        const channel = this.buildChannel(assertion.organizationId, assertion.topicClusterId);
        await this.transport.publish(channel, JSON.stringify(assertion));

        // ── Start ack timer for subscribed agents ───────────────────────────
        this.startAckTimersForSubscribers(assertion.topicClusterId, assertion.agentId);

        // ── Track assertion in conflict window ──────────────────────────────
        const windowKey = this.buildWindowKey(assertion.nodeId, assertion.organizationId);
        const timestamped: TimestampedAssertion = {
            ...assertion,
            receivedAt: new Date(),
        };

        if (!this.assertionWindows.has(windowKey)) {
            this.assertionWindows.set(windowKey, []);
        }

        const window = this.assertionWindows.get(windowKey)!;
        window.push(timestamped);

        // ── Schedule window cleanup ─────────────────────────────────────────
        this.scheduleWindowCleanup(windowKey);

        // ── Check for conflicts ─────────────────────────────────────────────
        this.checkForConflicts(windowKey, assertion);

        logger.info("Belief published", {
            agentId: assertion.agentId,
            nodeId: assertion.nodeId,
            topicClusterId: assertion.topicClusterId,
            confidenceScore: assertion.confidenceScore,
        });
    }

    /**
     * Subscribe an agent to a specific topic cluster.
     */
    subscribeTopic(agentId: string, topicClusterId: string): void {
        if (!this.subscriptions.has(topicClusterId)) {
            this.subscriptions.set(topicClusterId, new Set());
        }
        this.subscriptions.get(topicClusterId)!.add(agentId);

        // Initialize agent status as active
        if (!this.agentStatus.has(agentId)) {
            this.agentStatus.set(agentId, "active");
        }

        logger.info("Agent subscribed to topic", { agentId, topicClusterId });
    }

    /**
     * Unsubscribe an agent from a specific topic cluster.
     */
    unsubscribeTopic(agentId: string, topicClusterId: string): void {
        const subscribers = this.subscriptions.get(topicClusterId);
        if (subscribers) {
            subscribers.delete(agentId);
            if (subscribers.size === 0) {
                this.subscriptions.delete(topicClusterId);
            }
        }

        logger.info("Agent unsubscribed from topic", { agentId, topicClusterId });
    }

    /**
     * Get the current status of an agent.
     */
    getAgentStatus(agentId: string): "active" | "belief-stale" {
        return this.agentStatus.get(agentId) ?? "active";
    }

    /**
     * Acknowledge a belief broadcast. Resets the agent's staleness timer
     * and re-activates the agent if it was stale.
     */
    acknowledgeBeliefBroadcast(agentId: string): void {
        // Clear any pending ack timer
        const existingTimer = this.ackTimers.get(agentId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.ackTimers.delete(agentId);
        }

        // Re-activate agent
        this.agentStatus.set(agentId, "active");
    }

    /**
     * Get the set of agents subscribed to a topic cluster.
     */
    getSubscribers(topicClusterId: string): Set<string> {
        return this.subscriptions.get(topicClusterId) ?? new Set();
    }

    /**
     * Get current assertions in the conflict window for a node.
     * Exposed for testing.
     */
    getAssertionWindow(nodeId: number, orgId: number): TimestampedAssertion[] {
        const key = this.buildWindowKey(nodeId, orgId);
        return this.assertionWindows.get(key) ?? [];
    }

    /**
     * Clean up all timers. Should be called on shutdown.
     */
    dispose(): void {
        for (const timer of this.ackTimers.values()) {
            clearTimeout(timer);
        }
        this.ackTimers.clear();

        for (const timer of this.windowTimers.values()) {
            clearTimeout(timer);
        }
        this.windowTimers.clear();

        for (const deferred of this.deferredReconciliations.values()) {
            if (deferred.timerId) {
                clearTimeout(deferred.timerId);
            }
        }
        this.deferredReconciliations.clear();
    }

    // ─── Private Helpers ────────────────────────────────────────────────────

    /**
     * Build the Redis channel name.
     */
    private buildChannel(orgId: number, topicClusterId: string): string {
        return `beliefs:${orgId}:${topicClusterId}`;
    }

    /**
     * Build the window key for tracking assertions per node.
     */
    private buildWindowKey(nodeId: number, orgId: number): string {
        return `${nodeId}:${orgId}`;
    }

    /**
     * Start acknowledgment timers for all subscribers (excluding the publishing agent).
     * After 5s without ack, the agent is marked "belief-stale".
     */
    private startAckTimersForSubscribers(topicClusterId: string, publishingAgentId: string): void {
        const subscribers = this.subscriptions.get(topicClusterId);
        if (!subscribers) return;

        for (const agentId of subscribers) {
            if (agentId === publishingAgentId) continue;

            // Clear any existing timer
            const existing = this.ackTimers.get(agentId);
            if (existing) {
                clearTimeout(existing);
            }

            // Set new ack timer
            const timer = setTimeout(() => {
                this.agentStatus.set(agentId, "belief-stale");
                this.ackTimers.delete(agentId);
                logger.warn("Agent marked as belief-stale", { agentId, topicClusterId });
            }, ACK_TIMEOUT_MS);

            this.ackTimers.set(agentId, timer);
        }
    }

    /**
     * Schedule cleanup of the assertion window after CONFLICT_WINDOW_MS.
     * Resets the timer on each new assertion so the window slides.
     */
    private scheduleWindowCleanup(windowKey: string): void {
        const existing = this.windowTimers.get(windowKey);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.assertionWindows.delete(windowKey);
            this.windowTimers.delete(windowKey);
        }, CONFLICT_WINDOW_MS);

        this.windowTimers.set(windowKey, timer);
    }

    /**
     * Check if there are conflicting assertions in the window.
     * Conflict = two or more agents with differing assertedState for the same node
     * within the 30s window.
     */
    private checkForConflicts(windowKey: string, latestAssertion: BeliefAssertion): void {
        const window = this.assertionWindows.get(windowKey);
        if (!window || window.length < 2) return;

        // Check if there are differing states from different agents
        const statesByAgent = new Map<string, string>();
        for (const assertion of window) {
            const stateKey = JSON.stringify(assertion.assertedState);
            const existing = statesByAgent.get(assertion.agentId);
            if (!existing) {
                statesByAgent.set(assertion.agentId, stateKey);
            } else {
                // Same agent, update to latest
                statesByAgent.set(assertion.agentId, stateKey);
            }
        }

        // Conflict: two or more agents with differing states
        const uniqueStates = new Set(statesByAgent.values());
        if (uniqueStates.size >= 2) {
            this.triggerReconciliation(windowKey, latestAssertion);
        }
    }

    /**
     * Trigger reconciliation for conflicting beliefs.
     * Uses confidence-weighted voting with earliest-timestamp tiebreaker.
     */
    private triggerReconciliation(windowKey: string, contextAssertion: BeliefAssertion): void {
        const window = this.assertionWindows.get(windowKey);
        if (!window || window.length === 0) return;

        // Get eligible agents (not stale)
        const eligibleAssertions = window.filter(
            (a) => this.getAgentStatus(a.agentId) === "active",
        );

        // If all agents are stale, defer reconciliation
        if (eligibleAssertions.length === 0) {
            this.deferReconciliation(windowKey, contextAssertion);
            return;
        }

        // Perform confidence-weighted voting
        const result = this.performVoting(eligibleAssertions);
        this.publishReconciliationResult(result, contextAssertion);
    }

    /**
     * Perform confidence-weighted voting on a set of assertions.
     * Highest confidence wins. Ties broken by earliest timestamp.
     */
    performVoting(assertions: TimestampedAssertion[]): ReconciliationResult {
        // Group by unique state, accumulate weights per state
        const stateVotes = new Map<string, {
            state: Record<string, any>;
            totalWeight: number;
            earliestTimestamp: Date;
            winningAgentId: string;
            voters: Array<{ agentId: string; weight: number; vote: string }>;
        }>();

        for (const assertion of assertions) {
            const stateKey = JSON.stringify(assertion.assertedState);
            const existing = stateVotes.get(stateKey);

            if (!existing) {
                stateVotes.set(stateKey, {
                    state: assertion.assertedState,
                    totalWeight: assertion.confidenceScore,
                    earliestTimestamp: assertion.receivedAt,
                    winningAgentId: assertion.agentId,
                    voters: [{
                        agentId: assertion.agentId,
                        weight: assertion.confidenceScore,
                        vote: stateKey,
                    }],
                });
            } else {
                existing.totalWeight += assertion.confidenceScore;
                existing.voters.push({
                    agentId: assertion.agentId,
                    weight: assertion.confidenceScore,
                    vote: stateKey,
                });
                // Track earliest timestamp for this state group
                if (assertion.receivedAt < existing.earliestTimestamp) {
                    existing.earliestTimestamp = assertion.receivedAt;
                    existing.winningAgentId = assertion.agentId;
                }
            }
        }

        // Find the winning state by highest total weight, then earliest timestamp
        let winner: {
            state: Record<string, any>;
            totalWeight: number;
            earliestTimestamp: Date;
            winningAgentId: string;
            voters: Array<{ agentId: string; weight: number; vote: string }>;
        } | null = null;

        for (const candidate of stateVotes.values()) {
            if (!winner) {
                winner = candidate;
            } else if (candidate.totalWeight > winner.totalWeight) {
                winner = candidate;
            } else if (
                candidate.totalWeight === winner.totalWeight &&
                candidate.earliestTimestamp < winner.earliestTimestamp
            ) {
                winner = candidate;
            }
        }

        // Collect all voting details across all state groups
        const allVotingDetails: Array<{ agentId: string; weight: number; vote: string }> = [];
        for (const entry of stateVotes.values()) {
            allVotingDetails.push(...entry.voters);
        }

        return {
            reconciledState: winner!.state,
            winningAgentId: winner!.winningAgentId,
            votingDetails: allVotingDetails,
            timestamp: new Date(),
        };
    }

    /**
     * Publish reconciliation result and record in TemporalVersionStore.
     */
    private async publishReconciliationResult(
        result: ReconciliationResult,
        contextAssertion: BeliefAssertion,
    ): Promise<void> {
        try {
            // Publish reconciled belief to all subscribers on the topic channel
            const channel = this.buildChannel(
                contextAssertion.organizationId,
                contextAssertion.topicClusterId,
            );
            await this.transport.publish(channel, JSON.stringify({
                type: "reconciliation_result",
                ...result,
            }));

            // Record in TemporalVersionStore
            // Use the latest assertion's state as "previous" for the version record
            const previousState = contextAssertion.assertedState;
            await this.versionStore.recordNodeVersion(
                contextAssertion.nodeId,
                previousState as any,
                result.reconciledState as any,
                "system:belief_reconciliation",
                `Belief reconciliation: ${result.votingDetails.length} agents voted, winner=${result.winningAgentId}`,
            );

            // Clear the assertion window after reconciliation
            const windowKey = this.buildWindowKey(
                contextAssertion.nodeId,
                contextAssertion.organizationId,
            );
            this.assertionWindows.delete(windowKey);
            const windowTimer = this.windowTimers.get(windowKey);
            if (windowTimer) {
                clearTimeout(windowTimer);
                this.windowTimers.delete(windowKey);
            }

            logger.info("Reconciliation completed", {
                nodeId: contextAssertion.nodeId,
                winningAgentId: result.winningAgentId,
                voterCount: result.votingDetails.length,
            });
        } catch (error: any) {
            logger.error("Failed to publish reconciliation result", {
                nodeId: contextAssertion.nodeId,
                error: error.message || error,
            });
        }
    }

    /**
     * Defer reconciliation when all agents are stale.
     * Retry every 10s, max 3 attempts. Discard and log on final failure.
     */
    private deferReconciliation(windowKey: string, contextAssertion: BeliefAssertion): void {
        const existing = this.deferredReconciliations.get(windowKey);

        if (existing && existing.attempts >= MAX_DEFERRED_ATTEMPTS) {
            // Already exhausted retries — should not happen but guard anyway
            return;
        }

        const deferred: DeferredReconciliation = existing ?? {
            nodeId: contextAssertion.nodeId,
            organizationId: contextAssertion.organizationId,
            topicClusterId: contextAssertion.topicClusterId,
            attempts: 0,
            timerId: null,
        };

        // Schedule retry
        const timerId = setTimeout(() => {
            deferred.attempts++;
            this.retryDeferredReconciliation(windowKey, contextAssertion, deferred);
        }, DEFERRED_RETRY_INTERVAL_MS);

        deferred.timerId = timerId;
        this.deferredReconciliations.set(windowKey, deferred);

        logger.warn("Reconciliation deferred: all agents stale", {
            nodeId: contextAssertion.nodeId,
            attempt: deferred.attempts + 1,
            maxAttempts: MAX_DEFERRED_ATTEMPTS,
        });
    }

    /**
     * Retry deferred reconciliation. If agents are still stale after max attempts,
     * discard and log.
     */
    private retryDeferredReconciliation(
        windowKey: string,
        contextAssertion: BeliefAssertion,
        deferred: DeferredReconciliation,
    ): void {
        const window = this.assertionWindows.get(windowKey);
        if (!window || window.length === 0) {
            // Window has been cleared, nothing to reconcile
            this.deferredReconciliations.delete(windowKey);
            return;
        }

        // Check if any agents are now active
        const eligibleAssertions = window.filter(
            (a) => this.getAgentStatus(a.agentId) === "active",
        );

        if (eligibleAssertions.length > 0) {
            // We have active agents — proceed with reconciliation
            const result = this.performVoting(eligibleAssertions);
            this.publishReconciliationResult(result, contextAssertion);
            this.deferredReconciliations.delete(windowKey);
            return;
        }

        // Still all stale
        if (deferred.attempts >= MAX_DEFERRED_ATTEMPTS) {
            // Max attempts exhausted — discard and log
            logger.error("Deferred reconciliation failed: max attempts exhausted, discarding", {
                nodeId: contextAssertion.nodeId,
                organizationId: contextAssertion.organizationId,
                topicClusterId: contextAssertion.topicClusterId,
                totalAttempts: deferred.attempts,
            });
            this.assertionWindows.delete(windowKey);
            this.deferredReconciliations.delete(windowKey);
            return;
        }

        // Schedule another retry
        const timerId = setTimeout(() => {
            deferred.attempts++;
            this.retryDeferredReconciliation(windowKey, contextAssertion, deferred);
        }, DEFERRED_RETRY_INTERVAL_MS);

        deferred.timerId = timerId;

        logger.warn("Deferred reconciliation retry scheduled", {
            nodeId: contextAssertion.nodeId,
            attempt: deferred.attempts,
            maxAttempts: MAX_DEFERRED_ATTEMPTS,
        });
    }
}

/**
 * Factory function to create the SharedBeliefProtocolService with the
 * real Redis transport from the existing infrastructure.
 */
export function createSharedBeliefProtocolService(
    transport: IBeliefTransport,
    versionStore: ITemporalVersionStore,
): SharedBeliefProtocolService {
    return new SharedBeliefProtocolService(transport, versionStore);
}

export default SharedBeliefProtocolService;
