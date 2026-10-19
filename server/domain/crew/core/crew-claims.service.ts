import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    crewClaims,
    type CrewClaimPosition,
    type CrewClaimRecord,
    type CrewTurnRecord,
} from "@shared/schema/index.js";
import type { SupervisorOutput } from "./crew-supervisor.service.js";

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "with"]);

export function normalizeClaim(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): Set<string> {
    return new Set(normalizeClaim(value).split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word)));
}

export function claimSimilarity(a: string, b: string): number {
    const negative = /\b(no|not|never|without|exclude|reject|delay|stop|avoid)\b/i;
    if (negative.test(a) !== negative.test(b)) return 0;
    const left = tokens(a);
    const right = tokens(b);
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return (2 * shared) / (left.size + right.size);
}

export interface AssessedClaim {
    claim: string;
    confidence: number;
    agreementLevel: number;
    status: "unverified" | "supported" | "disputed";
    sourceTurnId: number | null;
    evidence: Array<{ label: string; retrievedAt?: string; excerpt?: string }>;
    positions: CrewClaimPosition[];
}

/** Converts the supervisor's positions into auditable, claim-level consensus. */
export function assessClaimPositions(
    positions: SupervisorOutput["positions"],
    turns: CrewTurnRecord[],
): AssessedClaim[] {
    const valid = positions
        .filter((p) => p.agent.trim() && p.proposition.trim().length >= 8)
        .slice(0, 12);
    const clusters: typeof valid[] = [];
    for (const position of valid) {
        const cluster = clusters.find((candidate) => claimSimilarity(candidate[0].proposition, position.proposition) >= 0.72);
        if (cluster) cluster.push(position);
        else if (clusters.length < 8) clusters.push([position]);
    }
    const agents = [...new Set(valid.map((p) => p.agent.toLowerCase()))];
    return clusters.map((cluster) => {
        const supporters = new Set(cluster.map((p) => p.agent.toLowerCase()));
        const matchingTurns = turns.filter((turn) =>
            turn.speakerType === "agent" && supporters.has(turn.speakerName.toLowerCase()),
        );
        const evidence = matchingTurns.flatMap((turn) =>
            (turn.toolsUsed ?? []).filter((tool) => tool.ok).map((tool) => ({
                label: `${turn.speakerName} · ${tool.name}`,
                ...(turn.createdAt ? { retrievedAt: new Date(turn.createdAt).toISOString() } : {}),
                excerpt: turn.content.slice(0, 240),
            })),
        ).slice(0, 12);
        const agreementLevel = agents.length ? Math.round((supporters.size / agents.length) * 100) : 0;
        const claimPositions: CrewClaimPosition[] = valid.map((p) => ({
            agent: p.agent,
            stance: supporters.has(p.agent.toLowerCase()) ? "support" : "dissent",
            confidence: Math.round(Math.max(0, Math.min(1, p.confidence)) * 100),
            proposition: p.proposition,
        }));
        const confidence = Math.round(cluster.reduce((sum, p) => sum + Math.max(0, Math.min(1, p.confidence)), 0) / cluster.length * 100);
        return {
            claim: cluster[0].proposition.trim().slice(0, 1000),
            confidence,
            agreementLevel,
            status: clusters.length > 1 ? "disputed" : evidence.length ? "supported" : "unverified",
            sourceTurnId: matchingTurns[0]?.id ?? null,
            evidence,
            positions: claimPositions,
        };
    });
}

export class CrewClaimsService {
    async persistSupervisorClaims(params: {
        sessionId: number;
        organizationId: number;
        output: SupervisorOutput;
        turns: CrewTurnRecord[];
    }): Promise<CrewClaimRecord[]> {
        const assessed = assessClaimPositions(params.output.positions, params.turns);
        if (!assessed.length) return [];
        const existing = await db.select().from(crewClaims).where(and(
            eq(crewClaims.sessionId, params.sessionId),
            eq(crewClaims.organizationId, params.organizationId),
        ));
        const saved: CrewClaimRecord[] = [];
        for (const claim of assessed) {
            const prior = existing.find((row) => claimSimilarity(row.claim, claim.claim) >= 0.82);
            if (prior) {
                const [updated] = await db.update(crewClaims).set({
                    ...claim,
                    evidence: [...(prior.evidence ?? []), ...claim.evidence].slice(-20),
                    updatedAt: new Date(),
                }).where(eq(crewClaims.id, prior.id)).returning();
                if (updated) saved.push(updated);
            } else {
                const [created] = await db.insert(crewClaims).values({
                    sessionId: params.sessionId,
                    organizationId: params.organizationId,
                    ...claim,
                    createdBy: "supervisor",
                }).returning();
                if (created) saved.push(created);
            }
        }
        return saved;
    }
}

export const crewClaimsService = new CrewClaimsService();
