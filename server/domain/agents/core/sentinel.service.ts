import { db } from "@server/database_service.js";
import { forensicEventLog } from "@shared/schema/index.js";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import { logForensicEvent } from "../../core/infrastructure/trace-logger.service.js";
import { sentinelEventBus, SentinelEvent } from "./sentinel-event-bus.js";

export interface SkillHealth {
    reliabilityIndex: number; // 0-100
    avgLatencyMs: number;
    totalRuns: number;
    lastFailure?: string;
}

export interface EvolutionCandidate {
    skillId: string;
    total: number;
    success: number;
    failure: number;
    reliabilityPct: number;
    latestEventAt: string | null;
    linkedRunCount: number;
    unlinkedEventCount: number;
    latestMissionRunId: number | null;
}

export class SentinelService {
    /**
     * Records a successful execution of a UCI skill.
     */
    static async logSuccess(skillId: string, durationNs: bigint, context: { organizationId?: number; jobId?: number }) {
        await logForensicEvent(null, {
            jobType: "uci_skill_execution",
            jobId: context.jobId,
            organizationId: context.organizationId,
            status: "success",
            attributes: {
                skillId,
                durationMs: Number(durationNs / BigInt(1000000))
            }
        });
    }

    /**
     * Records a 'Sentinel Insight' - a significant autonomous decision based on health telemetry.
     */
    static async logInsight(missionRunId: number, message: string, attributes: any = {}) {
        // 1. Log to forensic log for long-term analytics
        await logForensicEvent(null, {
            missionRunId,
            jobType: "sentinel_insight",
            status: "success",
            attributes: {
                ...attributes,
                event: "Sentinel Protocol Adjustment",
                note: message
            }
        });

        // 1.5 Emit for real-time bridges (Slack/Teams)
        sentinelEventBus.emit(SentinelEvent.INSIGHT_GENERATED, {
            missionRunId,
            message,
            attributes
        });

        // 2. Append to dynamic trace for real-time UI visibility
        try {
            const { missionRuns } = await import("@shared/schema/index.js");
            await db.update(missionRuns)
                .set({ 
                    dynamicTrace: sql`COALESCE(dynamic_trace, '[]'::jsonb) || ${JSON.stringify([{
                        type: "system",
                        attributes: {
                            event: "sentinel_insight",
                            note: message
                        },
                        timestamp: new Date().toISOString()
                    }])}::jsonb`,
                    updatedAt: new Date() 
                })
                .where(eq(missionRuns.id, missionRunId));
        } catch (err: any) {
             // Non-blocking error
             console.error(`[SentinelService] Failed to append trace: ${err.message}`);
        }
    }

    /**
     * Records a failed execution of a UCI skill.
     */
    static async logFailure(skillId: string, error: string, durationNs: bigint, context: { organizationId?: number; jobId?: number }) {
        await logForensicEvent(null, {
            jobType: "uci_skill_execution",
            jobId: context.jobId,
            organizationId: context.organizationId,
            status: "failure",
            errorMessage: error,
            attributes: {
                skillId,
                durationMs: Number(durationNs / BigInt(1000000))
            }
        });
    }

    /**
     * Calculates the health metrics for a specific skill over the last 30 days.
     */
    static async getSkillHealth(skillId: string): Promise<SkillHealth> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const events = await db
            .select({
                status: forensicEventLog.status,
                durationMs: sql<number>`(attributes->>'durationMs')::numeric`,
                errorMessage: forensicEventLog.errorMessage,
            })
            .from(forensicEventLog)
            .where(
                and(
                    sql`attributes->>'skillId' = ${skillId}`,
                    gte(forensicEventLog.createdAt, thirtyDaysAgo)
                )
            )
            .limit(100);

        if (events.length === 0) {
            return { reliabilityIndex: 100, avgLatencyMs: 0, totalRuns: 0 };
        }

