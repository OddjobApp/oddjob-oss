/**
 * Crew Primers Service
 *
 * An empty room is a cold start: the user has a crew assembled and nothing to
 * say to it. These are opening moves curated from what the Project Space has
 * actually been doing, so the suggestions are grounded rather than generic
 * prompt-library filler.
 *
 * Sources, in the order they are worth raising:
 *
 *  1. UPCOMING EVENTS — a deadline or launch a person put on the project
 *     timeline. The only source that knows about something nobody instrumented,
 *     so a room opened three days before a launch says so first.
 *  2. UNRESOLVED ISSUES — the crew looked at something and could not agree.
 *     The strongest possible opener: a known, recorded disagreement.
 *  3. IDENTIFIED INTENTS — threads a previous supervisor explicitly said the
 *     group should explore but never did. Already phrased as questions.
 *  4. ACTIVE CYCLES — work currently in flight in this project.
 *  5. PROJECT OBJECTIVE — the fallback for a project with no history yet.
 *
 * Everything is deduped against what the current room has already discussed, so
 * a primer never suggests reopening the conversation you just had.
 */

import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    crewIssues,
    crewSessions,
    crewTurns,
    operationalCycles,
    cycleBlueprints,
    projects,
    projectEvents,
    supervisorNotes,
} from "@shared/schema/index.js";
import {
    DIVERSE_TOPIC_DEFINITIONS,
    type DiverseTopicArchetype,
    type DiverseTopicDefinition,
} from "@domain/ai/core/good-question-engine.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewPrimersService");

export type PrimerSource = "issue" | "intent" | "cycle" | "objective" | "event" | "creation_studio" | "topic_archetype";

export interface CrewPrimer {
    /** Short button text. */
    label: string;
    /** The message actually sent when chosen. */
    prompt: string;
    source: PrimerSource;
    /** Why this is being suggested, shown under the label. */
    sourceLabel: string;
}

const MAX_PRIMERS = 5;

/** Same ladder the signal tables use, so authored and observed urgency compare. */
const EVENT_SEVERITY_RANK: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

/** How far ahead an authored event is still worth opening a room about. */
const UPCOMING_EVENT_HORIZON_DAYS = 30;

/** Trims to a clean button label without cutting mid-word. */
function toLabel(text: string, max = 72): string {
    const clean = text.replace(/^Unresolved:\s*/i, "").replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Loose overlap check so a primer is not suggested for what was just discussed. */
function alreadyCovered(candidate: string, discussed: string): boolean {
    const words = candidate
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4);
    if (words.length === 0) return false;

    const hits = words.filter((w) => discussed.includes(w)).length;
    // Most of the distinctive words already present means the room covered it.
    return hits / words.length > 0.7;
}

export class CrewPrimersService {
    /**
     * Resolves whether the current session is bound to an active cycle or stage ceremony.
     */
    async resolveCycleContext(orgId: number, sessionKey?: string) {
        if (!sessionKey) return null;
        const [session] = await db
            .select()
            .from(crewSessions)
            .where(
                and(eq(crewSessions.organizationId, orgId), eq(crewSessions.sessionKey, sessionKey)),
            )
            .limit(1);

        if (!session) return null;

        const cycleContext = (session.cycleContext as any) || {};
        const cycleSlug = session.cycleSlug || cycleContext.cycleSlug;
        const cycleStageId = session.cycleStageId || cycleContext.stageId;
        const requiredDecisions = cycleContext.requiredDecisions || [];
        const fleetApps = cycleContext.fleetApps || [];
        const cycleName = cycleContext.cycleName || session.title || "Operational Cycle";
        const stageName = cycleContext.stageName || session.activeTopic || cycleStageId || "Stage Ceremony";

        if (!cycleSlug && !cycleStageId && !cycleContext.cycleName) {
            return null;
        }

        // Find matching cycle in DB
        let cycle = null;
        const cycles = await db
            .select()
            .from(operationalCycles)
            .where(eq(operationalCycles.organizationId, orgId));

        if (cycles.length > 0) {
            cycle = cycles.find((c) => {
                if (cycleContext.cycleId && c.id === cycleContext.cycleId) return true;
                if (cycleSlug && (c.metadata as any)?.slug === cycleSlug) return true;
                if (cycleName && c.name.toLowerCase() === cycleName.toLowerCase()) return true;
                if (cycleSlug && c.name.toLowerCase().includes(cycleSlug.replace(/-/g, " "))) return true;
                return false;
            }) || cycles[0];
        }

        // Find cycle blueprints
        let blueprints: any[] = [];
        if (cycle) {
            blueprints = await db
                .select()
                .from(cycleBlueprints)
                .where(eq(cycleBlueprints.cycleId, cycle.id));
        }

        return {
            session,
            cycleSlug,
            cycleStageId,
            requiredDecisions,
            fleetApps,
            cycleName,
            stageName,
            cycle,
            blueprints,
        };
    }

