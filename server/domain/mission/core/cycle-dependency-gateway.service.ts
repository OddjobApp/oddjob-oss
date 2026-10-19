/**
 * Cycle Dependency Gateway
 *
 * Replaces the 30-minute DB-polling loop in spawnBlueprintsWithDeps with an
 * efficient EventEmitter-based wait backed by a persistent DB gate table.
 *
 * Flow:
 *   spawnBlueprintsWithDeps calls waitForDependency() instead of polling.
 *   waitForDependency() registers the gate in DB and waits on an EventEmitter.
 *   When a mission completes, the caller must call onMissionCompleted() which
 *   resolves all waiting gates for that mission and emits the wake-up signal.
 *   On server restart, resumeStuckGates() re-emits signals for gates whose
 *   upstream missions are already complete.
 */

import { EventEmitter } from "events";
import { db } from "@server/database_service.js";
import { cycleDependencyGates, missionRuns, missions } from "@shared/schema/index.js";
import { credentials } from "@shared/schema/system.js";
import { eq, and, isNull, or, ilike } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { evaluateCELExpression } from "../../../core/cel-evaluator.js";
import { anyCredentialResolvable } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("CycleDependencyGateway");

const emitter = new EventEmitter();
emitter.setMaxListeners(500); // Allow many concurrent blueprint waits

// Default gate timeout — configurable via env, overridable per-dependency (#3).
const DEFAULT_GATE_TIMEOUT_MS = (Number(process.env.CYCLE_GATE_TIMEOUT_MINUTES) > 0
    ? Number(process.env.CYCLE_GATE_TIMEOUT_MINUTES)
    : 30) * 60 * 1000;

/**
 * Is the external system behind a webhook `source` actually wired up for this
 * org? Mirrors the SDLC local-artifact philosophy: when no real integration is
 * configured, nothing can ever POST the webhook, so the cycle must not block on
 * it. git/source-control credentials are stored with type "api_key" (name
 * "… — source_control"), so they are matched by name; everything else
 * (jira/slack/confluence) matches by credential type. "Configured" requires the
 * credential's backing env var to actually hold a value (same test as
 * isSaaSConfigured). On any error we assume configured, so a real gate is never
 * skipped by accident.
 */
async function isWebhookSourceConfigured(orgId: number | null | undefined, source: string): Promise<boolean> {
    const src = (source || "").toLowerCase();
    const orgScope = orgId
        ? or(eq(credentials.organizationId, orgId), isNull(credentials.organizationId))
        : isNull(credentials.organizationId);
    try {
        const matcher = /git|github|gitlab|bitbucket|source[_-]?control/.test(src)
            ? ilike(credentials.name, "%source_control%")
            : ilike(credentials.type, `%${src}%`);
        const rows = await db.select({ id: credentials.id, organizationId: credentials.organizationId, envVarName: credentials.envVarName })
            .from(credentials)
            .where(and(matcher, orgScope));
        return anyCredentialResolvable(rows);
    } catch (err: any) {
        logger.warn(`[DependencyGateway] webhook-source config check failed for "${source}": ${err.message}`);
        return true; // conservative: don't skip a potentially-real gate
    }
}

export interface GateWaitOptions {
    /** Per-dependency timeout override (ms). Falls back to DEFAULT_GATE_TIMEOUT_MS. */
    timeoutMs?: number;
    /** On timeout: "fail" (reject, default) or "continue" (resolve and proceed). */
    onTimeout?: "fail" | "continue";
    organizationId?: number | null;
    /** Agent/role to route triage to on escalation (default "scrum-master"). */
    escalateTo?: string;
}

type EscalationStage = "warned" | "alerted" | "escalated";

function gateEventKey(cycleId: number, upstreamName: string, depType: string): string {
    const targetStatus = (depType === 'start_to_start' || depType === 'start_to_finish') ? 'active' : 'completed';
    return `gate:${cycleId}:${upstreamName}:${targetStatus}`;
}

