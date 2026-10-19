import { db } from "../../../database_service.js";
import {
    crewSessions,
    crewMembers,
    crewTurns,
    crewDecisions,
    agentCards,
    apps,
    appDeployments,
    operationalCycles,
    type CrewCycleContext,
} from "@shared/schema/index.js";
import { eq, and, desc, inArray } from "drizzle-orm";

// The schema exports the TABLE (`crewSessions`), not a `CrewSession` row type.
// Derive it rather than importing a name that does not exist.
type CrewSession = typeof crewSessions.$inferSelect;
import { createLogger } from "../../../utils/logger.js";
import { BadRequestError, NotFoundError } from "../../../utils/errors.js";

const logger = createLogger("CrewCycleBridgeService");

export interface CycleFleetAppItem {
    id: number;
    appId: number;
    title: string;
    description: string | null;
    slug: string;
    publicSlug: string;
    publicPath: string;
    status: string;
    isLive: boolean;
    stage?: string | null;
    blueprint?: string | null;
}

export class CrewCycleBridgeService {
    /**
     * Resolves the app fleet surfaces for a given cycle-linked CREW room.
     */
    static async getCycleFleetForRoom(orgId: number, sessionKey: string): Promise<{
        cycleSlug: string | null;
        cycleName: string | null;
        stageId: string | null;
        stageName: string | null;
        apps: CycleFleetAppItem[];
    }> {
        const [session] = await db.select()
            .from(crewSessions)
            .where(
                and(
                    eq(crewSessions.organizationId, orgId),
                    eq(crewSessions.sessionKey, sessionKey)
                )
            )
            .limit(1);

        if (!session) {
            throw new NotFoundError(`CREW session "${sessionKey}" not found in organization ${orgId}`);
        }

        const cycleSlug = session.cycleSlug || session.cycleContext?.cycleSlug || null;
        const cycleName = session.cycleContext?.cycleName || cycleSlug || "Operational Cycle";
        const stageId = session.cycleStageId || session.cycleContext?.stageId || null;
        const stageName = session.cycleContext?.stageName || stageId || null;

        if (!cycleSlug) {
            return {
                cycleSlug: null,
                cycleName: null,
                stageId: null,
                stageName: null,
                apps: [],
            };
        }

        // Find all deployed apps in the organization
        const rows = await db.select({
            deployment: appDeployments,
            app: apps,
        })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(appDeployments.organizationId, orgId));

        const matchedApps: CycleFleetAppItem[] = [];

