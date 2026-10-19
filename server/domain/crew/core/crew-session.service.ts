/**
 * The life of a crew room: opening it, locking it for a round, concluding it,
 * and reopening it.
 *
 * A room is keyed by a client-supplied session key scoped to an organization,
 * so ensureSession is the only place that decides whether a key names an
 * existing room or makes a new one -- and the only place that refuses when the
 * key belongs to another tenant.
 *
 * None of these referenced orchestrator state. They were the first ~600 lines
 * of the class and had nothing to do with running a round.
 */

import { and, asc, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { db, pool } from "@server/database_service.js";
import {
    agentCards,
    crewAttachments,
    crewBreakouts,
    crewClaims,
    crewCommitments,
    crewDecisions,
    crewHandRaises,
    crewIssues,
    crewMembers,
    crewPlans,
    crewSessions,
    crewTurns,
    projectEvents,
    scribeDocuments,
    supervisorNotes,
    type AgentCardRecord,
    type CrewTurnRecord,
} from "@shared/schema/index.js";
import { COPILOT_PERSONA_TYPE } from "@shared/constants/agent-personas.js";
import { CREW_STUDIO_SQUADS, isCrewStudioSlug } from "@shared/constants/crew-studios.js";
import { createLogger } from "@server/utils/logger.js";
import { studioEntitlementService } from "@server/domain/studio-marketplace/core/studio-entitlement.service.js";
import type { StudioKind } from "@shared/studio-registry.js";
import { crewRepository } from "./crew-repository.js";
import type { CrewArtifact } from "./crew-tools.service.js";
import { crewStreamService } from "./crew-stream.service.js";
import { crewSupervisorService } from "./crew-supervisor.service.js";

const logger = createLogger("CrewSession");

/** Handle for a held session lock; `release()` is idempotent. */
export interface SessionLock {
    release: () => Promise<void>;
}

/** Finds or creates the room for a client session key. */
export async function ensureSession(orgId: number, sessionKey: string, createdBy?: string, studio?: string) {
    if (!orgId) {
        const [existingAnyOrg] = await db
            .select()
            .from(crewSessions)
            .where(eq(crewSessions.sessionKey, sessionKey))
            .limit(1);
        if (existingAnyOrg) return existingAnyOrg;
        orgId = 473;
    }

    const [existing] = await db
        .select()
        .from(crewSessions)
        .where(and(eq(crewSessions.organizationId, orgId), eq(crewSessions.sessionKey, sessionKey)))
        .limit(1);

    if (existing) return existing;

    // The room does not exist in THIS org. Before minting a new one, check whether
    // the key belongs to another org — crew_sessions is unique on
    // (organization_id, session_key), not on session_key, so the insert below would
    // happily succeed and produce a second room wearing the same name.
    //
    // That is what happens when a room URL is opened with a different orgId. The
    // fork is created empty: members are only attached when the caller passes
    // agentCardIds, and opening an existing room does not. The round then aborts on
    // "No agents in this crew", which the user sees as the crew failing to respond
    // in a room that visibly has a crew — because they are looking at the URL of a
    // different room. 46 duplicated keys had accumulated this way.
    //
    // Only creation is guarded. A key already present in the requested org returned
    // above, so rooms legitimately live in several orgs (5 of them have real turns
    // in more than one) keep working untouched.
    const [elsewhere] = await db
        .select({ organizationId: crewSessions.organizationId })
        .from(crewSessions)
        .where(eq(crewSessions.sessionKey, sessionKey))
        .limit(1);

    if (elsewhere) {
        // statusCode/code are read by the global error handler, so every caller of
        // ensureSession answers 404 — including authorizeRoom, which the GET room
        // routes share and which has no catch of its own.
        const notHere: any = new Error(
            `Room not in this organization: "${sessionKey}" belongs to a different ` +
            `organization. Switch to that organization to open it.`,
        );
        notHere.statusCode = 404;
        notHere.code = "ROOM_NOT_IN_ORG";
        throw notHere;
    }

    const [created] = await db
        .insert(crewSessions)
        .values({ organizationId: orgId, sessionKey, createdBy: createdBy ?? null, ...(studio && isCrewStudioSlug(studio) ? { cycleContext: { studio } } : {}) })
        .returning();

    logger.info(`Created crew session ${created.id} (key=${sessionKey}) for org ${orgId}`);

    await seedDefaultMembers(orgId, created.id, studio);

    if (sessionKey.startsWith("deliberation-")) {
        // A deliberation room opens by explaining why execution stopped.
        //
        // The columns here were agentName/role/turnNumber, which crew_turns does
        // not have — it has speakerName/speakerType/round, and it requires
        // organizationId. So the insert threw for every deliberation room and the
        // catch below turned that into a warning: the room just opened empty.
        // speakerType has no "system" either; the orchestration voice is
        // "supervisor", as in every other seeded turn.
        const approvalId = Number(sessionKey.slice("deliberation-".length));
        if (Number.isInteger(approvalId)) {
            try {
                await db.insert(crewTurns).values({
                    sessionId: created.id,
                    organizationId: orgId,
                    speakerType: "supervisor",
                    speakerName: "Agora Deliberation",
                    round: 1,
                    // Says only what this room actually offers. It used to state
                    // that Guardian, Optimizer and FinOps "are present in this
                    // room" — nothing adds those personas, so it named three
                    // participants the room did not have.
                    content: [
                        `⚔️ **Agora deliberation room for Decision #${approvalId}**`,
                        "",
                        "The autonomous workflow paused at this decision boundary and is waiting on a human.",
                        "",
                        "Review the briefing card above, challenge the assumptions behind the decision, and use the authorization controls when you are ready.",
                    ].join("\n"),
                });
            } catch (err) {
                logger.warn(`Failed to seed deliberation turn for room ${sessionKey}`, { error: err });
            }
        }
    }

    return created;
}

/**
 * Everything a room has to account for when it closes.
 *
 * NOTE: commitments are loaded and, today, never rendered. The closing brief
 * has six sections and none of them is commitments, even though the
 * supervisor syncs them to the blackboard every round — so a room's
 * commitments are absent from the record of it. Kept on the record rather
 * than dropped, because the fix is to give section 6 a commitments block,
 * not to stop reading them.
 */
export async function loadSessionRecord(sessionId: number) {
    const [turns, decisions, plans, commitments, notes, attachments, breakouts, scribeDocs, turnTopics] = await Promise.all([
        db.select().from(crewTurns).where(eq(crewTurns.sessionId, sessionId)).orderBy(asc(crewTurns.id)),
        db.select().from(crewDecisions).where(eq(crewDecisions.sessionId, sessionId)),
        db.select().from(crewPlans).where(eq(crewPlans.sessionId, sessionId)),
        db.select().from(crewCommitments).where(eq(crewCommitments.sessionId, sessionId)),
        db.select().from(supervisorNotes).where(eq(supervisorNotes.sessionId, sessionId)),
        db.select().from(crewAttachments).where(eq(crewAttachments.sessionId, sessionId)),
        db.select().from(crewBreakouts).where(eq(crewBreakouts.parentSessionId, sessionId)),
        db.select().from(scribeDocuments).where(eq(scribeDocuments.sessionId, sessionId)),
        crewRepository.getTurnTopics(sessionId),
    ]);

    // Every renderable surface the room produced, flattened out of the turns
    // that carried them.
    const generatedArtifacts: Array<{ tool: string; type: string; title: string; url?: string }> = [];
    for (const t of turns) {
        const list = Array.isArray(t.artifacts) ? (t.artifacts as any[]) : [];
        for (const a of list) {
            const p = a?.payload || {};
            generatedArtifacts.push({
                tool: a?.tool || "unknown",
                type: p.type || a?.tool || "artifact",
                title: p.title || p.proposedTitle || p.subTopic || p.module || a?.tool || "Deliverable",
                url: p.childUrl || p.url || (p.appSlug ? `/apps/${p.appSlug}` : undefined),
            });
        }
    }

    return { turns, decisions, plans, commitments, notes, attachments, breakouts, generatedArtifacts, scribeDocs, turnTopics };
}

/**
 * The closing brief, as markdown.
 *
 * Pure: same room, same bytes. Every section states what it found or says
 * plainly that it found nothing, so a thin room still produces a readable
 * record instead of a page of empty headings.
 */
export function buildClosingBrief(
    session: { title: string | null; nextSteps: string | null },
    record: Awaited<ReturnType<typeof loadSessionRecord>>,
): string {
    const { turns, decisions, plans, commitments, notes, attachments, breakouts, generatedArtifacts, scribeDocs, turnTopics } = record;

    // 1. Executive Summary, Consensus & Deliberated Topics
    const summaryNotes = (notes || [])
        .filter((n) => n.noteType === "summary" || n.noteType === "consensus")
        .map((n) => `- **${n.noteType.toUpperCase()}**: ${n.content}`);

    // Extract substantive discussion topics from turns
    const topicMap = new Map<string, {
        topic: string;
        speakers: Set<string>;
        keyPoints: string[];
    }>();

    for (const t of (turns || [])) {
        const rawTopic = t.topic?.trim();
        if (!rawTopic || rawTopic === "General" || rawTopic === "session_concluded" || rawTopic.startsWith("Meeting Conclusion")) {
            continue;
        }
        let entry = topicMap.get(rawTopic);
        if (!entry) {
            entry = {
                topic: rawTopic,
                speakers: new Set(),
                keyPoints: [],
            };
            topicMap.set(rawTopic, entry);
        }
        if (t.speakerName) entry.speakers.add(t.speakerName);
        if (t.content && t.speakerType !== "supervisor") {
            const firstLine = t.content.split("\n").find(l => {
                const s = l.trim();
                return s.length > 20 && !s.startsWith("#") && !s.startsWith("```") && !s.startsWith("- [") && !s.startsWith("{");
            });
            if (firstLine && entry.keyPoints.length < 2) {
                entry.keyPoints.push(firstLine.trim().replace(/^[-*]\s*/, "").slice(0, 150));
            }
        }
    }

    const topicsSummaryLines = Array.from(topicMap.values()).map(e => {
        const speakers = Array.from(e.speakers).join(", ");
        const points = e.keyPoints.length > 0 ? ` — *"${e.keyPoints[0]}"*` : "";
        return `- **${e.topic}** (Led by ${speakers || "Squad"})${points}`;
    });

    // Declared topics — the room's own #[x] labels, by speaker. These are what
    // participants said the discussion was about; the topics above are what the
    // classifier inferred.
    const declaredByLabel = new Map<string, { count: number; speakers: Set<string> }>();
    for (const t of (turnTopics || [])) {
        let entry = declaredByLabel.get(t.label);
        if (!entry) {
            entry = { count: 0, speakers: new Set() };
            declaredByLabel.set(t.label, entry);
        }
        entry.count += 1;
        const speakerTurn = (turns || []).find((x) => x.id === t.turnId);
        if (speakerTurn?.speakerName) entry.speakers.add(speakerTurn.speakerName);
    }
    const declaredLines = Array.from(declaredByLabel.entries()).map(
        ([label, e]) => `- **#${label}** — declared ${e.count}× by ${Array.from(e.speakers).join(", ") || "the room"}`,
    );

    const execSummaryParts: string[] = [];
    if (summaryNotes.length > 0) {
        execSummaryParts.push(summaryNotes.join("\n"));
    }
    if (declaredLines.length > 0) {
        execSummaryParts.push("### Topics Declared\n" + declaredLines.join("\n"));
    }
    if (topicsSummaryLines.length > 0) {
        execSummaryParts.push("### Deliberated Topics & Key Discussion Points\n" + topicsSummaryLines.join("\n"));
    }
    const section1Text = execSummaryParts.length > 0
        ? execSummaryParts.join("\n\n")
        : "Discussion successfully concluded and consolidated.";

    // 2. Key Decisions & Policy Directives (including Decision Matrix & Governance Checkpoints)
    const formalDecisions = (decisions || []).map((d) => `- [${d.status.toUpperCase()}] **${d.statement}**`);

    // Extract Decision Matrix deliberations from turn artifacts
    const matrixDecisions: string[] = [];
    // Extract Governance Gate sign-offs from turn artifacts
    const govDecisions: string[] = [];

    for (const t of (turns || [])) {
        const list = Array.isArray(t.artifacts) ? (t.artifacts as any[]) : [];
        for (const a of list) {
            const p = a?.payload || {};
            if (a?.tool === "propose_decision_matrix" || p.type === "crew_decision_matrix_pod") {
                const topic = p.topic || "Deliberation Topic";
                const topCandidate = p.candidates?.find((c: any) => c.id === p.recommendedCandidateId) || p.candidates?.[0];
                const candName = topCandidate?.name || "Recommended Treatment";
                const score = topCandidate?.overallScore ? ` (Overall Score: ${topCandidate.overallScore}/10)` : "";
                const consensus = p.consensusPercentage != null ? ` [${p.consensusPercentage}% Team Consensus]` : "";
                matrixDecisions.push(`- [CONSENSUS DECISION] **${topic}**: Ratified **${candName}**${score}${consensus}`);
            }
            if (a?.tool === "request_governance_approval" || p.type === "crew_governance_gate_pod") {
                const cp = p.checkpoint || p;
                const action = cp.actionTitle || cp.actionKey || "Governance Checkpoint";
                // The tool only proposes a checkpoint; nothing records a sign-off, so no status means pending.
                const status = (cp.status || "pending").toUpperCase();
                const risk = cp.riskTier ? ` (Risk: ${cp.riskTier.toUpperCase()})` : "";
                const cost = cp.blastRadius?.estimatedCostUsd != null ? ` [Spend: $${Number(cp.blastRadius.estimatedCostUsd).toFixed(2)}]` : "";
                // `requestedBy` is the agent that asked, never the person who signed off.
                const auth = cp.requestedBy ? ` — Requested by @${cp.requestedBy}` : "";
                govDecisions.push(`- [${status} GOVERNANCE] **${action}**${risk}${cost}${auth}`);
            }
        }
    }

    const allDecisions = [
        ...formalDecisions,
        ...matrixDecisions,
        ...govDecisions,
    ];

    const decisionsBlock = allDecisions.length > 0
        ? allDecisions.join("\n")
        : "No formal decisions recorded.";

    const scribeBlock = (scribeDocs && scribeDocs.length > 0)
        ? scribeDocs.map((s) => {
            const pubs = (s.settings as any)?.publications || [];
            const pubText = pubs.length > 0
                ? ` (Published ${pubs[0].versionTag} • ${pubs[0].wordCount}w)`
                : ` (${s.targetWordCount || 0}w target • Draft Revision #${s.currentRevision})`;
            // Every underscore, not just the first: a string pattern here
            // rendered "save_the_cat" as "SAVE THE_CAT".
            return `- 📄 **${s.title}** [Archetype: ${s.archetypeMode.replace(/_/g, " ").toUpperCase()}]${pubText}`;
        }).join("\n")
        : "No Scribe Studio longform manuscripts generated in this room.";

    const artifactsBlock = generatedArtifacts.length > 0
        ? generatedArtifacts.map((a) => `- **${a.title}** (${a.type})${a.url ? `: [Open Resource](${a.url})` : ""}`).join("\n")
        : "No generated applications or deliverables in this session.";

    const attachmentsBlock = attachments.length > 0
        ? attachments.map((att) => `- 📎 **${att.displayName}** (Uploaded by ${att.uploadedBy || "participant"})`).join("\n")
        : "No attachments uploaded.";

    const breakoutsBlock = breakouts.length > 0
        ? breakouts.map((b) => `- 🔀 **${b.subTopic}** (Suggested by ${b.suggestedBy})`).join("\n")
        : "No breakout sessions originated from this room.";

    // 7. Action Items, Next Steps & Plan (including commitments and todos)
    const plansLines = (plans || []).map((p) =>
        `### Plan: ${p.title}\n` +
        (Array.isArray(p.steps) ? (p.steps as any[]) : [])
            .map((s) => `- Step ${s.order}: ${s.description}${s.owner ? ` (@${s.owner})` : ""}`)
            .join("\n")
    );

    const commitmentsLines = (commitments || []).map((c: any) => {
        const owner = c.ownerId ? ` (@${c.ownerId})` : (c.ownerType ? ` (@${c.ownerType})` : "");
        const due = c.dueAt ? ` [Due: ${new Date(c.dueAt).toISOString().split("T")[0]}]` : "";
        const title = c.title || c.statement || "Action Item";
        const detail = c.detail ? ` — ${c.detail}` : "";
        const status = (c.status || "open").toUpperCase();
        return `- [${status} TODO] **${title}**${owner}${due}${detail}`;
    });

    const nextStepsLine = session.nextSteps ? `- ${session.nextSteps}` : null;

    const section7Parts: string[] = [];
    if (plansLines.length > 0) {
        section7Parts.push(plansLines.join("\n\n"));
    }
    if (commitmentsLines.length > 0) {
        section7Parts.push("### Todos & Commitments\n" + commitmentsLines.join("\n"));
    }
    if (nextStepsLine && section7Parts.length === 0) {
        section7Parts.push(nextStepsLine);
    } else if (nextStepsLine) {
        section7Parts.push("### Executive Next Steps\n" + nextStepsLine);
    }

    const plansBlock = section7Parts.length > 0
        ? section7Parts.join("\n\n")
        : "Meeting objectives achieved.";

    const reportMarkdown = `# Executive Meeting Closing Brief: ${session.title || "CREW Meeting"}

## 1. Executive Summary & Consensus
${section1Text}

## 2. Key Decisions & Policy Directives
${decisionsBlock}

## 3. Scribe Studio Deliverables & Longform Manuscripts
${scribeBlock}

## 4. Work Products & Generated Applications
${artifactsBlock}

## 5. Uploaded Attachments & Source Data
${attachmentsBlock}

## 6. Breakout Sessions & Sub-Threads
${breakoutsBlock}

## 7. Action Items, Next Steps & Plan
${plansBlock}`;

    return reportMarkdown;
}

/**
 * Renders the brief as an executive-brief deck.
 *
 * The creative crew is a model call and can fail; a room must still be able
 * to close, so the fallback wraps the same markdown in a single text block.
 * The brief itself is never lost — only its styling.
 */
export async function renderClosingBrief(
    session: { title: string | null },
    reportMarkdown: string,
): Promise<CrewArtifact> {
    try {
        const { presentationCrewService } = await import("./presentation-crew.service.js");
        const deckResult = await presentationCrewService.orchestrateCreativeCrew(reportMarkdown, {
            title: `Executive Closing Report: ${session.title || "Meeting"}`,
            preferredThemeId: "glass_corporate",
            formatCategory: "executive_brief",
        });

        return {
            tool: "generate_presentation_deck",
            payload: {
                type: "presentation_deck",
                title: `Executive Closing Report: ${session.title || "Meeting"}`,
                formatCategory: "executive_brief",
                theme: deckResult.ast.designSystem.name,
                blockCount: deckResult.ast.blocks.length,
                blocks: deckResult.ast.blocks,
                ast: deckResult.ast,
            },
        };
    } catch {
        return {
            tool: "generate_presentation_deck",
            payload: {
                type: "presentation_deck",
                title: `Executive Closing Report: ${session.title || "Meeting"}`,
                formatCategory: "executive_brief",
                theme: "Glass Corporate",
                blockCount: 1,
                blocks: [
                    {
                        id: "exec-brief-block-1",
                        type: "text",
                        title: "Meeting Synthesis",
                        content: reportMarkdown,
                    },
                ],
            },
        };
    }
}

/** Marks the conclusion on the Project Space timeline, when the room has one. */
export async function logProjectMilestone(scope: {
    session: { projectId: number | null; title: string | null };
    orgId: number;
    sessionKey: string;
    userId?: string;
    decisionCount: number;
    deliverableCount: number;
    attachmentCount: number;
}): Promise<void> {
    const { session, orgId, sessionKey, userId } = scope;
    if (!session.projectId) return;

    try {
        await db.insert(projectEvents).values({
            projectId: session.projectId,
            organizationId: orgId,
            title: `Meeting Concluded: ${session.title || "CREW Discussion"}`,
            description: `Synthesized ${scope.decisionCount} decisions, ${scope.deliverableCount} deliverables, and ${scope.attachmentCount} attachments. [View Executive Closing Brief](/workspace/chat/${sessionKey})`,
            kind: "milestone",
            severity: "Medium",
            startsAt: new Date(),
            createdBy: userId || "Supervisor",
        });
    } catch (eventErr) {
        logger.warn(`Failed to auto-log projectEvent for concluded session: ${eventErr}`);
    }
}

/**
 * Formally concludes and archives a crew discussion room.
 *
 * Compiles an exhaustive closing synthesis of all decisions, work products,
 * attachments, child breakout sessions, and plan steps, orchestrating an
 * Executive Brief document presentation artifact that is written into the room
 * and sets status to "archived".
 */
export async function concludeSession(
    orgId: number,
    sessionKey: string,
    userId?: string,
): Promise<{ session: typeof crewSessions.$inferSelect; turn: CrewTurnRecord }> {
    const session = await ensureSession(orgId, sessionKey);

    const record = await loadSessionRecord(session.id);
    const { turns, decisions, attachments, generatedArtifacts } = record;

    const reportMarkdown = buildClosingBrief(session, record);

    // File the brief in the knowledge base under every topic the room
    // declared — "find me the room where we settled #[pricing]" is then a RAG
    // query, not a transcript hunt. Non-blocking: a KB hiccup must not stop a
    // room from closing.
    const declaredTopicIds = [...new Set(
        record.turnTopics.map((t) => t.topicId).filter((id): id is number => id !== null),
    )];
    if (declaredTopicIds.length > 0) {
        void indexClosingBrief(orgId, session, sessionKey, reportMarkdown, declaredTopicIds)
            .catch((err) => logger.warn(`Failed to file closing brief for ${sessionKey}: ${err}`));
    }

    const reportArtifact = await renderClosingBrief(session, reportMarkdown);

    const lastRound = turns.length > 0 ? (turns[turns.length - 1].round ?? 0) : 0;
    const [concludingTurn] = await db
        .insert(crewTurns)
        .values({
            sessionId: session.id,
            organizationId: orgId,
            speakerType: "supervisor",
            speakerName: crewSupervisorService.name,
            content: `🏁 **Meeting Concluded**\n\nThe discussion has been formally concluded and synthesized into the Executive Closing Report below. All decisions, generated deliverables, attachments, and next steps have been catalogued and archived.`,
            round: lastRound + 1,
            topic: "Meeting Conclusion & Executive Summary",
            intent: "session_concluded",
            artifacts: [reportArtifact] as any,
        })
        .returning();

    const [updatedSession] = await db
        .update(crewSessions)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(crewSessions.id, session.id))
        .returning();

    await logProjectMilestone({
        session,
        orgId,
        sessionKey,
        userId,
        decisionCount: decisions.length,
        deliverableCount: generatedArtifacts.length,
        attachmentCount: attachments.length,
    });

    void crewStreamService.publish({
        type: "turn",
        organizationId: orgId,
        sessionKey,
        payload: {
            speakerType: "supervisor",
            speakerName: crewSupervisorService.name,
            content: `Meeting concluded and archived.`,
            artifacts: [reportArtifact],
        },
    });

    logger.info(`Session ${session.id} (${sessionKey}) concluded and archived.`);
    return { session: updatedSession, turn: concludingTurn };
}