export const cycleDependencyGatewayService = {

    /**
     * Called instead of the polling loop. Resolves when the upstream blueprint
     * reaches the target status, or rejects after 30 minutes.
     */
    async waitForDependency(
        cycleId: number,
        upstreamBlueprintName: string,
        downstreamBlueprintName: string,
        dependencyType: string,
        offsetMs: number = 0,
        offsetDirection: string = 'plus',
        options: GateWaitOptions = {}
    ): Promise<void> {
        const targetStatus = (dependencyType === 'start_to_start' || dependencyType === 'start_to_finish')
            ? 'active'
            : 'completed';

        // Fast path: already done
        const [existingRun] = await db
            .select({ status: missionRuns.status })
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(and(
                eq(missionRuns.cycleId, cycleId),
                eq(missions.name, upstreamBlueprintName),
                isNull(missionRuns.deletedAt)
            ))
            .limit(1);

        if (existingRun && (existingRun.status === targetStatus || existingRun.status === 'completed')) {
            return; // Already satisfied
        }

        const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_GATE_TIMEOUT_MS;

        // Persist gate for restart recovery
        await db.insert(cycleDependencyGates)
            .values({
                cycleId,
                upstreamBlueprintName,
                downstreamBlueprintName,
                dependencyType,
                offsetMs,
                offsetDirection,
                timeoutMs,
                escalationState: 'none',
                status: 'waiting',
            })
            .onConflictDoNothing();

        const eventKey = gateEventKey(cycleId, upstreamBlueprintName, dependencyType);

        await new Promise<void>((resolve, reject) => {
            // Graduated escalation: warn @50%, alert @80%, expire @100%.
            const warnTimer = setTimeout(() => {
                this.escalateGate(cycleId, upstreamBlueprintName, downstreamBlueprintName, 'warned', 50, options).catch(() => {});
            }, Math.floor(timeoutMs * 0.5));
            const alertTimer = setTimeout(() => {
                this.escalateGate(cycleId, upstreamBlueprintName, downstreamBlueprintName, 'alerted', 80, options).catch(() => {});
            }, Math.floor(timeoutMs * 0.8));

            const clearAll = () => { clearTimeout(warnTimer); clearTimeout(alertTimer); clearTimeout(expireTimer); };

            const expireTimer = setTimeout(async () => {
                clearAll();
                emitter.off(eventKey, handler);
                // Escalate BEFORE expiring: escalateGate only updates rows still in
                // 'waiting', so it must run before expireGate flips the status.
                await this.escalateGate(cycleId, upstreamBlueprintName, downstreamBlueprintName, 'escalated', 100, options).catch(() => {});
                await this.expireGate(cycleId, upstreamBlueprintName, downstreamBlueprintName).catch(() => {});
                // Non-silent expiry: escalate, then honor the on_timeout policy instead of
                // unconditionally throwing (which previously killed the branch silently).
                if (options.onTimeout === 'continue') {
                    logger.warn(`[DependencyGateway] Gate ${upstreamBlueprintName} → ${downstreamBlueprintName} timed out after ${Math.round(timeoutMs / 60000)}m — proceeding (on_timeout=continue)`);
                    resolve();
                } else {
                    reject(new Error(`Dependency timeout: ${downstreamBlueprintName} waited ${Math.round(timeoutMs / 60000)}m for ${upstreamBlueprintName} (escalated to ${options.escalateTo || 'scrum-master'})`));
                }
            }, timeoutMs);

            const handler = (status?: string) => {
                clearAll();
                emitter.off(eventKey, handler);
                if (status === 'failed' || status === 'cancelled') {
                    reject(new Error(`Dependency failed: ${upstreamBlueprintName} terminated with status ${status}`));
                } else {
                    resolve();
                }
            };

            emitter.once(eventKey, handler);
        });

        // Apply lead/lag offset if requested
        if (offsetMs > 0 && offsetDirection === 'plus') {
            logger.info(`[DependencyGateway] Applying lag offset ${offsetMs}ms before launching ${downstreamBlueprintName}`);
            await new Promise(r => setTimeout(r, offsetMs));
        }

        // Mark gate resolved
        await this.resolveGate(cycleId, upstreamBlueprintName, downstreamBlueprintName);
    },

    /**
     * Record a graduated escalation stage for a waiting gate and emit a
     * `cycle.dependency_timeout` event so listeners (e.g. a Scrum Master triage
     * handler) can react. Best-effort — never throws into the wait loop.
     */
    async escalateGate(
        cycleId: number,
        upstream: string,
        downstream: string,
        stage: EscalationStage,
        pct: number,
        options: GateWaitOptions = {}
    ): Promise<void> {
        const escalateTo = options.escalateTo || 'scrum-master';
        try {
            await db.update(cycleDependencyGates)
                .set({ escalationState: stage, ...(stage === 'escalated' ? { escalatedTo: escalateTo } : {}) })
                .where(and(
                    eq(cycleDependencyGates.cycleId, cycleId),
                    eq(cycleDependencyGates.upstreamBlueprintName, upstream),
                    eq(cycleDependencyGates.downstreamBlueprintName, downstream),
                    eq(cycleDependencyGates.status, 'waiting'),
                ));
        } catch { /* gate may already be resolved — ignore */ }

        logger.warn(`[DependencyGateway] Gate ${upstream} → ${downstream} (cycle ${cycleId}) reached ${pct}% of timeout → ${stage}`);

        eventStream.publish('cycle.dependency_timeout', {
            cycleId, upstream, downstream, stage, pct,
            escalatedTo: stage === 'escalated' ? escalateTo : null,
        }, {
            organizationId: options.organizationId ?? undefined,
            subject: `cycle:${cycleId}`,
        }, 'cycle-dependency-gateway').catch(() => {});
    },

    /**
     * Called when a mission run reaches active or completed status.
     * Wakes up all downstream blueprints waiting on this mission.
     */
    async onMissionStatusChange(
        cycleId: number,
        missionName: string,
        newStatus: 'active' | 'completed' | 'failed' | 'cancelled'
    ): Promise<void> {
        // Emit for FTS and SS gates
        const ftKey = gateEventKey(cycleId, missionName, 'finish_to_start');
        const ssKey = gateEventKey(cycleId, missionName, 'start_to_start');
        const sfKey = gateEventKey(cycleId, missionName, 'start_to_finish');
        const ffKey = gateEventKey(cycleId, missionName, 'finish_to_finish');

        if (newStatus === 'active') {
            emitter.emit(ssKey, 'active');
            emitter.emit(sfKey, 'active');
        } else if (newStatus === 'completed') {
            emitter.emit(ftKey, 'completed');
            emitter.emit(ffKey, 'completed');
        } else if (newStatus === 'failed' || newStatus === 'cancelled') {
            emitter.emit(ssKey, newStatus);
            emitter.emit(sfKey, newStatus);
            emitter.emit(ftKey, newStatus);
            emitter.emit(ffKey, newStatus);
        }

        logger.debug(`[DependencyGateway] Mission ${missionName} in cycle ${cycleId} → ${newStatus}`);
    },

    /**
     * Called on server startup. Finds gates whose upstream missions are already
     * complete and re-emits the wake-up signals to unblock any re-spawned waits.
     */
    async resumeStuckGates(): Promise<void> {
        const waitingGates = await db
            .select()
            .from(cycleDependencyGates)
            .where(eq(cycleDependencyGates.status, 'waiting'));

        if (waitingGates.length === 0) return;

        logger.info(`[DependencyGateway] Checking ${waitingGates.length} waiting gates on startup.`);

        for (const gate of waitingGates) {
            const targetStatus = (gate.dependencyType === 'start_to_start' || gate.dependencyType === 'start_to_finish')
                ? 'active'
                : 'completed';

            const [run] = await db
                .select({ status: missionRuns.status })
                .from(missionRuns)
                .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                .where(and(
                    eq(missionRuns.cycleId, gate.cycleId),
                    eq(missions.name, gate.upstreamBlueprintName),
                    isNull(missionRuns.deletedAt)
                ))
                .limit(1);

            if (run && (run.status === 'failed' || run.status === 'cancelled')) {
                logger.info(`[DependencyGateway] Replaying failure signal on startup: ${gate.upstreamBlueprintName} → ${gate.downstreamBlueprintName}`);
                const eventKey = gateEventKey(gate.cycleId, gate.upstreamBlueprintName, gate.dependencyType);
                emitter.emit(eventKey, run.status);
            } else if (run && (run.status === targetStatus || run.status === 'completed')) {
                logger.info(`[DependencyGateway] Replaying resolved signal: ${gate.upstreamBlueprintName} → ${gate.downstreamBlueprintName}`);
                const eventKey = gateEventKey(gate.cycleId, gate.upstreamBlueprintName, gate.dependencyType);
                emitter.emit(eventKey, 'completed');
                // Upstream still pending: the in-memory warn/alert/expire timers were lost
                // on restart. Re-arm the escalation lifecycle from where it left off so a
                // gate whose upstream hangs still escalates + expires (DB + events) instead
                // of waiting forever.
                this.rearmGateEscalation(gate);
            }
        }
    },

    /**
     * Re-schedule a waiting gate's graduated escalation (warn 50% / alert 80% /
     * escalate+expire 100%) based on elapsed time since createdAt, skipping stages
     * already reached (per escalationState). Each fire re-checks the gate is still
     * waiting first. Timers are unref'd so they never hold the process open.
     */
    rearmGateEscalation(gate: any): void {
        const timeoutMs = gate.timeoutMs && gate.timeoutMs > 0 ? gate.timeoutMs : DEFAULT_GATE_TIMEOUT_MS;
        const createdAt = gate.createdAt ? new Date(gate.createdAt).getTime() : Date.now();
        const now = Date.now();
        const rank: Record<string, number> = { none: 0, warned: 1, alerted: 2, escalated: 3 };
        const reached = rank[gate.escalationState as string] ?? 0;
        const opts: GateWaitOptions = { escalateTo: gate.escalatedTo || 'scrum-master' };

        const stages: Array<{ r: number; stage: EscalationStage; pct: number; at: number; final?: boolean }> = [
            { r: 1, stage: 'warned', pct: 50, at: createdAt + timeoutMs * 0.5 },
            { r: 2, stage: 'alerted', pct: 80, at: createdAt + timeoutMs * 0.8 },
            { r: 3, stage: 'escalated', pct: 100, at: createdAt + timeoutMs, final: true },
        ];

        for (const s of stages) {
            if (s.r <= reached) continue; // already fired before the restart
            const delay = Math.max(0, s.at - now);
            const timer = setTimeout(async () => {
                try {
                    const [g] = await db.select({ status: cycleDependencyGates.status })
                        .from(cycleDependencyGates).where(eq(cycleDependencyGates.id, gate.id)).limit(1);
                    if (!g || g.status !== 'waiting') return; // resolved/expired meanwhile
                    await this.escalateGate(gate.cycleId, gate.upstreamBlueprintName, gate.downstreamBlueprintName, s.stage, s.pct, opts).catch(() => {});
                    if (s.final) await this.expireGate(gate.cycleId, gate.upstreamBlueprintName, gate.downstreamBlueprintName).catch(() => {});
                } catch { /* best-effort */ }
            }, delay);
            if (typeof timer.unref === 'function') timer.unref();
        }
    },

    async resolveGate(cycleId: number, upstream: string, downstream: string): Promise<void> {
        await db.update(cycleDependencyGates)
            .set({ status: 'resolved', resolvedAt: new Date() })
            .where(and(
                eq(cycleDependencyGates.cycleId, cycleId),
                eq(cycleDependencyGates.upstreamBlueprintName, upstream),
                eq(cycleDependencyGates.downstreamBlueprintName, downstream),
                eq(cycleDependencyGates.status, 'waiting')
            ));
    },

    async expireGate(cycleId: number, upstream: string, downstream: string): Promise<void> {
        await db.update(cycleDependencyGates)
            .set({ status: 'expired', resolvedAt: new Date() })
            .where(and(
                eq(cycleDependencyGates.cycleId, cycleId),
                eq(cycleDependencyGates.upstreamBlueprintName, upstream),
                eq(cycleDependencyGates.downstreamBlueprintName, downstream),
                eq(cycleDependencyGates.status, 'waiting')
            ));
    },

    /**
     * Waits for an inbound webhook event matching the source and satisfying the condition.
     */
    async waitForWebhookTrigger(
        cycleId: number,
        blueprintName: string,
        source: string,
        condition: string,
        options: GateWaitOptions = {}
    ): Promise<any | null> {
        const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_GATE_TIMEOUT_MS;
        logger.info(`[DependencyGateway] Blueprint ${blueprintName} in cycle ${cycleId} waiting for webhook trigger from ${source}`);

        // Dev / no-integration auto-advance: if the source system isn't wired up
        // for this org, nothing can ever send this webhook — so record + resolve
        // the gate immediately and let the cycle proceed (payload = null, the same
        // resolution as on_timeout=continue) instead of blocking until timeout.
        if (!(await isWebhookSourceConfigured(options.organizationId, source))) {
            logger.warn(`[DependencyGateway] '${source}' integration not configured for org ${options.organizationId ?? "?"} — auto-advancing webhook gate for ${blueprintName} (no external system can trigger it).`);
            await db.insert(cycleDependencyGates)
                .values({
                    cycleId,
                    upstreamBlueprintName: `webhook:${source}`,
                    downstreamBlueprintName: blueprintName,
                    dependencyType: 'webhook',
                    status: 'waiting',
                })
                .onConflictDoNothing();
            await this.resolveGate(cycleId, `webhook:${source}`, blueprintName);
            return null;
        }

        // Persist gate for restart recovery
        await db.insert(cycleDependencyGates)
            .values({
                cycleId,
                upstreamBlueprintName: `webhook:${source}`,
                downstreamBlueprintName: blueprintName,
                dependencyType: 'webhook',
                status: 'waiting',
            })
            .onConflictDoNothing();

        const eventKey = `webhook:${source}`;

        const webhookPayload = await new Promise<any | null>((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                emitter.off(eventKey, handler);
                clearTimeout(timer);
            };

            const timer = setTimeout(async () => {
                if (settled) return;
                settled = true;
                cleanup();
                // Escalate before expiring (see waitForDependency note).
                await this.escalateGate(cycleId, `webhook:${source}`, blueprintName, 'escalated', 100, options).catch(() => {});
                await this.expireGate(cycleId, `webhook:${source}`, blueprintName).catch(() => {});
                if (options.onTimeout === 'continue') {
                    logger.warn(`[DependencyGateway] Webhook ${source} for ${blueprintName} timed out after ${Math.round(timeoutMs / 60000)}m — proceeding (on_timeout=continue)`);
                    resolve(null);
                } else {
                    reject(new Error(`Webhook trigger timeout: ${blueprintName} waited ${Math.round(timeoutMs / 60000)}m for ${source} webhook`));
                }
            }, timeoutMs);

            const handler = (payload: any) => {
                if (settled) return;
                const matches = evaluateWebhookCondition(condition, payload);
                if (matches) {
                    settled = true;
                    cleanup();
                    resolve(payload);
                } else {
                    logger.debug(`[DependencyGateway] Webhook received but condition not met for ${blueprintName}: ${condition}`);
                }
            };

            emitter.on(eventKey, handler);
        });

        // Mark gate resolved
        await this.resolveGate(cycleId, `webhook:${source}`, blueprintName);
        return webhookPayload;
    },

    /**
     * Dispatches an inbound webhook payload to any waiting gates.
     */
    async triggerWebhook(source: string, payload: any): Promise<void> {
        logger.info(`[DependencyGateway] Triggering webhook event: webhook:${source}`);
        emitter.emit(`webhook:${source}`, payload);
    }
};