        const cycleTokens = (value: string) => new Set(
            value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token && !["oddjob", "enterprise", "ai"].includes(token))
        );
        const requestedTokens = cycleTokens(cycleSlug);
        const matchesCycleAlias = (candidate: string | null | undefined) => {
            if (!candidate) return false;
            const normalizedCandidate = candidate.toLowerCase();
            if (normalizedCandidate === cycleSlug.toLowerCase()) return true;
            const candidateTokens = cycleTokens(candidate);
            return requestedTokens.size > 0 && [...requestedTokens].every((token) => candidateTokens.has(token));
        };

        for (const { deployment, app } of rows) {
            const rawConfig = (deployment.config as any) || (app.config as any) || {};
            const cycleMeta = rawConfig.cycleApp || {};
            const appBlueprint = cycleMeta.blueprint || (app as any).blueprintSlug || (app as any).blueprint || null;
            const srcCycle = cycleMeta.sourceCycleSlug || cycleMeta.sourceCycleName || null;

            const isMatch =
                matchesCycleAlias(srcCycle) ||
                (appBlueprint && appBlueprint.toLowerCase().includes(cycleSlug.toLowerCase())) ||
                app.slug.toLowerCase().includes(cycleSlug.toLowerCase()) ||
                (deployment.publicSlug && deployment.publicSlug.toLowerCase().includes(cycleSlug.toLowerCase()));

            if (isMatch) {
                const isLive = Boolean(
                    deployment.isPublished ||
                    ["active", "installed", "deployed", "running"].includes(String(deployment.status ?? "").toLowerCase())
                );
                const publicPath = `/app/${deployment.publicSlug || app.slug}?embed=cycle`;

                matchedApps.push({
                    id: deployment.id,
                    appId: app.id,
                    title: deployment.title || app.name,
                    description: deployment.description || app.description,
                    slug: app.slug,
                    publicSlug: deployment.publicSlug || app.slug,
                    publicPath,
                    status: deployment.status || "active",
                    isLive,
                    stage: cycleMeta.stage || null,
                    blueprint: appBlueprint,
                });
            }
        }

        return {
            cycleSlug,
            cycleName,
            stageId,
            stageName,
            apps: matchedApps,
        };
    }

    /**
     * Provisions or convenes a CREW room dedicated to a Cycle Stage or Ceremony.
     */
    static async createCycleStageRoom(orgId: number, params: {
        cycleSlug: string;
        cycleName?: string;
        stageId?: string;
        stageName?: string;
        title?: string;
        topic?: string;
        rosterAgentCardIds?: number[];
        requiredDecisions?: string[];
        parentSessionKey?: string;
        isStandingRoom?: boolean;
        createdBy?: string;
    }): Promise<{ session: CrewSession; sessionKey: string; fleetApps: CycleFleetAppItem[]; url: string }> {
        const stageSuffix = params.stageId ? `-${params.stageId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
        const sessionKey = `crew-cycle-${params.cycleSlug.toLowerCase()}${stageSuffix}-${Date.now().toString(36)}`;
        const title = params.title || `${params.cycleName || params.cycleSlug} — ${params.stageName || params.stageId || "Ceremony Room"}`;

        let parentSessionId: number | undefined;
        if (params.parentSessionKey) {
            const [parent] = await db.select({ id: crewSessions.id })
                .from(crewSessions)
                .where(
                    and(
                        eq(crewSessions.organizationId, orgId),
                        eq(crewSessions.sessionKey, params.parentSessionKey)
                    )
                )
                .limit(1);
            if (parent) parentSessionId = parent.id;
        }

        const cycleContext: CrewCycleContext = {
            cycleSlug: params.cycleSlug,
            cycleName: params.cycleName || params.cycleSlug,
            stageId: params.stageId,
            stageName: params.stageName,
            requiredDecisions: params.requiredDecisions || [],
            isStandingRoom: Boolean(params.isStandingRoom),
        };

        const [session] = await db.insert(crewSessions).values({
            organizationId: orgId,
            sessionKey,
            title,
            mode: "decide",
            activeTopic: params.topic || `Operational Cycle ${params.cycleName || params.cycleSlug}: Stage ${params.stageName || params.stageId || "Review"}`,
            cycleSlug: params.cycleSlug,
            cycleStageId: params.stageId,
            cycleContext,
            parentSessionId,
            createdBy: params.createdBy || "system",
        }).returning();

        // Add roster members if provided
        if (params.rosterAgentCardIds && params.rosterAgentCardIds.length > 0) {
            for (const agentCardId of params.rosterAgentCardIds) {
                await db.insert(crewMembers).values({
                    sessionId: session.id,
                    agentCardId,
                }).onConflictDoNothing();
            }
        }

        // Fetch fleet apps for this cycle
        const { apps: fleetApps } = await this.getCycleFleetForRoom(orgId, sessionKey);

        // Inject initial agenda turn
        const appListing = fleetApps.length > 0
            ? `\n\n**Connected Cycle App Surfaces:**\n${fleetApps.map(a => `- [${a.title}](${a.publicPath}) (${a.status})`).join("\n")}`
            : "";

        const requiredDecisionsListing = params.requiredDecisions && params.requiredDecisions.length > 0
            ? `\n\n**Required Gate Decisions for Consensus:**\n${params.requiredDecisions.map(d => `- [ ] ${d}`).join("\n")}`
            : "";

        await db.insert(crewTurns).values({
            sessionId: session.id,
            organizationId: orgId,
            round: 1,
            speakerType: "supervisor",
            speakerName: "Supervisor (Manager)",
            content: `### 🎯 Operational Cycle Ceremony Initiated\n\nWelcome to the **${title}** session. The council is now in session to deliberate, evaluate live workbench data, and establish consensus.${appListing}${requiredDecisionsListing}`,
            artifacts: [],
            toolsUsed: [],
        });

        logger.info(`Provisioned cycle stage room ${sessionKey} (title: "${title}") for org ${orgId}`);

        return {
            session,
            sessionKey,
            fleetApps,
            url: `/workspace/chat/${sessionKey}`,
        };
    }

    /**
     * Evaluates whether room decisions satisfy the cycle stage gate.
     */
    static async advanceCycleGateOnConsensus(orgId: number, sessionKey: string): Promise<{
        satisfied: boolean;
        approvedDecisions: string[];
        pendingDecisions: string[];
        consensusLevel: number;
    }> {
        const [session] = await db.select()
            .from(crewSessions)
            .where(
                and(
                    eq(crewSessions.organizationId, orgId),
                    eq(crewSessions.sessionKey, sessionKey)
                )
            )
            .limit(1);

        if (!session) throw new NotFoundError("CREW session not found");

        const required = session.cycleContext?.requiredDecisions || [];
        const decisions = await db.select()
            .from(crewDecisions)
            .where(
                and(
                    eq(crewDecisions.sessionId, session.id),
                    eq(crewDecisions.status, "accepted")
                )
            );

        const acceptedTexts = decisions.map(d => (d.statement || "").toLowerCase());
        const approvedDecisions: string[] = [];
        const pendingDecisions: string[] = [];

        for (const req of required) {
            const isApproved = acceptedTexts.some(text => text.includes(req.toLowerCase()) || req.toLowerCase().includes(text));
            if (isApproved) {
                approvedDecisions.push(req);
            } else {
                pendingDecisions.push(req);
            }
        }

        const satisfied = required.length === 0 || pendingDecisions.length === 0;

        return {
            satisfied,
            approvedDecisions,
            pendingDecisions,
            consensusLevel: session.consensusLevel ?? 0,
        };
    }
}