    /**
     * Curates opening moves and intents grounded strictly in the active Cycle and Stage.
     */
    private async fromCycleStage(
        cycleInfo: NonNullable<Awaited<ReturnType<typeof this.resolveCycleContext>>>,
    ): Promise<CrewPrimer[]> {
        const primers: CrewPrimer[] = [];

        // 1. Stage Gate Decisions (Top Priority)
        for (const decision of cycleInfo.requiredDecisions) {
            primers.push({
                label: toLabel(`Gate Decision: ${decision}`),
                prompt: `Let's deliberate on the required stage gate decision: "${decision}". What is our consensus, and do we approve?`,
                source: "cycle",
                sourceLabel: `${cycleInfo.stageName} · Gate Decision`,
            });
        }

        // 2. Stage Blueprints / Missions
        const relevantBlueprints = cycleInfo.blueprints.filter((b) => {
            const ceremonyStage =
                (b.metadata as any)?.ceremony?.stageId || (b.config as any)?.ceremony?.stageId;
            if (ceremonyStage && ceremonyStage === cycleInfo.cycleStageId) return true;
            return true;
        });

        for (const b of relevantBlueprints.slice(0, 3)) {
            primers.push({
                label: toLabel(`Execute Blueprint: ${b.name}`),
                prompt: `Let's coordinate on stage blueprint "${b.name}" (Objective: ${b.objective}). What are our inputs, risks, and next actions?`,
                source: "cycle",
                sourceLabel: `Stage Blueprint · Wave ${b.waveIndex ?? 0}`,
            });
        }

        // 3. Connected Workbench Apps
        for (const app of cycleInfo.fleetApps.slice(0, 2)) {
            const appName = typeof app === "string" ? app : app.name || app.title || "Workbench App";
            primers.push({
                label: toLabel(`Inspect Deliverables in ${appName}`),
                prompt: `Let's inspect the active deliverables and metrics in "${appName}". Are all stage criteria met?`,
                source: "creation_studio",
                sourceLabel: "Connected Workbench",
            });
        }

        // 4. Active Cycle Risk & Governance Triage
        if (cycleInfo.cycle) {
            primers.push({
                label: toLabel(`Triage Risks for ${cycleInfo.cycle.name}`),
                prompt: `The "${cycleInfo.cycle.name}" cycle is active (${cycleInfo.cycle.objective}). Let's verify stage readiness, budget limits ($${cycleInfo.cycle.budgetLimitUsd}), and resolve any open blockers.`,
                source: "cycle",
                sourceLabel: "Active Cycle · Governance",
            });
        }

        // 5. Unresolved issues strictly within this room / stage
        const roomIssues = await db
            .select({ title: crewIssues.title, severity: crewIssues.severity })
            .from(crewIssues)
            .where(
                and(eq(crewIssues.sessionId, cycleInfo.session.id), eq(crewIssues.status, "open")),
            )
            .orderBy(desc(crewIssues.id))
            .limit(2);

        for (const issue of roomIssues) {
            const subject = issue.title.replace(/^Unresolved:\s*/i, "").trim();
            primers.push({
                label: toLabel(subject),
                prompt: `We previously discussed this stage issue without reaching agreement: "${subject}". Let's settle it.`,
                source: "issue",
                sourceLabel: `Stage Blocker · ${issue.severity} severity`,
            });
        }

        return primers;
    }

