/**
 * Automation-level rollup for outbound sends — the "how much is acting on its
 * own" number an admin actually wants.
 *
 * Three buckets, read from ground truth rather than inferred from prose:
 *
 *   fully_automated   — a send tool executed and delivered with no review
 *                       (crew_turns.tools_used ok:true on a send_* name)
 *   semi_automated    — the send went through a review card
 *                       (propose_outbound_message rows + their sendResult)
 *   blocked           — a send the agent's boundary refused outright
 *                       (tools_used ok:false marked "blocked by agent…")
 *
 * proposals are read from approval_requests.toolArgs — the send contract —
 * and direct sends from crew_turns.tools_used via a jsonb fan-out, both
 * scoped to the organization. Nothing here reads message bodies.
 */

const SEND_TOOL_NAMES = ["send_email", "send_agentmail", "gmail_send", "reply_agentmail", "slack_post_message"] as const;

export interface OutboundAutomationSummary {
    periodDays: number;
    totals: {
        fullyAutomated: number;
        semiAutomated: number;
        blocked: number;
        /** Proposals still waiting on a decision — in flight, not yet either bucket. */
        pendingReview: number;
    };
    proposals: {
        total: number;
        pending: number;
        sent: number;
        discarded: number;
        sendFailed: number;
        byChannel: Record<string, number>;
    };
    direct: { sends: number; failures: number; byTool: Record<string, number> };
    /** Turn counts by classified work type (crew_turns.work_type). */
    workTypes: Record<string, number>;
    byAgent: Array<{
        agentCardId: number | null;
        fullyAutomated: number;
        semiAutomated: number;
        blocked: number;
    }>;
}

export const outboundAnalyticsService = {
    async summary(organizationId: number, periodDays = 30): Promise<OutboundAutomationSummary> {
        const { db } = await import("@server/database_service.js");
        const { approvalRequests } = await import("@shared/schema/index.js");
        const { and, eq, gte, sql } = await import("drizzle-orm");

        const since = new Date(Date.now() - Math.max(1, periodDays) * 86_400_000);

        // ── Review-card path ────────────────────────────────────────────────
        const proposalRows = await db
            .select({
                status: approvalRequests.status,
                channel: sql<string>`${approvalRequests.toolArgs}->>'channel'`,
                agentCardId: sql<number | null>`(${approvalRequests.toolArgs}->>'agentCardId')::int`,
                sendSent: sql<boolean | null>`(${approvalRequests.toolArgs}->'sendResult'->>'sent')::boolean`,
            })
            .from(approvalRequests)
            .where(and(
                eq(approvalRequests.organizationId, organizationId),
                eq(approvalRequests.toolName, "propose_outbound_message"),
                gte(approvalRequests.createdAt, since),
            ));

        const proposals = { total: proposalRows.length, pending: 0, sent: 0, discarded: 0, sendFailed: 0, byChannel: {} as Record<string, number> };
        for (const row of proposalRows) {
            proposals.byChannel[row.channel ?? "unknown"] = (proposals.byChannel[row.channel ?? "unknown"] ?? 0) + 1;
            if (row.status === "pending") proposals.pending++;
            else if (row.status === "rejected") proposals.discarded++;
            else if (row.sendSent === false) proposals.sendFailed++;
            else proposals.sent++;
        }

        // ── Direct-send path: fan out tools_used, count send-tool entries ────
        // tools_used records carry ok at record level; a blocked send lands as
        // ok:false — separate it from a delivered send by name+ok.
        const directOkRows = await db.execute(sql`
            SELECT
                t.agent_card_id AS "agentCardId",
                e->>'name'      AS "tool",
                CASE WHEN (e->>'ok')::boolean THEN 'ok' ELSE 'failed' END AS "outcome",
                count(*)        AS "count"
            FROM crew_turns t
            CROSS JOIN LATERAL jsonb_array_elements(t.tools_used) e
            WHERE t.organization_id = ${organizationId}
              AND t.created_at >= ${since}
              AND e->>'name' = ANY(${SEND_TOOL_NAMES as unknown as string[]})
            GROUP BY t.agent_card_id, e->>'name', (e->>'ok')::boolean
        `);

        const direct = { sends: 0, failures: 0, byTool: {} as Record<string, number> };
        let blocked = 0;
        const byAgentMap = new Map<number | null, { fullyAutomated: number; semiAutomated: number; blocked: number }>();
        const bump = (cardId: number | null, key: "fullyAutomated" | "semiAutomated" | "blocked", n: number) => {
            const row = byAgentMap.get(cardId) ?? { fullyAutomated: 0, semiAutomated: 0, blocked: 0 };
            row[key] += n;
            byAgentMap.set(cardId, row);
        };

        for (const row of (directOkRows.rows ?? []) as any[]) {
            const n = Number(row.count) || 0;
            direct.byTool[row.tool] = (direct.byTool[row.tool] ?? 0) + n;
            if (row.outcome === "ok") {
                direct.sends += n;
                bump(row.agentCardId, "fullyAutomated", n);
            } else {
                direct.failures += n;
            }
        }

        // Blocked sends are tools_used entries with the boundary error marker —
        // a separate count so a forbidden attempt never masquerades as a send.
        const blockedRows = await db.execute(sql`
            SELECT t.agent_card_id AS "agentCardId", count(*) AS "count"
            FROM crew_turns t
            CROSS JOIN LATERAL jsonb_array_elements(t.tools_used) e
            WHERE t.organization_id = ${organizationId}
              AND t.created_at >= ${since}
              AND e->>'name' = ANY(${SEND_TOOL_NAMES as unknown as string[]})
              AND (e->>'ok')::boolean = false
              AND e->>'error' LIKE 'blocked by agent approval boundary%'
            GROUP BY t.agent_card_id
        `);
        for (const row of (blockedRows.rows ?? []) as any[]) {
            const n = Number(row.count) || 0;
            blocked += n;
            bump(row.agentCardId, "blocked", n);
        }
        // Blocked sends already counted in direct.failures — report them in
        // their own bucket, not twice.
        direct.failures = Math.max(0, direct.failures - blocked);

        for (const row of proposalRows) {
            if (row.status === "pending") continue;
            bump(row.agentCardId, "semiAutomated", 1);
        }

        // ── Work-type mix across all turns in the window ────────────────────
        const workTypeRows = await db.execute(sql`
            SELECT work_type AS "workType", count(*) AS "count"
            FROM crew_turns
            WHERE organization_id = ${organizationId}
              AND created_at >= ${since}
              AND work_type IS NOT NULL
            GROUP BY work_type
        `);
        const workTypes: Record<string, number> = {};
        for (const row of (workTypeRows.rows ?? []) as any[]) {
            workTypes[row.workType] = Number(row.count) || 0;
        }

        const summary: OutboundAutomationSummary = {
            periodDays,
            totals: {
                fullyAutomated: direct.sends,
                semiAutomated: proposals.sent + proposals.sendFailed + proposals.discarded,
                blocked,
                pendingReview: proposals.pending,
            },
            proposals,
            direct,
            workTypes,
            byAgent: [...byAgentMap.entries()]
                .map(([agentCardId, v]) => ({ agentCardId, ...v }))
                .sort((a, b) => (b.fullyAutomated + b.semiAutomated) - (a.fullyAutomated + a.semiAutomated)),
        };
        return summary;
    },
};