/**
 * Store the room's closing brief as a knowledge_document under its declared
 * topics. Deterministic title → reopen/re-conclude re-upserts the same row.
 */
async function indexClosingBrief(
    orgId: number,
    session: { id: number; projectId: number | null; title: string | null },
    sessionKey: string,
    reportMarkdown: string,
    topicIds: number[],
): Promise<void> {
    const [{ documentService }, { getSystemOrgContext }] = await Promise.all([
        import("@domain/knowledge/core/extraction/document-service.js"),
        import("@server/utils/auth-context.js"),
    ]);
    await documentService.createDocument(
        {
            title: `Crew closing brief · ${sessionKey}`,
            summary: reportMarkdown.split("\n").find((l) => l.trim().length > 20)?.trim().slice(0, 200) ?? null,
            sourceType: "crew_brief",
            textContent: reportMarkdown,
            projectId: session.projectId,
            topicIds,
            metadata: {
                source: "crew_brief",
                sessionId: session.id,
                sessionKey,
                title: session.title,
            },
        },
        getSystemOrgContext(orgId),
    );
}

/**
 * Re-opens an archived crew discussion room.
 */
export async function reopenSession(
    orgId: number,
    sessionKey: string,
    userId?: string,
): Promise<{ session: typeof crewSessions.$inferSelect; turn: CrewTurnRecord }> {
    const session = await ensureSession(orgId, sessionKey);
    const [updatedSession] = await db
        .update(crewSessions)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(crewSessions.id, session.id))
        .returning();

    const turns = await db
        .select()
        .from(crewTurns)
        .where(eq(crewTurns.sessionId, session.id))
        .orderBy(asc(crewTurns.id));
    const lastRound = turns.length > 0 ? (turns[turns.length - 1].round ?? 0) : 0;

    const [reopenTurn] = await db
        .insert(crewTurns)
        .values({
            sessionId: session.id,
            organizationId: orgId,
            speakerType: "supervisor",
            speakerName: crewSupervisorService.name,
            content: `🔓 **Meeting Re-Opened**\n\nThe discussion has been reopened for follow-up collaboration.`,
            round: lastRound + 1,
            topic: session.activeTopic || "Follow-up Discussion",
            intent: "session_reopened",
        })
        .returning();

    void crewStreamService.publish({
        type: "turn",
        organizationId: orgId,
        sessionKey,
        payload: {
            speakerType: "supervisor",
            speakerName: crewSupervisorService.name,
            content: `Meeting re-opened.`,
        },
    });

    logger.info(`Session ${session.id} (${sessionKey}) reopened by ${userId || "user"}.`);
    return { session: updatedSession, turn: reopenTurn };
}

