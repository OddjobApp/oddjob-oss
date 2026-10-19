/**
 * Scribe Studio Capabilities & Tools
 *
 * Tools for longform writing, contract drafting, multi-lens critic evaluation,
 * subway branch navigation, and document compilation.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import type { ScribeArchetypeMode, ScribeLensType } from "@shared/schema/scribe.js";
import { scribeArchetypeModes } from "@shared/schema/scribe.js";
import { isStationDrafted } from "@shared/scribe-telemetry.js";

/**
 * Scribe tools address documents by serial integer, and those ids arrive on
 * model-authored arguments. The org id is the only thing separating one
 * tenant's manuscript from another's, so it must come from the execution
 * context and can never be defaulted.
 */
function requireOrg(context: any): number {
    const orgId = context?.organizationId;
    if (typeof orgId !== "number") {
        throw new Error("no organization in tool context");
    }
    return orgId;
}

export const SCRIBE_TOOLS: Record<string, ToolDefinition> = {
    scribe_get_document: {
        name: "scribe_get_document",
        idempotency: "read-safe",
        label: "Read Active Scribe Document",
        group: "Authoring",
        description: "Read the current manuscript, section IDs, and text before editing. Omit documentId to use the current room. Does not create or reset a document.",
        parameters: z.object({ documentId: z.number().int().positive().optional() }),
        execute: async (params: any, context?: any) => {
            const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
            const orgId = requireOrg(context);
            const view = params.documentId
                ? await scribeService.getDocument(params.documentId, orgId)
                : context?.sessionId ? await scribeService.getSessionDocument(context.sessionId, orgId) : null;
            if (!view) return "Error reading Scribe: no active document in this room.";
            if (context) context.scribeReadContents = Object.fromEntries(view.nodes.map((node) => [node.id, node.content ?? ""]));
            return JSON.stringify({ documentId: view.document.id, title: view.document.title,
                branchId: view.activeBranch.id, stations: view.nodes.map((n) => ({
                    nodeId: n.id, stationKey: n.stationKey, title: n.title, content: n.content, wordCount: n.wordCount,
                })) });
        },
    },
    scribe_add_table_of_contents: {
        name: "scribe_add_table_of_contents",
        idempotency: "none",
        label: "Add or Refresh Scribe Table of Contents",
        group: "Authoring",
        description: "Add or refresh a Table of Contents from the active document's headings, preserving all existing sections and text. Use for 'add a TOC'; do not remount or reset the studio.",
        parameters: z.object({ documentId: z.number().int().positive().optional() }),
        execute: async (params: any, context?: any) => {
            const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
            const orgId = requireOrg(context);
            const view = params.documentId
                ? await scribeService.getDocument(params.documentId, orgId)
                : context?.sessionId ? await scribeService.getSessionDocument(context.sessionId, orgId) : null;
            if (!view) return "Error adding TOC: no active document in this room.";
            const updated = await scribeService.addTableOfContents(view.document.id, orgId);
            return JSON.stringify({ success: true, documentId: updated.document.id,
                title: updated.document.title, content: updated.nodes.find((n) => n.stationKey === "table_of_contents")?.content });
        },
    },
    mount_scribe_studio: {
        name: "mount_scribe_studio",
        idempotency: "none",
        label: "Mount Scribe Studio Authoring Pod",
        group: "Authoring",
        description: "Mounts the 4-pane Scribe Studio authoring pod in the CREW room with a vertical subway branch spine and paginated living canvas.",
        parameters: z.object({
            title: z.string().optional().default("Manuscript / Agreement").describe("Title of the document / contract / novel"),
            // No .default(): an omitted archetype has to stay undefined, or every
            // mount without one reads as an explicit request for the generic
            // framework and can re-frame an untouched specialised document.
            archetypeMode: z.enum(scribeArchetypeModes).optional().describe("Structural framework archetype"),
            targetWordCount: z.number().optional().describe("Target word count for pacing targets"),
            initialPrompt: z.string().optional().describe("Initial topic or context to prime the stations"),
            subject: z.string().optional().describe("Subject or topic of the document. If different from current document, triggers reset"),
            reset: z.boolean().optional().describe("Explicitly reset the document stations and text for a fresh draft"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                // No `|| 1` on either id. Defaulting a missing org or session
                // writes the manuscript into tenant #1's room, so an absent
                // context has to fail loudly instead.
                const orgId = requireOrg(context);
                let sessionId: number | undefined = context?.sessionId;
                if (!sessionId && context?.sessionKey) {
                    const { db } = await import("@server/database_service.js");
                    const { crewSessions } = await import("@shared/schema/crew.js");
                    const { eq, and } = await import("drizzle-orm");
                    const [found] = await db
                        .select()
                        .from(crewSessions)
                        .where(and(eq(crewSessions.sessionKey, context.sessionKey), eq(crewSessions.organizationId, orgId)))
                        .limit(1);
                    if (found) sessionId = found.id;
                }
                if (!sessionId) {
                    return "Error mounting Scribe Studio: no CREW session in context to attach the document to.";
                }
                const title = (params.subject && (!params.title || params.title === "Manuscript / Agreement"))
                    ? params.subject
                    : (params.title || params.subject || "Manuscript / Agreement");

                let docView = await scribeService.createOrGetDocument(
                    sessionId,
                    orgId,
                    title,
                    params.archetypeMode as ScribeArchetypeMode | undefined,
                    params.targetWordCount,
                    params.reset
                );

                // The agent captured the author's intent into initialPrompt, and
                // this dropped it on the floor — the parameter was declared,
                // described, and read by nothing. So the studio opened on an
                // empty document and asked "What is this about?", which the
                // author had just answered in the room. Crystallize with it.
                const initialPrompt = typeof params.initialPrompt === "string" ? params.initialPrompt.trim() : "";
                const isEmpty = docView.nodes.every((n) => !isStationDrafted(n));
                if (initialPrompt && isEmpty) {
                    try {
                        docView = await scribeService.crystallizeFromContext(
                            docView.document.id,
                            orgId,
                            initialPrompt,
                        );
                    } catch {
                        // Mounting the studio matters more than seeding it; the
                        // author can still crystallize by hand.
                    }
                }

                // The session may already hold a document the author has
                // written into, which keeps its own framework rather than
                // losing their stations. Say so: reporting only the mode that
                // was asked for let the room believe an SOW had been mounted
                // when a freeform draft was on screen.
                const requestedMode = params.archetypeMode as ScribeArchetypeMode | undefined;
                const mountedMode = docView.document.archetypeMode;
                const archetypeNote =
                    !requestedMode || mountedMode === requestedMode
                        ? undefined
                        : `This session already has a document drafted as "${mountedMode}", so it was opened ` +
                          `as-is rather than being re-framed as "${requestedMode}". Tell the author, and offer ` +
                          `to start a separate document if they want the other framework.`;

                return JSON.stringify({
                    type: "scribe_foundry_pod",
                    module: "ScribeStudioPod",
                    component: "ScribeStudioPod",
                    documentId: docView.document.id,
                    title: docView.document.title,
                    subject: params.subject || docView.document.title,
                    archetypeMode: mountedMode,
                    ...(archetypeNote ? { archetypeNote } : {}),
                    activeBranchId: docView.activeBranch.id,
                    stations: docView.nodes.map((n) => ({
                        id: n.id,
                        stationKey: n.stationKey,
                        title: n.title,
                        sortOrder: n.sortOrder,
                        status: n.status,
                        wordCount: n.wordCount,
                    })),
                    telemetry: docView.telemetry,
                });
            } catch (err: any) {
                return `Error mounting Scribe Studio: ${err.message}`;
            }
        },
    },

    scribe_reset_studio: {
        name: "scribe_reset_studio",
        idempotency: "none",
        label: "Reset Scribe Studio Document",
        group: "Authoring",
        description: "Resets the active Scribe Studio document when the subject or topic changes, clearing previous stations, annotations, and text.",
        parameters: z.object({
            documentId: z.number().optional().describe("ID of the Scribe document (or inferred from session)"),
            newTitle: z.string().optional().describe("New subject or title for the reset document"),
            archetypeMode: z.enum(scribeArchetypeModes).optional().describe("New structural framework archetype"),
            targetWordCount: z.number().optional().describe("Target word count for pacing targets"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const orgId = requireOrg(context);
                let docId = params.documentId;
                if (!docId && context?.sessionId) {
                    const existing = await scribeService.createOrGetDocument(context.sessionId, orgId);
                    docId = existing.document.id;
                }
                if (!docId) {
                    return "Error resetting Scribe Studio: no documentId provided or found in session context.";
                }
                const docView = await scribeService.resetDocument(docId, orgId, {
                    newTitle: params.newTitle,
                    archetypeMode: params.archetypeMode,
                    targetWordCount: params.targetWordCount,
                });
                return JSON.stringify({
                    success: true,
                    documentId: docView.document.id,
                    title: docView.document.title,
                    archetypeMode: docView.document.archetypeMode,
                    stationsCount: docView.nodes.length,
                    message: `Scribe Studio reset successfully for "${docView.document.title}".`,
                });
            } catch (err: any) {
                return `Error resetting Scribe Studio: ${err.message}`;
            }
        },
    },

    scribe_update_node: {
        name: "scribe_update_node",
        idempotency: "none",
        label: "Update Scribe Station Content",
        group: "Authoring",
        description: "Updates the text content of a specific station or clause in the active Scribe Studio document. Can replace full content or surgically replace targetExcerpt with replacementExcerpt.",
        parameters: z.object({
            nodeId: z.number().describe("ID of the station node to update"),
            content: z.string().optional().describe("The draft text content for this station"),
            targetExcerpt: z.string().optional().describe("Specific text excerpt inside the station to surgically replace"),
            replacementExcerpt: z.string().optional().describe("Replacement text for the target excerpt"),
            status: z.enum(["draft", "in_review", "approved"]).optional().describe("Updated completion status"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const updated = await scribeService.updateNodeContent(
                    params.nodeId,
                    requireOrg(context),
                    params.content,
                    undefined,
                    params.status,
                    params.targetExcerpt,
                    params.replacementExcerpt,
                    // Who wrote this and what they were asked. Without it every
                    // agent edit lands on the record as the generic "author",
                    // which leaves it unable to answer the first question
                    // anyone asks of an audit trail.
                    {
                        actor: context?.agentName ?? "agent",
                        request: context?.named?.message,
                        sessionId: context?.sessionId ?? null,
                        expectedContent: context?.scribeReadContents?.[params.nodeId],
                    },
                );
                // This write is now the text the turn last saw. Without it a second
                // edit to the same station is refused as "changed after it was read".
                if (context?.scribeReadContents) context.scribeReadContents[params.nodeId] = updated.content ?? "";

                return JSON.stringify({
                    success: true,
                    nodeId: updated.id,
                    stationKey: updated.stationKey,
                    wordCount: updated.wordCount,
                    status: updated.status,
                    contentSnippet: updated.content?.slice(0, 120),
                });
            } catch (err: any) {
                return `Error updating Scribe station: ${err.message}`;
            }
        },
    },

    /**
     * Confluence interop.
     *
     * The read and write halves already existed as separate capabilities — a page
     * could be fetched and a manuscript could be compiled — but nothing joined
     * them, so moving a spec between the two was copy and paste. These two do the
     * joining, and deliberately reuse splitMarkdownIntoStations and
     * compileManuscript rather than restating either.
     */
    scribe_import_confluence_page: {
        name: "scribe_import_confluence_page",
        idempotency: "none",
        label: "Import a Confluence Page into Scribe",
        group: "Authoring",
        description:
            "Import a Confluence page into the active Scribe document, splitting it into stations at its heading level. " +
            "Replaces the current outline, so read scribe_get_document first if the manuscript already has work in it.",
        parameters: z.object({
            credentialId: z.number().int().positive().describe("Confluence credential to read with"),
            pageId: z.string().describe("Confluence page id, from search_confluence"),
            documentId: z.number().int().positive().optional().describe("Target document (defaults to this room's)"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = requireOrg(context);
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const { getConfluenceClient } = await import("@domain/integrations/confluence-service.js");
                const { splitMarkdownIntoStations } = await import("@shared/scribe-outline.js");

                const view = params.documentId
                    ? await scribeService.getDocument(params.documentId, orgId)
                    : context?.sessionId
                      ? await scribeService.getSessionDocument(context.sessionId, orgId)
                      : null;
                if (!view) return "Error importing Confluence page: no active Scribe document in this room.";

                const client = await getConfluenceClient(params.credentialId, orgId as any);
                const page = await client.getPage(String(params.pageId));
                const markdown = String((page as any)?.body ?? (page as any)?.content ?? "").trim();
                if (!markdown) {
                    return `Error importing Confluence page: page ${params.pageId} returned no readable body.`;
                }

                const stations = splitMarkdownIntoStations(markdown, {
                    fallbackTitle: String((page as any)?.title ?? "Imported Page"),
                });
                if (stations.length === 0) {
                    return `Error importing Confluence page: nothing to import from page ${params.pageId}.`;
                }

                const updated = await scribeService.configureStations(view.document.id, orgId, stations);
                return JSON.stringify({
                    success: true,
                    documentId: updated.document.id,
                    sourcePageId: String(params.pageId),
                    sourceTitle: (page as any)?.title ?? null,
                    stationsCount: updated.nodes.length,
                    stations: updated.nodes.map((n) => ({ stationKey: n.stationKey, title: n.title })),
                });
            } catch (err: any) {
                return `Error importing Confluence page: ${err.message}`;
            }
        },
    },

    scribe_publish_to_confluence: {
        name: "scribe_publish_to_confluence",
        idempotency: "none",
        label: "Publish Scribe Manuscript to Confluence",
        group: "Authoring",
        description:
            "Compile the active manuscript and publish it to a Confluence space. " +
            "Pass pageId to update an existing page in place; omit it to create a new one.",
        parameters: z.object({
            credentialId: z.number().int().positive().describe("Confluence credential to write with"),
            spaceKey: z.string().optional().describe("Space to create the page in (required when creating)"),
            pageId: z.string().optional().describe("Existing page to update instead of creating"),
            title: z.string().optional().describe("Page title (defaults to the manuscript title)"),
            documentId: z.number().int().positive().optional().describe("Source document (defaults to this room's)"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const orgId = requireOrg(context);
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const { getConfluenceClient } = await import("@domain/integrations/confluence-service.js");

                const view = params.documentId
                    ? await scribeService.getDocument(params.documentId, orgId)
                    : context?.sessionId
                      ? await scribeService.getSessionDocument(context.sessionId, orgId)
                      : null;
                if (!view) return "Error publishing to Confluence: no active Scribe document in this room.";

                if (!params.pageId && !params.spaceKey) {
                    return "Error publishing to Confluence: provide spaceKey to create a page, or pageId to update one.";
                }

                const compiled = await scribeService.compileManuscript(view.document.id, orgId);
                const title = String(params.title ?? compiled.title);
                const client = await getConfluenceClient(params.credentialId, orgId as any);

                let result: any;
                if (params.pageId) {
                    // Confluence rejects an update that does not name the next
                    // version, so the current one has to be read first.
                    const existing: any = await client.getPage(String(params.pageId));
                    const currentVersion = Number(existing?.version?.number ?? existing?.version ?? 1);
                    result = await client.updatePage(String(params.pageId), title, compiled.content, currentVersion + 1);
                } else {
                    result = await client.createPage(String(params.spaceKey), title, compiled.content);
                }

                return JSON.stringify({
                    success: true,
                    action: params.pageId ? "updated" : "created",
                    pageId: String(result?.id ?? params.pageId ?? ""),
                    title,
                    wordCount: compiled.wordCount,
                });
            } catch (err: any) {
                return `Error publishing to Confluence: ${err.message}`;
            }
        },
    },

    scribe_configure_stations: {
        name: "scribe_configure_stations",
        idempotency: "none",
        label: "Configure Scribe Document Stations",
        group: "Authoring",
        description: "Reconfigures the document outline/stations (e.g. from a user-provided Table of Contents or outline). Creates or updates stations with custom titles, keys, and sort order.",
        parameters: z.object({
            documentId: z.number().optional().describe("ID of the Scribe document (or inferred from session context)"),
            stations: z.array(z.object({
                title: z.string().describe("Station title (e.g. '1. Functional Requirements')"),
                stationKey: z.string().optional().describe("Unique slug/key for the station"),
                sortOrder: z.number().optional().describe("Display order of the station (1-based)"),
                targetPercentage: z.number().optional().describe("Pacing percentage target (0.0 to 1.0)"),
                content: z.string().optional().describe("Initial draft content for this station"),
            })).describe("The ordered list of stations for the document outline"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const orgId = requireOrg(context);
                let docId = params.documentId;
                if (!docId && context?.sessionId) {
                    const existing = await scribeService.createOrGetDocument(context.sessionId, orgId);
                    docId = existing.document.id;
                }
                if (!docId) {
                    return "Error configuring Scribe stations: no documentId provided or found in session context.";
                }
                const docView = await scribeService.configureStations(
                    docId,
                    orgId,
                    params.stations
                );
                return JSON.stringify({
                    success: true,
                    documentId: docView.document.id,
                    stationsCount: docView.nodes.length,
                    stations: docView.nodes.map((n) => ({
                        id: n.id,
                        stationKey: n.stationKey,
                        title: n.title,
                        sortOrder: n.sortOrder,
                    })),
                    message: `Configured ${docView.nodes.length} stations for "${docView.document.title}".`,
                });
            } catch (err: any) {
                return `Error configuring Scribe stations: ${err.message}`;
            }
        },
    },

    scribe_fork_branch: {
        name: "scribe_fork_branch",
        idempotency: "none",
        label: "Fork Scribe Subway Branch",
        group: "Authoring",
        description: "Forks a new subway track branch to explore an alternate plot twist, counterparty concession, or architectural option.",
        parameters: z.object({
            documentId: z.number().describe("ID of the Scribe document"),
            stationKey: z.string().describe("The station where the branch diverges"),
            branchName: z.string().describe("Name of the branch (e.g. 'Branch B: Stealth Approach' or 'Concession: 2x Fee Cap')"),
            description: z.string().optional().describe("Rationale for this branch"),
            spawnBreakoutRoom: z.boolean().default(false).describe("Whether to create a linked CREW breakout session"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const result = await scribeService.forkBranch(
                    params.documentId,
                    requireOrg(context),
                    params.stationKey,
                    params.branchName,
                    params.description,
                    params.spawnBreakoutRoom,
                    context?.sessionId
                );

                return JSON.stringify({
                    success: true,
                    branchId: result.branch.id,
                    branchKey: result.branch.branchKey,
                    name: result.branch.name,
                    breakoutSessionKey: result.breakoutSessionKey,
                });
            } catch (err: any) {
                return `Error forking Scribe branch: ${err.message}`;
            }
        },
    },

    scribe_reconcile_continuity: {
        name: "scribe_reconcile_continuity",
        idempotency: "none",
        label: "Reconcile Document Continuity",
        group: "Authoring",
        description: "Runs forward-propagation causality analysis across downstream stations to detect contradictions caused by upstream branch edits.",
        parameters: z.object({
            documentId: z.number().describe("ID of the Scribe document"),
            sourceSortOrder: z.number().default(1).describe("The sort order of the station where the modification occurred"),
            sourceContent: z.string().describe("The modified upstream text content"),
            sourceStationKey: z.string().describe("The modified upstream station key"),
            branchId: z.number().optional().describe("Specific branch ID to check"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const { continuityEngine } = await import("@domain/scribe/core/continuity-engine.service.js");
                const docView = await scribeService.getDocument(params.documentId, requireOrg(context), params.branchId);
                const result = await continuityEngine.analyzeDownstreamContinuity(
                    params.documentId,
                    docView.activeBranch.id,
                    params.sourceSortOrder,
                    params.sourceContent,
                    params.sourceStationKey
                );

                return JSON.stringify({
                    success: true,
                    analyzedNodes: result.analyzedNodes,
                    conflictsFound: result.conflicts.length,
                    conflicts: result.conflicts,
                });
            } catch (err: any) {
                return `Error analyzing continuity: ${err.message}`;
            }
        },
    },

    scribe_run_critic_pass: {
        name: "scribe_run_critic_pass",
        idempotency: "none",
        label: "Run Multi-Lens Critic Evaluation",
        group: "Authoring",
        description: "Evaluates the document against specialized persona lenses (Legal Sentinel, Stylistic Pal, Pacing Auditor, Devil's Advocate).",
        parameters: z.object({
            documentId: z.number().describe("ID of the Scribe document"),
            nodeId: z.number().optional().describe("Specific station node to evaluate (or all if omitted)"),
            lenses: z.array(z.enum(["legal", "stylistic", "pacing", "devils_advocate", "fact_check"])).default(["legal", "stylistic", "devils_advocate"]),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const annotations = await scribeService.runCriticEvaluation(
                    params.documentId,
                    requireOrg(context),
                    params.nodeId,
                    params.lenses as ScribeLensType[]
                );

                return JSON.stringify({
                    success: true,
                    annotationsGenerated: annotations.length,
                    annotations: annotations.map((a) => ({
                        id: a.id,
                        lensType: a.lensType,
                        severity: a.severity,
                        title: a.title,
                        critiqueBody: a.critiqueBody,
                    })),
                });
            } catch (err: any) {
                return `Error running critic evaluation: ${err.message}`;
            }
        },
    },

    scribe_export_manuscript: {
        name: "scribe_export_manuscript",
        idempotency: "none",
        label: "Compile & Export Manuscript",
        group: "Authoring",
        description: "Compiles all stations in the active Scribe Studio document into formatted Markdown, PDF, or Word DOCX.",
        parameters: z.object({
            documentId: z.number().describe("ID of the Scribe document"),
            format: z.enum(["markdown", "pdf", "word"]).default("markdown").describe("Export format"),
            branchId: z.number().optional().describe("Specific branch to export (defaults to active branch)"),
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { scribeService } = await import("@domain/scribe/core/scribe.service.js");
                const orgId = requireOrg(context);
                const compiled = await scribeService.compileManuscript(params.documentId, orgId, params.branchId);

                if (params.format === "pdf" || params.format === "word") {
                    const { GENERATION_TOOLS } = await import("./generation.js");
                    // The generation tools file the artifact against the caller
                    // in context, so the room's own context has to reach them.
                    const tool = params.format === "pdf" ? GENERATION_TOOLS.generate_pdf : GENERATION_TOOLS.generate_word;
                    return await tool.execute(
                        { title: compiled.title, content: compiled.content },
                        context as ToolContext,
                    );
                }

                return JSON.stringify({
                    success: true,
                    title: compiled.title,
                    wordCount: compiled.wordCount,
                    contentPreview: compiled.content.slice(0, 500) + "...",
                });
            } catch (err: any) {
                return `Error exporting manuscript: ${err.message}`;
            }
        },
    },
};