    /**
     * Opening moves for a room.
     *
     * @param sessionKey When given, primers are filtered against that room's
     *                   existing transcript and grounded in its Cycle context if present.
     */
    async build(params: {
        orgId: number;
        projectId: number | null;
        sessionKey?: string;
    }): Promise<CrewPrimer[]> {
        const { orgId, projectId, sessionKey } = params;

        try {
            const discussed = sessionKey ? await this.discussedText(orgId, sessionKey) : "";
            const primers: CrewPrimer[] = [];
            const seen = new Set<string>();

            const add = (p: CrewPrimer) => {
                const key = p.label.toLowerCase();
                if (seen.has(key)) return;
                if (discussed && alreadyCovered(p.label, discussed)) return;
                seen.add(key);
                primers.push(p);
            };

            // Dedicated Cycle Room: Ground primers exclusively in the Cycle & Stage context
            const cycleInfo = sessionKey ? await this.resolveCycleContext(orgId, sessionKey) : null;
            if (cycleInfo) {
                const cyclePrimers = await this.fromCycleStage(cycleInfo);
                for (const p of cyclePrimers) add(p);
                if (primers.length > 0) {
                    return primers.slice(0, MAX_PRIMERS);
                }
            }

            for (const p of await this.fromUpcomingEvents(orgId, projectId)) add(p);
            for (const p of await this.fromIssues(orgId, projectId)) add(p);
            for (const p of await this.fromIntents(orgId, projectId)) add(p);
            for (const p of await this.fromCycles(orgId, projectId)) add(p);
            for (const p of this.fromCreationStudio()) add(p);

            if (primers.length === 0) {
                for (const p of await this.fromObjective(orgId, projectId)) add(p);
            }

            return primers.slice(0, MAX_PRIMERS);
        } catch (err) {
            // A cold-start affordance must never break opening a room.
            logger.warn(
                `Failed to build primers: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
        }
    }

    /** Everything said in this room, lowercased, for overlap comparison. */
    private async discussedText(orgId: number, sessionKey: string): Promise<string> {
        const [session] = await db
            .select({ id: crewSessions.id })
            .from(crewSessions)
            .where(
                and(eq(crewSessions.organizationId, orgId), eq(crewSessions.sessionKey, sessionKey)),
            )
            .limit(1);

        if (!session) return "";

        const turns = await db
            .select({ content: crewTurns.content })
            .from(crewTurns)
            .where(eq(crewTurns.sessionId, session.id))
            .limit(60);

        return turns
            .map((t) => t.content)
            .join(" ")
            .toLowerCase();
    }

    /** Disagreements the crew recorded but never settled. */
    private async fromIssues(orgId: number, projectId: number | null): Promise<CrewPrimer[]> {
        const rows = await db
            .select({ title: crewIssues.title, severity: crewIssues.severity })
            .from(crewIssues)
            .where(
                projectId === null
                    ? and(eq(crewIssues.organizationId, orgId), eq(crewIssues.status, "open"))
                    : and(
                          eq(crewIssues.organizationId, orgId),
                          eq(crewIssues.status, "open"),
                          eq(crewIssues.projectId, projectId),
                      ),
            )
            .orderBy(desc(crewIssues.id))
            .limit(3);

        return rows.map((r) => {
            const subject = r.title.replace(/^Unresolved:\s*/i, "").trim();
            return {
                label: toLabel(subject),
                prompt: `We previously discussed this without reaching agreement: "${subject}" Let's settle it — what would change someone's mind?`,
                source: "issue" as const,
                sourceLabel: `Unresolved · ${r.severity} severity`,
            };
        });
    }

    /**
     * Threads a previous supervisor said the group should explore. These are
     * already phrased as questions, so they need no rewriting.
     */
    private async fromIntents(orgId: number, projectId: number | null): Promise<CrewPrimer[]> {
        const sessionFilter =
            projectId === null
                ? eq(crewSessions.organizationId, orgId)
                : and(eq(crewSessions.organizationId, orgId), eq(crewSessions.projectId, projectId));

        const rows = await db
            .select({ content: supervisorNotes.content })
            .from(supervisorNotes)
            .innerJoin(crewSessions, eq(supervisorNotes.sessionId, crewSessions.id))
            .where(and(eq(supervisorNotes.noteType, "intent"), sessionFilter))
            .orderBy(desc(supervisorNotes.id))
            .limit(12);

        return rows.map((r) => ({
            label: toLabel(r.content),
            prompt: r.content.trim(),
            source: "intent" as const,
            sourceLabel: "Raised earlier, never explored",
        }));
    }

    /** Work currently in flight in this project. */
    private async fromCycles(orgId: number, projectId: number | null): Promise<CrewPrimer[]> {
        if (projectId === null) return [];

        const rows = await db
            .select({ name: operationalCycles.name, objective: operationalCycles.objective })
            .from(operationalCycles)
            .where(
                and(
                    eq(operationalCycles.organizationId, orgId),
                    eq(operationalCycles.projectId, projectId),
                    eq(operationalCycles.status, "active"),
                ),
            )
            .orderBy(desc(operationalCycles.id))
            .limit(3);

        return rows.map((r) => ({
            label: toLabel(`Risks and blockers in ${r.name}`),
            prompt:
                `The "${r.name}" cycle is currently active${r.objective ? `, aiming to: ${r.objective}` : ""}. ` +
                `What are the biggest risks or blockers, and what should we do about them?`,
            source: "cycle" as const,
            sourceLabel: "Active cycle",
        }));
    }

    /**
     * What the project has coming up, from the timeline a person authored.
     *
     * The other sources describe what the platform observed; this is the only
     * one that knows about a deadline nobody has instrumented. A room opened
     * three days before a launch should say so before it says anything else,
     * which is why this is placed ahead of cycles in the ordering.
     *
     * Only forward-looking events, and only within a horizon: an agent asking
     * "what should we do about the thing that happened last quarter" is noise,
     * and so is one asking about a milestone eight months out.
     */
    private async fromUpcomingEvents(orgId: number, projectId: number | null): Promise<CrewPrimer[]> {
        if (projectId === null) return [];

        const now = new Date();
        const horizon = new Date(now.getTime() + UPCOMING_EVENT_HORIZON_DAYS * 24 * 60 * 60 * 1000);

        const rows = await db
            .select({
                title: projectEvents.title,
                description: projectEvents.description,
                kind: projectEvents.kind,
                severity: projectEvents.severity,
                startsAt: projectEvents.startsAt,
            })
            .from(projectEvents)
            .where(
                and(
                    eq(projectEvents.organizationId, orgId),
                    eq(projectEvents.projectId, projectId),
                    gte(projectEvents.startsAt, now),
                    lte(projectEvents.startsAt, horizon),
                ),
            )
            .orderBy(projectEvents.startsAt)
            .limit(12);

        // Ordered by severity first, then by how soon.
        //
        // The timeline itself is read purely by date, but a primer answers a
        // different question — what is worth opening the room about — and there
        // a Critical deadline three days out beats a routine note tomorrow.
        // Sorting only by date let the nearest trivial item crowd out the one
        // that mattered.
        const ranked = [...rows].sort((a, b) => {
            const bySeverity =
                (EVENT_SEVERITY_RANK[b.severity] ?? 0) - (EVENT_SEVERITY_RANK[a.severity] ?? 0);
            return bySeverity !== 0 ? bySeverity : a.startsAt.getTime() - b.startsAt.getTime();
        }).slice(0, 3);

        return ranked.map((r) => {
            const days = Math.max(0, Math.round((r.startsAt.getTime() - now.getTime()) / 86_400_000));
            const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

            return {
                label: toLabel(`Prepare for ${r.title}`),
                prompt:
                    `The ${r.kind} "${r.title}" is ${when}` +
                    `${r.severity === "Critical" || r.severity === "High" ? ` and is marked ${r.severity} severity` : ""}.` +
                    `${r.description ? ` Context: ${r.description}` : ""} ` +
                    `What should we have ready, and what is most likely to go wrong?`,
                source: "event" as const,
                sourceLabel: `Upcoming ${r.kind}`,
            };
        });
    }

    /** Fallback for a project with no discussion history. */
    private async fromObjective(orgId: number, projectId: number | null): Promise<CrewPrimer[]> {
        if (projectId === null) return [];

        const [project] = await db
            .select({ name: projects.name, objective: projects.objective })
            .from(projects)
            .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
            .limit(1);

        if (!project?.objective) return [];

        return [
            {
                label: toLabel(`How should we approach ${project.name}?`),
                prompt: `This project's objective is: ${project.objective}. What is the best way to approach it, and what are we most likely to get wrong?`,
                source: "objective" as const,
                sourceLabel: "Project objective",
            },
        ];
    }