/**
 * Seeds a brand-new room with the platform Copilot and, when the room was opened
 * in a Studio context, the agents dedicated to that Studio.
 *
 * The room's roster is whatever the client sends with the first message, so
 * a default that lives only in the panel is a default only that panel has.
 * Seeding it here makes "the Copilot is in every new room" true of the room
 * itself — a second client, or a room opened by a link, gets the same answer
 * from GET /api/crew/:sessionKey.
 *
 * Only ever applied at creation. A room whose roster someone has since
 * edited is their roster, and re-adding a removed member on every read would
 * make it impossible to take the Copilot out.
 */
const CREW_SLUG_TO_STUDIO_KIND: Record<string, StudioKind> = {
    forge: "app",
    builder: "app",
    media: "media",
    form: "form",
    scribe: "scribe",
    agent: "agent",
    project: "project",
    computer: "computer",
    flow: "flow",
    signal: "signal",
    prediction: "prediction",
};

export async function seedDefaultMembers(
    orgId: number,
    sessionId: number,
    studio?: string | null,
): Promise<void> {
    await seedCopilotMember(orgId, sessionId);

    if (!studio || !isCrewStudioSlug(studio)) return;

    const studioKind = CREW_SLUG_TO_STUDIO_KIND[studio];
    if (studioKind && !(await studioEntitlementService.isEnabled(orgId, studioKind))) {
        logger.info(`Skipping seed for disabled studio "${studio}" in crew session ${sessionId}; enable it in the Studio Marketplace.`);
        return;
    }

    const personaTypes = CREW_STUDIO_SQUADS[studio];
    if (!personaTypes || personaTypes.length === 0) return;

    try {
        const cards = await db
            .select({ id: agentCards.id })
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.organizationId, orgId),
                    eq(agentCards.enabled, true),
                    inArray(agentCards.personaType, personaTypes),
                ),
            );

        if (cards.length === 0) return;

        await db
            .insert(crewMembers)
            .values(cards.map((c) => ({ sessionId, agentCardId: c.id })))
            .onConflictDoNothing();

        logger.info(
            `Seeded ${cards.length} dedicated agent(s) for studio "${studio}" into crew session ${sessionId}`,
        );
    } catch (err) {
        // A thinner studio room is still a working room.
        logger.warn(
            `Failed to seed studio squad for "${studio}" into crew session ${sessionId}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

/**
 * Puts the Copilot in a brand-new room.
 */
export async function seedCopilotMember(orgId: number, sessionId: number): Promise<void> {
    try {
        const [copilot] = await db
            .select({ id: agentCards.id })
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.organizationId, orgId),
                    eq(agentCards.personaType, COPILOT_PERSONA_TYPE),
                    eq(agentCards.enabled, true),
                ),
            )
            .orderBy(asc(agentCards.id))
            .limit(1);

        if (!copilot) return;

        await db
            .insert(crewMembers)
            .values({ sessionId, agentCardId: copilot.id })
            .onConflictDoNothing();
    } catch (err) {
        // A missing default is a thinner room, not a failed one.
        logger.warn(
            `Failed to seed Copilot into crew session ${sessionId}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

/**
 * Acquires a session-level PostgreSQL advisory lock keyed on the session ID.
 * This serializes concurrent round requests for the same session, preventing
 * race conditions in round numbering and interleaved turns.
 *
 * The lock is taken on a DEDICATED connection checked out of the pool, and
 * released on that same connection. This is not optional: an advisory lock
 * belongs to the backend session that took it, and `db` is a ~30-connection
 * pool, so `db.execute(pg_advisory_lock)` followed later by
 * `db.execute(pg_advisory_unlock)` usually lands on two DIFFERENT
 * connections — the unlock returns false without releasing anything, the
 * holder is handed back to the pool still holding the lock, and every later
 * round on that session blocks forever.
 *
 * Returns a handle whose `release()` must be called in a finally block on
 * both the success and failure paths.
 */
export async function acquireSessionLock(sessionId: number): Promise<SessionLock> {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [sessionId]);
    } catch (err) {
        client.release();
        throw err;
    }

    let released = false;
    return {
        release: async () => {
            if (released) return;
            released = true;
            try {
                await client.query("SELECT pg_advisory_unlock($1)", [sessionId]);
            } catch (err) {
                // Destroy rather than recycle: a connection that may still
                // hold the lock must not go back into the pool.
                logger.warn(
                    `Failed to release crew session lock ${sessionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
                client.release(true);
                return;
            }
            client.release();
        },
    };
}











/**
 * Room state created after a cursor turn, for clients that already hold
 * everything up to it. Without this every SSE event refetched the whole
 * transcript, so a long room re-downloaded itself once per agent turn.
 *
 * Turns are filtered by id (a monotonic sequence); notes, plans and issues
 * live on their own id sequences, so they are filtered by the cursor turn's
 * `round` instead. Raised hands are deliberately NOT filtered — they are
 * already scoped to the latest round and the client replaces them wholesale,
 * so returning them in full keeps a delta from blanking the panel.
 *
 * The round — not the cursor turn's `createdAt`. A round persists the
 * supervisor's notes BEFORE inserting the supervisor's turn, and a directive
 * follow-up turn lands after both, so the newest turn the client holds is
 * always stamped later than that round's notes. Filtering on `createdAt >=
 * cursor.createdAt` therefore dropped every note of the round that had just
 * finished, on every round: the blackboard, critique, consensus and summary
 * panels only ever advanced on a full page load. Re-sending the current
 * round is harmless — the client merges these by id.
 */
export async function getRoomDelta(sessionId: number, sinceTurnId: number) {
    const [cursorTurn] = await db
        .select({ round: crewTurns.round })
        .from(crewTurns)
        .where(and(eq(crewTurns.sessionId, sessionId), eq(crewTurns.id, sinceTurnId)))
        .limit(1);

    // An unknown cursor (turn pruned, or a client cursor from another room)
    // can only be served safely as a full read.
    const cursorRound = cursorTurn?.round ?? null;

    const [turns, notes, plans, issues, raisedHands, decisions, claims, commitments, turnTopics] = await Promise.all([
        db
            .select()
            .from(crewTurns)
            .where(and(eq(crewTurns.sessionId, sessionId), gt(crewTurns.id, sinceTurnId)))
            .orderBy(asc(crewTurns.id))
            .limit(200),
        db
            .select()
            .from(supervisorNotes)
            .where(
                cursorRound !== null
                    ? and(
                          eq(supervisorNotes.sessionId, sessionId),
                          gte(supervisorNotes.round, cursorRound),
                      )
                    : eq(supervisorNotes.sessionId, sessionId),
            )
            .orderBy(asc(supervisorNotes.id))
            .limit(100),
        db
            .select()
            .from(crewPlans)
            .where(
                cursorRound !== null
                    ? and(eq(crewPlans.sessionId, sessionId), gte(crewPlans.round, cursorRound))
                    : eq(crewPlans.sessionId, sessionId),
            )
            .orderBy(desc(crewPlans.id)),
        db
            .select()
            .from(crewIssues)
            .where(
                cursorRound !== null
                    ? and(eq(crewIssues.sessionId, sessionId), gte(crewIssues.round, cursorRound))
                    : eq(crewIssues.sessionId, sessionId),
            )
            .orderBy(desc(crewIssues.id)),
        crewRepository.getRaisedHands(sessionId),
        crewRepository.getDecisions(sessionId),
        crewRepository.getClaims(sessionId),
        crewRepository.getCommitments(sessionId),
        // Same round-window rule as notes: tag rows share their turn's round,
        // so the cursor's round bounds them — a tag written mid-round still
        // reaches a client whose cursor is that round's first turn.
        crewRepository.getTurnTopics(sessionId, { sinceRound: cursorRound ?? undefined }),
    ]);

    return { turns, notes, plans, issues, raisedHands, decisions, claims, commitments, turnTopics };
}
