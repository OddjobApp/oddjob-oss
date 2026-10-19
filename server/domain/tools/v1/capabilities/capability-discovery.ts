import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { requireToolOrgId } from './org-context.js';

/**
 * Capability discovery for the assistant (Slack bot, copilot, agents).
 *
 * Lets the agent enumerate the missions available in the caller's organization
 * together with a plain-language summary of what each does and the inputs it
 * needs — so a natural-language request ("research this GitHub repo") can be
 * matched to the right mission instead of the agent guessing or claiming it
 * can't help. This is the discovery step that makes the platform's mission
 * capabilities legible to the LLM.
 *
 * Reads a mission's structured `capabilityContract` when present (auto-backfilled
 * elsewhere), otherwise derives a summary from its description / objective /
 * expected deliverables — so it works before contracts exist and gets richer
 * once they do.
 */
export const CAPABILITY_DISCOVERY_TOOLS: Record<string, ToolDefinition> = {
    get_crew_readiness: {
        name: 'get_crew_readiness',
        label: 'Check CREW workflow readiness',
        group: 'Discovery',
        idempotency: 'read-safe',
        description: 'Check this speaking agent’s exact offered tools, scoped integration inventory, active applied skill augmentations, Google credentials, QuickBooks configuration and caller finance roles, project bindings and recipe tool gaps. Call before a cross-provider handoff. Configuration and applied skills are not successful execution or skill selection. Only available inside an authorized CREW turn; cannot inspect another room.',
        parameters: z.object({}),
        execute: async (_params, context) => {
            const orgId = requireToolOrgId(context);
            if (typeof context.sessionKey !== 'string' || !Number.isInteger(context.sessionId) || !Number.isInteger(context.agentCardId) || !Array.isArray(context.crewOfferedToolNames) || !context.crewOfferedToolNames.every((name: unknown) => typeof name === 'string')) {
                throw new Error('Readiness requires an executing CREW room and agent context.');
            }
            const { crewRepository } = await import('@domain/crew/core/crew-repository.js');
            const room = await crewRepository.findSession(orgId, context.sessionKey);
            if (!room || room.id !== context.sessionId || room.projectId !== context.projectId) throw new Error('CREW room scope does not match the executing turn.');
            const { getCrewReadiness } = await import('@domain/crew/core/crew-readiness.service.js');
            return JSON.stringify(await getCrewReadiness(room, undefined, context.userId, { id: context.agentCardId, tools: context.crewOfferedToolNames }));
        },
    },
    discover_capabilities: {
        name: "discover_capabilities",

        idempotency: "read-safe",
        label: "Discover Capabilities",
        group: "Discovery",
        description:
            "Discover which Oddjob missions are available to fulfil a request, each with its purpose, when to use it, and the inputs it needs. " +
            "ALWAYS call this before telling a user a request can't be handled, and before launching a mission, so you select the right one. " +
            "Pass `query` (the user's goal in natural language) to rank the most relevant missions first.",
        parameters: z.object({
            query: z
                .string()
                .optional()
                .describe("The user's goal in natural language, e.g. 'research a GitHub repository'. Used to rank relevance."),
            limit: z.number().optional().default(15),
        }),
        execute: async ({ query, limit }: any, context: ToolContext) => {
            try {
                const orgId = context.organizationId || 0;
                const { missionService } = await import("../../../mission/index.js");
                const missions = await missionService.listMissions(orgId);
                const { ODDJOB_CAPABILITIES } = await import("@shared/product/oddjob-capability-manifest.js");

                const describe = (m: any) => {
                    const c = m.capabilityContract;
                    if (c && c.purpose) {
                        return {
                            id: m.id,
                            name: m.name,
                            status: m.status,
                            purpose: c.purpose,
                            whenToUse: c.whenToUse ?? null,
                            inputs: c.inputs ?? [],
                            outputs: c.outputs ?? [],
                            costClass: c.costClass ?? null,
                            contract: "structured",
                        };
                    }
                    // Fallback: derive a usable summary from existing metadata.
                    const deliverables = Array.isArray(m.blackboard?.expected_deliverables)
                        ? m.blackboard.expected_deliverables.map((d: any) => d?.description).filter(Boolean)
                        : [];
                    return {
                        id: m.id,
                        name: m.name,
                        status: m.status,
                        purpose: m.description || m.objective || m.name,
                        whenToUse: m.objective ?? null,
                        inputs: [],
                        outputs: deliverables.map((d: string) => ({ name: d, type: "deliverable" })),
                        costClass: null,
                        contract: "derived",
                    };
                };

                const platformCapabilities = ODDJOB_CAPABILITIES.map((cap) => ({
                    id: `platform-${cap.id}`,
                    name: cap.name,
                    status: "active",
                    purpose: cap.buyerValue,
                    whenToUse: `Use when needing ${cap.name}: ${cap.copilotNextActions.join(" ")}`,
                    inputs: [],
                    outputs: cap.primarySurfaces.map((s) => ({ name: s, type: "surface" })),
                    costClass: "standard",
                    contract: "platform_manifest",
                    implementationSignals: cap.implementationSignals,
                }));

                let items = [...missions.map(describe), ...platformCapabilities];

                // Project Space prior (PROJECT_SPACES_DESIGN §6.4): missions inside the
                // caller's active project rank first. This narrows the candidate set
                // BEFORE keyword ranking, which is a cheaper and more reliable win than
                // adding more tools.
                //
                // A prior, not a filter — out-of-project missions are still returned,
                // just lower. Hard-filtering here would make the agent claim a
                // capability doesn't exist merely because the user's scope was elsewhere.
                let inProject = new Set<number>();
                const projectId = (context as any).projectId ?? null;
                if (projectId) {
                    try {
                        const { db } = await import("@server/database_service.js");
                        const { projectResources } = await import("@shared/schema/projects.js");
                        const { and, eq } = await import("drizzle-orm");
                        const rows = await db
                            .select({ resourceId: projectResources.resourceId })
                            .from(projectResources)
                            .where(and(
                                eq(projectResources.projectId, Number(projectId)),
                                eq(projectResources.resourceType, "mission"),
                            ));
                        inProject = new Set(rows.map((r: any) => r.resourceId));
                    } catch {
                        // No project scope available — org-wide ranking applies unchanged.
                    }
                }

                // Lightweight relevance ranking by keyword overlap when a query is given.
                const terms = typeof query === "string"
                    ? query.toLowerCase().split(/\W+/).filter((t: string) => t.length > 2)
                    : [];

                if (terms.length > 0 || inProject.size > 0) {
                    const score = (it: any) => {
                        const hay = `${it.name} ${it.purpose} ${it.whenToUse ?? ""}`.toLowerCase();
                        const keyword = terms.reduce((s: number, t: string) => s + (hay.includes(t) ? 1 : 0), 0);
                        // Outrank any keyword score so in-project matches lead, while
                        // keyword relevance still orders within each group.
                        const projectBoost = inProject.has(it.id) ? 1000 : 0;
                        return keyword + projectBoost;
                    };
                    items = items
                        .map((it: any) => ({ it, s: score(it) }))
                        .sort((a: any, b: any) => b.s - a.s)
                        .map((x: any) => ({ ...x.it, inActiveProject: inProject.has(x.it.id) || undefined }));
                }

                items = items.slice(0, limit);

                // Augment with semantically-ranked capability manifests from the
                // ACDD vector router. Additive: when the router has no entries for
                // the org, or embeddings/Qdrant are unavailable, this yields an
                // empty list and the mission ranking above applies unchanged.
                let capabilities: any[] = [];
                if (orgId && query && typeof query === "string" && query.trim()) {
                    try {
                        const { capabilityRegistry } = await import(
                            "@domain/capabilities/core/capability-registry.service.js"
                        );
                        const hits = await capabilityRegistry.discover(orgId, query, limit);
                        capabilities = hits.map((h: any) => ({
                            capability_id: h.capabilityId,
                            score: Number(h.score?.toFixed?.(4) ?? h.score),
                            display_name: h.manifest?.metadata?.display_name,
                            category: h.manifest?.metadata?.category,
                            description: h.manifest?.metadata?.description,
                            inputs: h.manifest?.technical_spec?.inputs,
                            guardrails: h.manifest?.documentation_meta?.guardrails,
                            risk_profile: h.manifest?.runtime_context?.risk_profile,
                        }));
                    } catch {
                        // Semantic index unavailable/empty — mission ranking still applies.
                    }
                }
                const capsField = capabilities.length ? { capabilities } : {};

                if (items.length === 0) {
                    return JSON.stringify(
                        {
                            missions: [],
                            ...capsField,
                            note:
                                "No missions are defined in this organization yet. If the user's request needs a capability that doesn't exist, " +
                                "it can be synthesized (subject to approval) — tell the user and offer to propose it.",
                        },
                        null,
                        2,
                    );
                }
                return JSON.stringify({ missions: items, ...capsField }, null, 2);
            } catch (e: any) {
                return `Failed to discover capabilities: ${e.message}`;
            }
        },
    },

    discover_capability_proposals: {
        name: "discover_capability_proposals",

        idempotency: "read-safe",
        label: "Discover Proposed Capabilities",
        group: "Discovery",
        description:
            "List Evolution-discovered capability proposals that are NOT executable. Use this to explain capability gaps and proposed enhancements without presenting them as available capabilities.",
        parameters: z.object({
            query: z.string().optional().describe("Optional outcome or gap to match against pending proposals."),
            limit: z.number().int().min(1).max(50).optional().default(15),
        }),
        execute: async ({ query, limit }: any, context: ToolContext) => {
            const orgId = context.organizationId || 0;
            if (!orgId) return "Error: no organization context; cannot discover capability proposals.";
            const { capabilityProposalService } = await import(
                "@domain/capabilities/core/capability-proposal.service.js"
            );
            let proposals = await capabilityProposalService.list(orgId, "proposed");
            if (query?.trim()) {
                const terms = query.toLowerCase().split(/\W+/).filter((term: string) => term.length > 2);
                proposals = proposals
                    .map((proposal) => {
                        const haystack = `${proposal.title} ${proposal.rationale} ${proposal.proposedCapabilityId}`.toLowerCase();
                        return { proposal, score: terms.reduce((score: number, term: string) => score + (haystack.includes(term) ? 1 : 0), 0) };
                    })
                    .sort((left, right) => right.score - left.score)
                    .map(({ proposal }) => proposal);
            }
            return JSON.stringify({
                proposals: proposals.slice(0, limit).map((proposal) => ({
                    id: proposal.id,
                    capability_id: proposal.proposedCapabilityId,
                    classification: proposal.classification,
                    title: proposal.title,
                    rationale: proposal.rationale,
                    confidence: proposal.confidence,
                    source: proposal.source,
                    similar_capabilities: proposal.similarCapabilities,
                    status: proposal.status,
                    availability: "not_executable_pending_review",
                })),
                note: "Proposals are not executable capabilities. An authorized human must review and promote them.",
            }, null, 2);
        },
    },

    propose_mission: {
        name: "propose_mission",

        idempotency: "idempotent",
        label: "Propose Mission Launch",
        group: "Discovery",
        description:
            "Propose launching a specific mission (by id, obtained from discover_capabilities) to fulfil the user's request. " +
            "This does NOT run the mission — it creates a proposal a human must approve. " +
            "Use this INSTEAD of launch_mission when acting on a conversational request. " +
            "Provide the missionId, a short reason, and any inputs the mission's capability contract requires.",
        parameters: z.object({
            missionId: z.number().describe("The mission to launch (from discover_capabilities)."),
            reason: z.string().describe("Why this mission fulfils the user's request."),
            inputs: z.record(z.any()).optional().describe("Inputs the mission needs, per its capability contract."),
        }),
        execute: async ({ missionId, reason, inputs }: any, context: ToolContext) => {
            try {
                const orgId = context.organizationId || 0;
                if (!orgId) return "Error: no organization context; cannot propose a mission.";
                const { missionProposalService } = await import("../../../mission/core/mission-proposal.service.js");
                const { proposalId, missionName } = await missionProposalService.create({
                    organizationId: orgId,
                    missionId,
                    requestedBy: context.userId || "assistant",
                    reason,
                    inputs,
                    channelId: (context as any).channelId,
                    threadTs: (context as any).threadTs,
                    platform: (context as any).platform,
                });
                // Marker consumed by conversationalBridgeService to render approve/reject buttons.
                return JSON.stringify({
                    type: "mission_proposal",
                    proposalId,
                    missionId,
                    missionName,
                    reason,
                    message: `I've prepared a proposal to launch "${missionName}". It needs your approval before I run it.`,
                });
            } catch (e: any) {
                return `Failed to propose mission: ${e.message}`;
            }
        },
    },

    propose_mission_synthesis: {
        name: "propose_mission_synthesis",

        idempotency: "idempotent",
        label: "Propose Mission Synthesis",
        group: "Discovery",
        description:
            "When discover_capabilities finds NO existing mission that fits the user's request, propose SYNTHESIZING a new one via GMS. " +
            "This does NOT run anything — it creates a proposal a human must approve; on approval a new mission is synthesized and saved as a draft for review. " +
            "Only use this AFTER discover_capabilities returns no suitable match. Provide the user's goal and a short reason.",
        parameters: z.object({
            request: z.string().describe("The user's goal in natural language — what the new mission should accomplish."),
            reason: z.string().describe("Why no existing mission fits and synthesis is warranted."),
        }),
        execute: async ({ request, reason }: any, context: ToolContext) => {
            try {
                const orgId = context.organizationId || 0;
                if (!orgId) return "Error: no organization context; cannot propose synthesis.";
                const { missionProposalService } = await import("../../../mission/core/mission-proposal.service.js");
                const { proposalId } = await missionProposalService.createSynthesis({
                    organizationId: orgId,
                    requestedBy: context.userId || "assistant",
                    request,
                    reason,
                    channelId: (context as any).channelId,
                    threadTs: (context as any).threadTs,
                    platform: (context as any).platform,
                });
                // Marker consumed by conversationalBridgeService to render approve/reject buttons.
                return JSON.stringify({
                    type: "mission_synthesis_proposal",
                    proposalId,
                    request,
                    reason,
                    message: `No existing mission fits, but I can synthesize a new one for: "${request}". This needs your approval.`,
                });
            } catch (e: any) {
                return `Failed to propose mission synthesis: ${e.message}`;
            }
        },
    },

    propose_research_mission: {
        name: "propose_research_mission",

        idempotency: "idempotent",
        label: "Propose Research Mission",
        group: "Discovery",
        description:
            "When you CANNOT answer a user's question from the knowledge base or web search, propose running a RESEARCH MISSION that investigates the question and saves the answer to the organization's knowledge base. " +
            "This does NOT run anything — it creates a proposal a human must approve; on approval a research mission runs, stores its findings in the knowledge base, and posts an update to Assistant Updates when it finishes. " +
            "Use this ONLY after search_unified_knowledge (and web search where available) returned nothing useful. Provide the user's question and a short reason you couldn't answer directly.",
        parameters: z.object({
            question: z.string().describe("The user's question in natural language — what the research mission should find out."),
            reason: z.string().describe("Why you could not answer directly (e.g. 'no matching knowledge-base document and web search returned nothing')."),
            topic: z.string().optional().describe("Optional knowledge-base topic name to file the answer under."),
        }),
        execute: async ({ question, reason, topic }: any, context: ToolContext) => {
            // Validate inputs defensively
            if (!question || typeof question !== 'string' || !question.trim()) {
                return (
                    "Cannot propose a research mission without a question. " +
                    "Please provide the user's question that needs to be researched."
                );
            }
            if (!reason || typeof reason !== 'string' || !reason.trim()) {
                reason = "Could not find relevant information in the knowledge base or web search.";
            }

            const orgId = context?.organizationId;
            if (!orgId || orgId === 0) {
                return (
                    `Cannot propose a research mission without organization context. ` +
                    `The question "${question.slice(0, 80)}" could not be submitted for research — ` +
                    `please ensure you are operating within an organization scope.`
                );
            }

            try {
                const { missionProposalService } = await import("../../../mission/core/mission-proposal.service.js");
                const { proposalId } = await missionProposalService.createResearch({
                    organizationId: orgId,
                    requestedBy: context.userId || "assistant",
                    question: question.trim(),
                    reason: reason.trim(),
                    topic: topic?.trim() || undefined,
                    channelId: (context as any).channelId,
                    threadTs: (context as any).threadTs,
                    platform: (context as any).platform,
                    sessionKey: (context as any).sessionKey || (context as any).channelId || undefined,
                    originAgentCardId: (context as any).agentCardId,
                    originAgentName: (context as any).agentName,
                });
                const { GoodQuestionEngine } = await import("../../../ai/core/good-question-engine.js");
                const card = GoodQuestionEngine.synthesizeResearchProposalCard(
                    proposalId,
                    question.trim(),
                    reason.trim()
                );

                return JSON.stringify(card.formAgentPayload);
            } catch (e: any) {
                // Return a non-error-prefixed message to avoid circuit breaker trips
                const detail = e?.message || 'unknown issue';
                return (
                    `The research mission proposal for "${question.slice(0, 60)}" could not be created at this time. ` +
                    `Reason: ${detail}. Please try again or ask a human to create this research task manually.`
                );
            }
        },
    },
};