    /** Proactive Creation Studio assembly starter intents. */
    private fromCreationStudio(): CrewPrimer[] {
        return [
            {
                label: "Assemble a new Operational Cycle or Pipeline",
                prompt: "I want to build a new governed operational cycle from the component library with pipeline steps, agent roster, and HIL approval gates. Guide me through the Creation Studio.",
                source: "creation_studio" as const,
                sourceLabel: "Creation Studio · Adaptive Assembly",
            },
            {
                label: "Build an Automated Incident Remediation Cycle",
                prompt: "Build an automated incident remediation cycle with webhook ingestion, AI sentiment analysis, SOC2 approval gate, and Slack alert dispatch.",
                source: "creation_studio" as const,
                sourceLabel: "Creation Studio · Operational Pattern",
            },
            {
                label: "Design an Autonomous Knowledge Pipeline",
                prompt: "Create an autonomous knowledge ingestion pipeline with pgvector table clustering, forensic audit logging, and OpenTelemetry tracing.",
                source: "creation_studio" as const,
                sourceLabel: "Creation Studio · Data & Telemetry",
            },
        ];
    }

    /** Returns the structured Goal Topic Archetypes, calibrated for Cycle Context when available */
    getTopicArchetypes(cycleContext?: {
        cycleName?: string;
        stageName?: string;
    }): DiverseTopicDefinition[] {
        // Only surface the core playbooks in the cold-room opener grid.
        // The full DIVERSE_TOPIC_DEFINITIONS set stays intact for GQE intent
        // routing, but advanced/expert playbooks (ontology, pipelines, governance,
        // incidents, datasets) don't need to crowd the initial card grid.
        const CORE_PLAYBOOK_IDS = new Set([
            "presentation_deck_studio",
            "write_document",
            // Opens Media Studio. Defined in DIVERSE_TOPIC_DEFINITIONS but invisible until listed here.
            "film_production",
            "build_app",
            "research_topic",
            "analytical_report",
            "agent_roster",
            "signal_intelligence",
        ]);
        const base = Object.values(DIVERSE_TOPIC_DEFINITIONS).filter(
            (t) => CORE_PLAYBOOK_IDS.has(t.id),
        );
        if (!cycleContext?.cycleName && !cycleContext?.stageName) {
            return base;
        }

        const cycleName = cycleContext.cycleName || "Cycle";
        const stageName = cycleContext.stageName || cycleName;

        return base.map((topic) => {
            switch (topic.id) {
                case "presentation_deck_studio":
                    return {
                        ...topic,
                        label: `Generate ${stageName} Brief & RFC`,
                        description: `Assemble technical RFCs, stage briefing decks, and executive summaries for ${cycleName}.`,
                        defaultDirection: `Synthesize comprehensive technical design RFC and stage deliverables for ${stageName}`,
                    };
                case "build_app":
                    return {
                        ...topic,
                        label: `Assemble ${stageName} Scaffolds`,
                        description: `Orchestrate stage missions, HIL governance gates, and instant app surfaces for ${cycleName}.`,
                        defaultDirection: `Assemble automated operational stage workflows and UI pods for ${cycleName}`,
                    };
                case "governance_audit":
                    return {
                        ...topic,
                        label: `Stage Gate & Compliance Sign-off`,
                        description: `Perform SOC2 compliance checks, blast-radius verification, and gate approval for ${stageName}.`,
                        defaultDirection: `Conduct stage gate approval and security audit for ${stageName}`,
                    };
                case "workstreams_pipeline":
                    return {
                        ...topic,
                        label: `${stageName} DAG & Pipelines`,
                        description: `Execute stage automated step sequencers, webhook triggers, and deployment gates.`,
                        defaultDirection: `Design automated execution pipeline and step triggers for ${stageName}`,
                    };
                case "analytical_report":
                    return {
                        ...topic,
                        label: `Value Stream & Stage KPI Report`,
                        description: `Evaluate stage lead times, cycle token spend vs budget limits, and deployment frequency.`,
                        defaultDirection: `Generate value stream analytics and stage metric evaluation for ${cycleName}`,
                    };
                case "incident_remediation":
                    return {
                        ...topic,
                        label: `Incident War Room & Hotfix`,
                        description: `Diagnose telemetry anomalies, execute auto-recovery, and author RCA post-mortems for ${cycleName}.`,
                        defaultDirection: `Execute telemetry alert diagnosis and automated mitigation cycle for ${cycleName}`,
                    };
                case "agent_roster":
                    return {
                        ...topic,
                        label: `Calibrate Stage Agent Roster`,
                        description: `Configure agent personas, model tiers, and tool capabilities for this stage ceremony.`,
                        defaultDirection: `Configure specialized agent fleet and tool capabilities for ${stageName}`,
                    };
                case "signal_intelligence":
                    return {
                        ...topic,
                        label: `${stageName} Signal Radar & Triage`,
                        description: `Ingest telemetry signals, evaluate spatial asset exposure, and coordinate mitigation playbooks for ${cycleName}.`,
                        defaultDirection: `Ingest market signals, evaluate spatial exposure footprints, and coordinate mitigation playbooks for ${stageName}`,
                    };
                default:
                    return topic;
            }
        });
    }
}

export const crewPrimersService = new CrewPrimersService();