        const successes = events.filter(e => e.status === "success").length;
        const totalLatency = events.reduce((acc, e) => acc + (e.durationMs || 0), 0);
        const lastFailure = events.find(e => e.status === "failure")?.errorMessage || undefined;

        return {
            reliabilityIndex: Math.round((successes / events.length) * 100),
            avgLatencyMs: Math.round(totalLatency / events.length),
            totalRuns: events.length,
            lastFailure
        };
    }

    /**
     * Same metric as getSkillHealth but scoped to an explicit time window.
     * Used by the post-promotion regression watchdog to compare before/after.
     */
    static async getSkillHealthInWindow(skillId: string, from: Date, to: Date): Promise<SkillHealth> {
        const events = await db
            .select({
                status: forensicEventLog.status,
                durationMs: sql<number>`(attributes->>'durationMs')::numeric`,
                errorMessage: forensicEventLog.errorMessage,
            })
            .from(forensicEventLog)
            .where(
                and(
                    sql`attributes->>'skillId' = ${skillId}`,
                    gte(forensicEventLog.createdAt, from),
                    sql`${forensicEventLog.createdAt} < ${to}`
                )
            )
            .limit(200);

        if (events.length === 0) {
            return { reliabilityIndex: 100, avgLatencyMs: 0, totalRuns: 0 };
        }

        const successes = events.filter(e => e.status === "success").length;
        const totalLatency = events.reduce((acc, e) => acc + (e.durationMs || 0), 0);
        const lastFailure = events.find(e => e.status === "failure")?.errorMessage || undefined;

        return {
            reliabilityIndex: Math.round((successes / events.length) * 100),
            avgLatencyMs: Math.round(totalLatency / events.length),
            totalRuns: events.length,
            lastFailure
        };
    }

    /**
     * Identifies skills that are performing poorly and are candidates for Autoresearch evolution.
     */
    static async getEvolutionCandidates(threshold = 80): Promise<string[]> {
        // Query forensic logs grouped by skillId to find those with reliability < threshold
        const candidates = await db.execute(sql`
            SELECT attributes->>'skillId' as skill_id,
                   COUNT(*) as total,
                   SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::float / COUNT(*) as reliability
            FROM forensic_event_log
            WHERE job_type = 'uci_skill_execution'
            GROUP BY attributes->>'skillId'
            HAVING COUNT(*) > 5 AND (SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::float / COUNT(*)) < ${threshold / 100}
        `);

        const rows = Array.isArray(candidates) ? candidates : ((candidates as any).rows ?? []);
        return (rows as any[]).map(c => c.skill_id);
    }

    /**
     * Identifies poor-performing skills using only telemetry belonging to one organization.
     * The linked-run fields explain whether Autoresearch can launch a shadow experiment.
     */
    static async getEvolutionCandidatesForOrg(orgId: number, threshold = 80): Promise<EvolutionCandidate[]> {
        const candidates = await db.execute(sql`
            WITH scoped AS (
                SELECT
                    fel.*,
                    NULLIF(fel.attributes->>'skillId', '') AS skill_id,
                    mr.organization_id AS run_org_id
                FROM forensic_event_log fel
                LEFT JOIN mission_runs mr ON mr.id = fel.mission_run_id
                WHERE fel.job_type = 'uci_skill_execution'
                  AND NULLIF(fel.attributes->>'skillId', '') IS NOT NULL
                  AND (fel.organization_id = ${orgId} OR mr.organization_id = ${orgId})
            ),
            candidate_stats AS (
                SELECT
                    skill_id,
                    COUNT(*)::int AS total,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS success,
                    SUM(CASE WHEN status = 'success' THEN 0 ELSE 1 END)::int AS failure,
                    ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 1) AS reliability_pct,
                    MAX(created_at) AS latest_event_at,
                    COUNT(DISTINCT mission_run_id)::int AS linked_run_count,
                    COUNT(*) FILTER (WHERE mission_run_id IS NULL)::int AS unlinked_event_count
                FROM scoped
                GROUP BY skill_id
                HAVING COUNT(*) > 5
                   AND (SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::float / COUNT(*)) < ${threshold / 100}
            ),
            latest_linked AS (
                SELECT DISTINCT ON (skill_id)
                    skill_id,
                    mission_run_id AS latest_mission_run_id
                FROM scoped
                WHERE mission_run_id IS NOT NULL
                ORDER BY skill_id, created_at DESC
            )
            SELECT
                cs.*,
                ll.latest_mission_run_id
            FROM candidate_stats cs
            LEFT JOIN latest_linked ll ON ll.skill_id = cs.skill_id
            ORDER BY (cs.success::numeric / NULLIF(cs.total, 0)) ASC, cs.total DESC, cs.latest_event_at DESC
        `);

        const rows = Array.isArray(candidates) ? candidates : ((candidates as any).rows ?? []);
        return (rows as any[]).map((row) => ({
            skillId: String(row.skill_id),
            total: Number(row.total ?? 0),
            success: Number(row.success ?? 0),
            failure: Number(row.failure ?? 0),
            reliabilityPct: Number(row.reliability_pct ?? 0),
            latestEventAt: row.latest_event_at ? new Date(row.latest_event_at).toISOString() : null,
            linkedRunCount: Number(row.linked_run_count ?? 0),
            unlinkedEventCount: Number(row.unlinked_event_count ?? 0),
            latestMissionRunId: row.latest_mission_run_id == null ? null : Number(row.latest_mission_run_id),
        }));
    }

    /**
     * Triggers an autonomous evolution cycle for a specific skill.
     * This creates a 'Sentinel Insight' and starts the Autoresearch loop.
     */
    static async triggerAutoresearch(skillId: string, missionRunId: number) {
        const health = await this.getSkillHealth(skillId);
        const insight = `Autonomous Evolution Triggered: Skill ${skillId} health at ${health.reliabilityIndex}%. Initiating Autoresearch Phase 2 (Shadow Experiments).`;
        
        await this.logInsight(missionRunId, insight, {
            skillId,
            reliabilityIndex: health.reliabilityIndex,
            avgLatencyMs: health.avgLatencyMs,
            totalRuns: health.totalRuns,
            action: "trigger_autoresearch"
        });

        // Trigger the Autoresearch Service (asynchronously)
        try {
            const { autoresearchService } = await import("../../mission/core/autoresearch.service.js");
            // Note: We don't await this to keep the telemetry loop fast
            autoresearchService.initiateEvolution(skillId, missionRunId).catch(err => {
                console.error(`[SentinelService] Autoresearch initiation failed for skill ${skillId}: ${err.message}`);
            });
        } catch (err: any) {
            console.error(`[SentinelService] Failed to load AutoresearchService: ${err.message}`);
        }
    }

    /**
     * Aggregates ecosystem-wide health metrics for the Sentinel dashboard.
     */
    static async getEcosystemSummary() {
        const stats = await db.execute(sql`
            SELECT 
                COUNT(DISTINCT attributes->>'skillId') as total_monitored,
                AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100 as avg_reliability,
                COUNT(CASE WHEN status = 'failure' THEN 1 END) as total_recent_failures
            FROM forensic_event_log
            WHERE job_type = 'uci_skill_execution'
              AND created_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
        `);

        const candidates = await this.getEvolutionCandidates(70);
        
        const statsRows = Array.isArray(stats) ? stats : ((stats as any).rows ?? []);
        return {
            totalMonitored: Number((statsRows as any[])[0]?.total_monitored || 0),
            avgReliability: Math.round(Number((statsRows as any[])[0]?.avg_reliability || 100)),
            totalRecentFailures: Number((statsRows as any[])[0]?.total_recent_failures || 0),
            evolutionCandidatesCount: candidates.length
        };
    }
}