/**
 * Safe condition evaluator — supports:
 *   <dotted.path> <op> <literal>  joined by AND / OR
 * No eval or new Function — only whitelisted path access and comparisons.
 */
function evaluateWebhookCondition(condition: string, payload: any): boolean {
    try {
        // Try using CEL evaluator first
        return evaluateCELExpression(condition, {
            positional: {},
            named: {},
            data: payload
        });
    } catch (celErr: any) {
        logger.warn(`CEL evaluation failed for condition "${condition}", falling back to legacy evaluator: ${celErr.message}`);
        try {
            const normalized = condition.trim()
                .replace(/\bAND\b/gi, '||SPLIT_AND||')
                .replace(/\bOR\b/gi, '||SPLIT_OR||');

            // OR has lower precedence — split there first
            const orClauses = normalized.split('||SPLIT_OR||').map(s => s.trim());
            return orClauses.some(orClause => {
                const andClauses = orClause.split('||SPLIT_AND||').map(s => s.trim());
                return andClauses.every(clause => evaluateComparison(clause, payload));
            });
        } catch (e) {
            logger.error(`Failed to evaluate condition "${condition}": ${(e as any).message}`);
            return false;
        }
    }
}

function evaluateComparison(expr: string, payload: any): boolean {
    const ops = [
        { sym: '==', fn: (a: any, b: any) => String(a) === String(b) },
        { sym: '!=', fn: (a: any, b: any) => String(a) !== String(b) },
        { sym: '>=', fn: (a: any, b: any) => Number(a) >= Number(b) },
        { sym: '<=', fn: (a: any, b: any) => Number(a) <= Number(b) },
        { sym: '>', fn: (a: any, b: any) => Number(a) > Number(b) },
        { sym: '<', fn: (a: any, b: any) => Number(a) < Number(b) },
    ];

    for (const { sym, fn } of ops) {
        const idx = expr.indexOf(sym);
        if (idx === -1) continue;
        const lhs = expr.slice(0, idx).trim();
        const rhs = expr.slice(idx + sym.length).trim();
        return fn(resolveDotPath(lhs, payload), parseLiteral(rhs));
    }

    // No operator — treat path as boolean
    return Boolean(resolveDotPath(expr.trim(), payload));
}

function resolveDotPath(path: string, obj: any): any {
    // Only allow alphanumeric + underscore segments — no prototype access
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(path)) return undefined;
    return path.split('.').reduce((acc, key) => {
        if (acc == null || key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
        return (acc as any)[key];
    }, obj);
}

function parseLiteral(s: string): any {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    const n = Number(s);
    return isNaN(n) ? s : n;
}
