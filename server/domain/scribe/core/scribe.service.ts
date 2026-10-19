/**
 * Scribe Studio Service
 *
 * Core domain service for longform manuscript management, subway branch forking,
 * breakout room delegation, multi-lens critic evaluation, and document compilation.
 */

import { db } from "@server/database_service.js";
import {
    scribeDocuments,
    scribeAuthoringOperations,
    scribeBranches,
    scribeNodes,
    scribeAnnotations,
    scribeEntityLedger,
    crewSessions,
    crewTurns,
    ScribeArchetypeMode,
    ScribeDocument,
    ScribeBranch,
    ScribeNode,
    ScribeAnnotation,
    ScribeEntityLedgerEntry,
    ScribeLensType,
    ScribeAnnotationSeverity,
    ScribeAnnotationStatus,
} from "@shared/schema/index.js";
import { eq, ne, and, asc, desc, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { authoringOperationService } from "./authoring-operation.service.js";
import type { ScribeSourceReference } from "@shared/schema/index.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { getFramework } from "../frameworks/index.js";
import { continuityEngine } from "./continuity-engine.service.js";
import { systemAiService } from "@domain/ai/index.js";
import { evaluateAmbient, highestSeverity, insightsChanged, type AmbientInsight } from "./ambient-sentinel.service.js";
import { extractDefinedTerms, findUndefinedTerms, findTermDrift } from "./defined-terms.service.js";
import { type DataTether } from "./figures.service.js";
import { markStaleness, type AnnotationView } from "@shared/scribe-annotation-staleness.js";
import { computeTelemetry, isStationDrafted, type DocumentTelemetry } from "@shared/scribe-telemetry.js";
import { screenProposal } from "./proposal-safety.service.js";
import {
    shouldReviewOnSave,
    getReviewState,
    recordReview,
    logSkip,
    lensesForArchetype,
    buildAmbientPrompt,
    parseAmbientFindings,
} from "./ambient-tier2.service.js";
import { crewStreamService } from "@domain/crew/core/crew-stream.service.js";
import { attachmentService } from "@domain/knowledge/core/attachment.service.js";
import { ephemeralVaultCache } from "./ephemeral-vault-cache.service.js";
import { scribeVersioningService } from "./scribe-versioning.service.js";

const logger = createLogger("ScribeService");

/** Re-exported from its shared home, where the client reads it too. */
export type { DocumentTelemetry };

/**
 * One ambient finding as the canvas renders it.
 *
 * The canonical definition. LivingDocumentCanvas re-exports this rather than
 * declaring its own — the two copies had already drifted, with the client
 * knowing about rule-engine findings and the server not.
 */
export interface ScribeLiveInsight {
    id: string;
    /**
     * "RuleEngine" is Tier 1 — a deterministic pattern, not an agent. Calling a
     * regex match LegalSentinel would tell the author a model reviewed their
     * clause when none did.
     */
    agentRole: "GhostWriter" | "LegalSentinel" | "Critic" | "CopyEditor" | "RuleEngine";
    /** Mirrors ScribeLensType, so an insight can be promoted to an annotation. */
    lensType:
        | "stylistic"
        | "legal"
        | "pacing"
        | "devils_advocate"
        | "compliance"
        | "fact_check"
        | "note"
        | "todo"
        | "highlight";
    type: "suggestion" | "warning" | "praise" | "missing_term";
    title: string;
    message: string;
    originalExcerpt?: string;
    /** Tier 1 rules report; they do not rewrite. Only Tier 2 fills this. */
    suggestedReplacement?: string;
    /** For term drift: the spelling the document defined. */
    canonical?: string;
    /** Absent for a rule match, which is a literal hit rather than a judgement. */
    confidence?: number;
}

/**
 * One manuscript in the page tree, with its children nested beneath it.
 *
 * Deliberately not FullDocumentView: a tree renders titles and structure, and
 * loading every station of every document to draw a sidebar would be the
 * expensive half of the payload thrown away.
 */
export interface ScribeDocumentTreeNode {
    id: number;
    title: string;
    parentDocumentId: number | null;
    labels: string[];
    archetypeMode: string;
    sessionId: number;
    updatedAt: Date;
    children: ScribeDocumentTreeNode[];
}

export interface FullDocumentView {
    document: ScribeDocument;
    activeBranch: ScribeBranch;
    allBranches: ScribeBranch[];
    nodes: ScribeNode[];
    /**
     * Each carries whether it still describes text that exists. Nothing has
     * ever invalidated an annotation, so a critique of a deleted paragraph
     * stayed open, kept scoring, and kept offering to apply a fix for text that
     * is gone. Derived rather than stored: a computed answer cannot drift out
     * of step with the content the way a persisted flag would.
     */
    annotations: AnnotationView[];
    entityLedger: ScribeEntityLedgerEntry[];
    telemetry: DocumentTelemetry;
}

/** The generated table-of-contents station, which is not part of an outline. */
export const TABLE_OF_CONTENTS_KEY = "table_of_contents";

/**
 * Titles compared the way a reader would compare them.
 *
 * An outline round-tripped through chat comes back as "2. Scope & Objectives"
 * where the stored title is "Scope and Objectives". Matching those as different
 * sections is what turns a rename into a delete-and-recreate, taking the prose
 * with it, so numbering, punctuation and "and"/"&" are normalised away.
 */
export function normalizeStationTitle(title: string): string {
    return (title ?? "")
        .toLowerCase()
        .replace(/^\s*\d+[.)]\s*/, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Whether an author has actually written in this station.
 *
 * Three kinds of content look like prose and are not:
 *
 *   - framework scaffolding, which createOrGetDocument inserts with wordCount 0;
 *   - a generated `# Title` heading stub, which has words but no body;
 *   - an empty station.
 *
 * Only the combination separates them: word count catches the scaffolding, and
 * stripping a leading heading catches the stub. Getting this wrong in either
 * direction is costly — too strict and reconciliation deletes paragraphs, too
 * loose and every placeholder survives forever as clutter the author must remove
 * by hand.
 */
export function hasAuthoredProse(node: Pick<ScribeNode, "content" | "wordCount" | "status">): boolean {
    if (node.status === "approved") return true;
    if ((node.wordCount ?? 0) === 0) return false;
    const body = (node.content ?? "").replace(/^\s*#{1,6}\s+[^\n]*\n?/, "").trim();
    return body.length > 0;
}

/** A station key that does not collide with one already in the outline. */
export function stationKeyFor(
    title: string,
    index: number,
    taken: Map<string, unknown>,
): string {
    const base =
        title
            .toLowerCase()
            .replace(/^\s*\d+[.)]\s*/, "")
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 40) || `station_${index}`;
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
}

function isGenericTitle(t?: string): boolean {
    if (!t) return true;
    const clean = t.trim().toLowerCase();
    return (
        clean === "" ||
        clean === "new document" ||
        clean === "untitled document" ||
        clean === "untitled manuscript" ||
        clean === "manuscript / agreement" ||
        clean === "manuscript" ||
        clean === "agreement" ||
        clean === "draft" ||
        clean === "new specification document" ||
        clean === "untitled"
    );
}

export class ScribeService {
    /** Read the active manuscript without creating or re-framing it. */
    async getSessionDocument(sessionId: number, organizationId: number): Promise<FullDocumentView | null> {
        const [document] = await db.select().from(scribeDocuments)
            .where(and(eq(scribeDocuments.sessionId, sessionId), eq(scribeDocuments.organizationId, organizationId)))
            .limit(1);
        return document ? this.getDocument(document.id, organizationId) : null;
    }

    /**
     * The Table of Contents body, rendered from the sections in sort order.
     *
     * Shared by addTableOfContents and refreshTableOfContentsIfPresent so the two
     * cannot drift: a TOC written by the explicit action and one rebuilt after a
     * rename have to be byte-identical, or a rename silently reformats the page.
     * Leading "1." / "2)" numbering is stripped from titles because the list
     * supplies its own.
     */
    private renderTableOfContents(sections: ScribeNode[]): string {
        return (
            `# Table of Contents\n\n` +
            sections.map((n, i) => `${i + 1}. [${n.title.replace(/^\d+[.)]\s*/, "")}](#${n.stationKey})`).join("\n") +
            "\n"
        );
    }

    /** A TOC is an edit, not a new framework. Keep every existing station intact. */
    async addTableOfContents(documentId: number, organizationId: number): Promise<FullDocumentView> {
        await this.requireDocument(documentId, organizationId);
        await db.transaction(async (tx) => {
            const [doc] = await tx.select().from(scribeDocuments)
                .where(and(eq(scribeDocuments.id, documentId), eq(scribeDocuments.organizationId, organizationId)))
                .for("update");
            const nodes = await tx.select().from(scribeNodes)
                .where(and(eq(scribeNodes.documentId, documentId), eq(scribeNodes.branchId, doc.activeBranchId!)))
                .orderBy(asc(scribeNodes.sortOrder));
            const toc = nodes.find((n) => n.stationKey === "table_of_contents");
            const sections = nodes.filter((n) => n.stationKey !== "table_of_contents");
            if (!sections.length) throw new Error("Add document sections before generating a table of contents.");
            const content = this.renderTableOfContents(sections);
            const values = { content, contentRich: null, wordCount: content.split(/\s+/).filter(Boolean).length,
                sortOrder: Math.min(...sections.map((n) => n.sortOrder)) - 1, updatedAt: new Date() };
            if (toc) {
                await tx.update(scribeNodes).set(values).where(eq(scribeNodes.id, toc.id));
            } else {
                await tx.insert(scribeNodes).values({ ...values, documentId, branchId: doc.activeBranchId!,
                    stationKey: "table_of_contents", title: "Table of Contents", status: "draft", targetPercentage: 0 });
            }
        });
        return this.getDocument(documentId, organizationId);
    }
    /**
     * Resets an existing Scribe document for a new subject or fresh start.
     * Clears all old station nodes and annotations, restoring clean framework stations.
     */
    public async resetDocument(
        documentId: number,
        organizationId: number,
        options?: {
            newTitle?: string;
            archetypeMode?: ScribeArchetypeMode;
            targetWordCount?: number;
        }
    ): Promise<FullDocumentView> {
        const doc = await this.requireDocument(documentId, organizationId);

        // The reset is about to delete every station on the document. The
        // snapshot must precede the deletes or the one operation that most
        // needs a restore point erases its own history at the moment it runs.
        // It also must not fail silently: a reset that cannot write its only
        // insurance does not get to proceed.
        await scribeVersioningService.recordDocumentRevision(doc, organizationId, {
            kind: "reset",
            message: `Pre-reset snapshot of "${doc.title}"`,
            actor: "author",
        });

        const nextMode: ScribeArchetypeMode =
            options?.archetypeMode ?? (doc.archetypeMode as ScribeArchetypeMode) ?? "freeform";
        const framework = getFramework(nextMode);
        const resolvedWordCount =
            options?.targetWordCount ?? doc.targetWordCount ?? framework.defaultTargetWordCount;
        const newTitle = options?.newTitle?.trim() || doc.title;

        // Ensure main branch exists
        let mainBranch = (
            await db
                .select()
                .from(scribeBranches)
                .where(
                    and(
                        eq(scribeBranches.documentId, doc.id),
                        eq(scribeBranches.branchKey, "main")
                    )
                )
                .limit(1)
        )[0];

        if (!mainBranch) {
            const [created] = await db
                .insert(scribeBranches)
                .values({
                    documentId: doc.id,
                    branchKey: "main",
                    name: "Main Manuscript (Trunk)",
                    description: "Primary baseline manuscript",
                    status: "active",
                    createdAt: new Date(),
                })
                .returning();
            mainBranch = created;
        }

        // 1. Delete all existing annotations to avoid stale findings
        await db.delete(scribeAnnotations).where(eq(scribeAnnotations.documentId, doc.id));

        // 2. Delete all existing stations
        await db.delete(scribeNodes).where(eq(scribeNodes.documentId, doc.id));

        // 3. Archive non-main branches
        await db
            .update(scribeBranches)
            .set({ status: "archived" })
            .where(
                and(
                    eq(scribeBranches.documentId, doc.id),
                    ne(scribeBranches.id, mainBranch.id)
                )
            );

        // 4. Update document metadata
        await db
            .update(scribeDocuments)
            .set({
                title: newTitle,
                archetypeMode: nextMode,
                activeBranchId: mainBranch.id,
                targetWordCount: resolvedWordCount,
                currentRevision: 1,
                updatedAt: new Date(),
            })
            .where(eq(scribeDocuments.id, doc.id));

        // 5. Pre-populate fresh Subway Stations from Framework Definition
        const nodeInserts = framework.stations.map((station, idx) => ({
            documentId: doc.id,
            branchId: mainBranch.id,
            stationKey: station.stationKey,
            title: station.title,
            sortOrder: idx + 1,
            targetPercentage: station.targetPercentage,
            content: station.suggestedScaffolding || "",
            wordCount: 0,
            status: "draft" as const,
            continuityNotes: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        await db.insert(scribeNodes).values(nodeInserts);

        logger.info(
            `[Scribe] Reset document #${doc.id} for new subject "${newTitle}" (${framework.stations.length} stations in ${nextMode} mode)`
        );

        const [freshDoc] = await db
            .select()
            .from(scribeDocuments)
            .where(eq(scribeDocuments.id, doc.id))
            .limit(1);
        void scribeVersioningService
            .recordDocumentRevision(freshDoc ?? doc, organizationId, {
                kind: "commit",
                message: `Reset to "${newTitle}" (${nextMode})`,
                actor: "author",
            })
            .catch((err) => logger.warn(`[Scribe] Post-reset revision failed: ${err?.message ?? err}`));

        return this.getDocument(doc.id, organizationId);
    }

    /**
     * Returns the full document view for an existing document or bootstraps a
     * new document with default stations for a session if one does not exist.
     * When reset is true or the subject/title changes, the document is reset.
     */
    public async createOrGetDocument(
        sessionId: number,
        organizationId: number,
        title?: string,
        /**
         * Left undefined by a caller with no opinion — which is not the same as
         * asking for freeform. It used to default to "freeform" here, so a bare
         * re-fetch was indistinguishable from an explicit request and could
         * re-frame a specialised document down to the generic skeleton.
         */
        archetypeMode?: ScribeArchetypeMode,
        targetWordCount?: number,
        reset?: boolean
    ): Promise<FullDocumentView> {
        logger.info(
            `[Scribe] Fetching or initializing document for session ${sessionId} ` +
            `(Mode: ${archetypeMode ?? "unspecified"}, Reset: ${Boolean(reset)})`,
        );

        // Check if document already exists for session
        const [existing] = await db
            .select()
            .from(scribeDocuments)
            .where(
                and(
                    eq(scribeDocuments.sessionId, sessionId),
                    eq(scribeDocuments.organizationId, organizationId),
                )
            )
            .limit(1);

        if (existing) {
            const subjectChanged = Boolean(
                title &&
                !isGenericTitle(title) &&
                !isGenericTitle(existing.title) &&
                existing.title.trim().toLowerCase() !== title.trim().toLowerCase()
            );

            if (reset || subjectChanged) {
                logger.info(
                    `[Scribe] Resetting document #${existing.id} for session ${sessionId} ` +
                    `(reason: ${reset ? "explicit_reset" : `subject_changed_from_${existing.title}_to_${title}`})`
                );
                return this.resetDocument(existing.id, organizationId, {
                    newTitle: title,
                    archetypeMode,
                    targetWordCount,
                });
            }

            // If existing title was generic and caller supplied a specific title, adopt it
            if (title && !isGenericTitle(title) && isGenericTitle(existing.title)) {
                await db
                    .update(scribeDocuments)
                    .set({ title: title.trim(), updatedAt: new Date() })
                    .where(eq(scribeDocuments.id, existing.id));
                existing.title = title.trim();
            }

            // Only an explicit request re-frames anything.
            return archetypeMode
                ? this.reconcileArchetype(existing, organizationId, archetypeMode, targetWordCount)
                : this.getDocument(existing.id, organizationId);
        }

        const createMode: ScribeArchetypeMode = archetypeMode ?? "freeform";
        const framework = getFramework(createMode);
        const resolvedWordCount = targetWordCount || framework.defaultTargetWordCount;

        // 1. Create Document Master Record
        const [doc] = await db
            .insert(scribeDocuments)
            .values({
                organizationId,
                sessionId,
                title: title || `${framework.name} - Draft`,
                archetypeMode: createMode,
                targetWordCount: resolvedWordCount,
                settings: {
                    autoContinuity: true,
                    ghostWriter: true,
                    defaultLenses: framework.defaultLenses,
                    toneTarget: { formality: 7, brevity: 5, posture: 6 },
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        // 2. Create Default 'main' Branch
        const [mainBranch] = await db
            .insert(scribeBranches)
            .values({
                documentId: doc.id,
                branchKey: "main",
                name: "Main Manuscript (Trunk)",
                description: "Primary baseline manuscript",
                status: "active",
                createdAt: new Date(),
            })
            .returning();

        // Set active branch on document
        await db
            .update(scribeDocuments)
            .set({ activeBranchId: mainBranch.id })
            .where(eq(scribeDocuments.id, doc.id));

        // 3. Pre-populate Subway Stations from Framework Definition
        const nodeInserts = framework.stations.map((station, idx) => ({
            documentId: doc.id,
            branchId: mainBranch.id,
            stationKey: station.stationKey,
            title: station.title,
            sortOrder: idx + 1,
            targetPercentage: station.targetPercentage,
            content: station.suggestedScaffolding || "",
            wordCount: 0,
            status: "draft" as const,
            continuityNotes: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        await db.insert(scribeNodes).values(nodeInserts);

        logger.info(`[Scribe] Initialized new document #${doc.id} with ${framework.stations.length} stations`);

        // The first revision — the base every later diff and rollback works
        // from. The doc row predates the activeBranchId update above, so the
        // branch is passed explicitly.
        void scribeVersioningService
            .recordDocumentRevision(
                { ...doc, activeBranchId: mainBranch.id },
                organizationId,
                { kind: "commit", message: "Document initialized", actor: "system", branchId: mainBranch.id },
            )
            .catch((err) => logger.warn(`[Scribe] Initial revision failed for document ${doc.id}: ${err?.message ?? err}`));

        return this.getDocument(doc.id, organizationId);
    }

    /**
     * Give an existing session document the archetype the caller asked for.
     *
     * createOrGetDocument used to return the stored document and discard the
     * requested mode entirely, so whichever path reached a session first
     * decided its framework for good. Ask for an SOW after anything had opened
     * the studio and you got the freeform "Overview / Main Body / Conclusion"
     * skeleton, with the tool reporting success and the log line naming the
     * mode it had just ignored.
     *
     * Re-framing replaces the stations, so it is only safe while none of them
     * has been written in — that is the whole guard. An author who has drafted
     * into a document must never lose it to a later tool call, so a written
     * document keeps its framework and the caller is told the request was not
     * honoured rather than being left to assume it was.
     */
    private async reconcileArchetype(
        existing: ScribeDocument,
        organizationId: number,
        requested: ScribeArchetypeMode,
        targetWordCount?: number,
    ): Promise<FullDocumentView> {
        const view = await this.getDocument(existing.id, organizationId);
        if (requested === view.document.archetypeMode) return view;

        // Seeded scaffolding is not writing: isStationDrafted keys on word
        // count, which the seed leaves at zero.
        const written = view.nodes.some(isStationDrafted);
        if (written) {
            logger.warn(
                `[Scribe] Document #${existing.id} was asked for "${requested}" but is already drafted ` +
                `as "${view.document.archetypeMode}"; keeping the author's stations.`,
            );
            return view;
        }

        // More than one branch means someone has been working, whatever the
        // word counts say. Replacing stations under a fork would strand it.
        if (view.allBranches.length > 1) {
            logger.warn(
                `[Scribe] Document #${existing.id} has ${view.allBranches.length} branches; ` +
                `not re-framing to "${requested}".`,
            );
            return view;
        }

        const framework = getFramework(requested);
        logger.info(`[Scribe] Re-framing untouched document #${existing.id} to "${requested}".`);

        // Best-effort pre-reframe snapshot. This path only runs when nothing
        // is written, so even if the history row loses the race with the
        // deletes below, the only state it can miss is scaffolding.
        void scribeVersioningService
            .recordDocumentRevision(existing, organizationId, {
                kind: "reset",
                message: `Pre-reframe snapshot before "${requested}"`,
                actor: "author",
            })
            .catch((err) => logger.warn(`[Scribe] Pre-reframe revision failed: ${err?.message ?? err}`));

        await db
            .update(scribeDocuments)
            .set({
                archetypeMode: requested,
                targetWordCount: targetWordCount || framework.defaultTargetWordCount,
                updatedAt: new Date(),
            })
            .where(eq(scribeDocuments.id, existing.id));

        // Annotations cascade from their node, which is what we want: a finding
        // against a station that no longer exists is not worth keeping.
        await db.delete(scribeNodes).where(eq(scribeNodes.documentId, existing.id));

        await db.insert(scribeNodes).values(
            framework.stations.map((station, idx) => ({
                documentId: existing.id,
                branchId: view.activeBranch.id,
                stationKey: station.stationKey,
                title: station.title,
                sortOrder: idx + 1,
                targetPercentage: station.targetPercentage,
                content: station.suggestedScaffolding || "",
                wordCount: 0,
                status: "draft" as const,
                continuityNotes: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
        );

        return this.getDocument(existing.id, organizationId);
    }

    /**
     * Load a document only if it belongs to the caller's organization.
     *
     * Every public method that addresses a document, node, or annotation by its
     * integer id routes through here first. Ids are guessable and arrive
     * straight off request bodies and model-authored tool arguments, so an
     * unscoped `eq(id)` read is a cross-tenant read.
     */
    private async requireDocument(documentId: number, organizationId: number): Promise<ScribeDocument> {
        const [doc] = await db
            .select()
            .from(scribeDocuments)
            .where(
                and(
                    eq(scribeDocuments.id, documentId),
                    eq(scribeDocuments.organizationId, organizationId),
                )
            )
            .limit(1);

        if (!doc) {
            // Deliberately indistinguishable from a genuinely absent document:
            // a distinct "forbidden" would confirm the id exists elsewhere.
            throw Object.assign(new Error(`Scribe document ${documentId} not found`), { status: 404 });
        }
        return doc;
    }

    /** Resolve a node to its owning document, enforcing the org boundary. */
    private async requireNode(nodeId: number, organizationId: number): Promise<ScribeNode> {
        const [row] = await db
            .select({ node: scribeNodes })
            .from(scribeNodes)
            .innerJoin(scribeDocuments, eq(scribeNodes.documentId, scribeDocuments.id))
            .where(
                and(
                    eq(scribeNodes.id, nodeId),
                    eq(scribeDocuments.organizationId, organizationId),
                )
            )
            .limit(1);

        if (!row) {
            throw Object.assign(new Error(`Node #${nodeId} not found`), { status: 404 });
        }
        return row.node;
    }

    /** Resolve an annotation to its owning document, enforcing the org boundary. */
    private async requireAnnotation(annotationId: number, organizationId: number): Promise<ScribeAnnotation> {
        const [row] = await db
            .select({ annotation: scribeAnnotations })
            .from(scribeAnnotations)
            .innerJoin(scribeDocuments, eq(scribeAnnotations.documentId, scribeDocuments.id))
            .where(
                and(
                    eq(scribeAnnotations.id, annotationId),
                    eq(scribeDocuments.organizationId, organizationId),
                )
            )
            .limit(1);

        if (!row) {
            throw Object.assign(new Error(`Annotation ${annotationId} not found`), { status: 404 });
        }
        return row.annotation;
    }

    /**
     * Retrieve full document view including active branch nodes, annotations, and telemetry
     */
    async getDocument(
        documentId: number,
        organizationId: number,
        branchId?: number
    ): Promise<FullDocumentView> {
        const doc = await this.requireDocument(documentId, organizationId);

        const allBranches = await db
            .select()
            .from(scribeBranches)
            .where(eq(scribeBranches.documentId, documentId))
            .orderBy(asc(scribeBranches.createdAt));

        const targetBranchId = branchId || doc.activeBranchId || allBranches[0]?.id;
        const activeBranch = allBranches.find((b) => b.id === targetBranchId) || allBranches[0];

        const nodes = await db
            .select()
            .from(scribeNodes)
            .where(
                and(
                    eq(scribeNodes.documentId, documentId),
                    eq(scribeNodes.branchId, activeBranch.id)
                )
            )
            .orderBy(asc(scribeNodes.sortOrder));

        const storedAnnotations = await db
            .select()
            .from(scribeAnnotations)
            .where(eq(scribeAnnotations.documentId, documentId))
            .orderBy(desc(scribeAnnotations.createdAt));

        // Annotations are fetched for the whole document while nodes are for
        // the active branch only, so this also catches the other branch's
        // findings arriving in the payload and scoring against this one.
        const annotations = markStaleness(storedAnnotations, nodes);

        const entityLedger = await db
            .select()
            .from(scribeEntityLedger)
            .where(eq(scribeEntityLedger.documentId, documentId))
            .orderBy(asc(scribeEntityLedger.termName));

        // Shared with the client, which re-derives it from the same nodes as
        // the author types. This used to be computed here and only here, so the
        // footer froze at its page-load figures for the rest of the session.
        const telemetry = computeTelemetry(nodes, doc.targetWordCount);

        return {
            document: doc,
            activeBranch,
            allBranches,
            nodes,
            annotations,
            entityLedger,
            telemetry,
        };
    }

    /**
     * Update station content, recalculate word count, and trigger downstream continuity check
     */
    async updateNodeContent(
        nodeId: number,
        organizationId: number,
        content?: string,
        contentRich?: Record<string, unknown>,
        status?: "draft" | "in_review" | "approved",
        targetExcerpt?: string,
        replacementExcerpt?: string,
        /**
         * Who asked for this and why.
         *
         * Optional so every existing caller keeps working, but supplying it is
         * what turns a station's content from the only evidence an edit happened
         * into one of several — see authoring-operation.service.ts. The write
         * itself is unchanged either way; what changes is whether anything can
         * tell afterwards that it was attempted.
         */
        provenance?: {
            expectedContent?: string;
            actor?: string;
            request?: string;
            sessionId?: number | null;
            turnId?: number | null;
            sources?: ScribeSourceReference[];
            constraints?: Record<string, unknown>;
        },
    ): Promise<ScribeNode> {
        const node = await this.requireNode(nodeId, organizationId);
        // Opened before ANY work that can fail, including resolving the
        // excerpt. The first version of this sat after that resolution, so a
        // "target excerpt not found" throw left no row at all — which is the
        // exact absence the table exists to prevent, reintroduced one line too
        // low. A test covers it now.
        const operation = await authoringOperationService.begin({
            organizationId,
            documentId: node.documentId,
            nodeId,
            branchId: node.branchId,
            sessionId: provenance?.sessionId ?? null,
            turnId: provenance?.turnId ?? null,
            actor: provenance?.actor ?? "author",
            operation: targetExcerpt ? "replace_excerpt" : "update_node",
            // Commentary and document content in separate columns, deliberately.
            request: provenance?.request ?? null,
            constraints: { ...provenance?.constraints, beforeContent: node.content ?? "", beforeStatus: node.status, targetExcerpt, replacementExcerpt },
            // What the caller asked to write. The resolved text is recorded on
            // settle, once the excerpt has actually been located.
            proposedContent: content ?? replacementExcerpt ?? null,
            sources: provenance?.sources ?? [],
        });

        let finalContent = content ?? node.content ?? "";
        let updated: ScribeNode | undefined;
        try {
            if (provenance?.expectedContent !== undefined && provenance.expectedContent !== (node.content ?? "")) {
                throw new Error("The section changed after it was read. Read it again and reconcile the author's edits before rewriting.");
            }
            if (targetExcerpt && replacementExcerpt !== undefined) {
                const current = node.content ?? "";
                const occurrences = current.split(targetExcerpt).length - 1;
                if (occurrences === 0) {
                    throw new Error(`Target excerpt not found in station content: "${targetExcerpt}"`);
                }
                // replace() takes the first match, which may not be the passage the
                // author selected.
                if (occurrences > 1) {
                    throw new Error("The selected text appears more than once. Select a unique passage before applying this rewrite.");
                }
                finalContent = current.replace(targetExcerpt, replacementExcerpt);
            }

            const words = finalContent.trim().split(/\s+/).filter(Boolean).length;
            [updated] = await db
                .update(scribeNodes)
                .set({
                    content: finalContent,
                    contentRich: contentRich || undefined,
                    wordCount: words,
                    status: status || undefined,
                    updatedAt: new Date(),
                })
                .where(and(eq(scribeNodes.id, nodeId), sql`coalesce(${scribeNodes.content}, '') = ${node.content ?? ""}`))
                .returning();

            if (!updated) {
                throw new Error(`Station #${nodeId} changed while saving. Read the current text and retry without overwriting intervening edits.`);
            }

            // Reads the row back and compares rather than trusting that the
            // update returned. That distinction is the whole point: every
            // silent-success bug this session began with a caller believing its
            // own report.
            await authoringOperationService.settleApplied(operation.id, {
                nodeId,
                expectedContent: finalContent,
            });
        } catch (err: any) {
            await authoringOperationService
                .settleFailed(operation.id, err?.message ?? String(err))
                .catch(() => {});
            throw err;
        }

        // The version history records the state that just verified — after the
        // operation settles, so a failed write leaves no phantom revision.
        // Fire-and-forget like the other post-write side effects (term sync,
        // ambient review, continuity): a history write must not block or fail
        // the author's save.
        void scribeVersioningService
            .recordNodeRevision(updated, organizationId, {
                kind: "edit",
                actor: provenance?.actor,
                message: provenance?.request?.slice(0, 200),
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed for node ${nodeId}: ${err?.message ?? err}`));

        // Keep the defined-term ledger current. Cheap, deterministic, and the
        // thing that turns a per-station check into a document-wide one: a term
        // defined in section 2 has to be known while editing section 9.
        void this.syncDefinedTerms(updated).catch((err) =>
            logger.warn(`[Scribe] Defined-term sync failed: ${err?.message ?? err}`),
        );

        // Tier 2 ambient review, on the save boundary rather than per delta.
        // Fire-and-forget: an author's save must not wait on a model, and a
        // failed review must not fail the write.
        void this.reviewStationAmbient(updated, organizationId).catch((err) =>
            logger.warn(`[Scribe] Ambient Tier 2 review failed: ${err?.message ?? err}`),
        );

        // Trigger asynchronous continuity analysis for downstream nodes
        try {
            continuityEngine.analyzeDownstreamContinuity(
                updated.documentId,
                updated.branchId,
                updated.sortOrder,
                // finalContent, not the `content` argument: an excerpt
                // replacement leaves `content` undefined, and a call passing
                // both would have had continuity analyze the pre-replacement
                // text. This is what was actually written.
                finalContent,
                updated.stationKey
            ).catch((err) => logger.warn(`[Scribe] Async continuity run failed: ${err.message}`));
        } catch (err: any) {
            logger.warn(`[Scribe] Continuity trigger error: ${err.message}`);
        }

        return updated;
    }

    /**
     * Add a new station to a manuscript branch
     */
    async addStation(
        documentId: number,
        organizationId: number,
        titleOrOptions: string | { title: string; content?: string; stationKey?: string; branchId?: number },
        contentArg: string = "",
        branchIdArg?: number
    ): Promise<ScribeNode> {
        const title = typeof titleOrOptions === "object" ? titleOrOptions.title : titleOrOptions;
        const content = typeof titleOrOptions === "object" ? (titleOrOptions.content ?? "") : contentArg;
        const branchId = typeof titleOrOptions === "object" ? (titleOrOptions.branchId ?? branchIdArg) : branchIdArg;
        const customKey = typeof titleOrOptions === "object" ? titleOrOptions.stationKey : undefined;

        const doc = await this.requireDocument(documentId, organizationId);
        const targetBranchId = branchId || doc.activeBranchId;

        const existingNodes = await db
            .select()
            .from(scribeNodes)
            .where(
                and(
                    eq(scribeNodes.documentId, documentId),
                    eq(scribeNodes.branchId, targetBranchId!)
                )
            )
            .orderBy(asc(scribeNodes.sortOrder));

        const maxSortOrder = existingNodes.length > 0 ? Math.max(...existingNodes.map((n) => n.sortOrder)) : 0;
        const stationKey = customKey || `custom_${Date.now()}_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}`;
        const words = content.trim().split(/\s+/).filter(Boolean).length;

        const [newNode] = await db
            .insert(scribeNodes)
            .values({
                documentId,
                branchId: targetBranchId!,
                stationKey,
                title,
                content,
                sortOrder: maxSortOrder + 1,
                targetPercentage: 0.1,
                wordCount: words,
                status: "draft",
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        // Auto-refresh TOC if present
        await this.refreshTableOfContentsIfPresent(documentId, targetBranchId!);

        void scribeVersioningService
            .recordNodeRevision(newNode, organizationId, { kind: "add", message: `Station "${title}" added` })
            .catch((err) => logger.warn(`[Scribe] Revision write failed for new station: ${err?.message ?? err}`));

        return newNode;
    }

    /**
     * Delete a station from a manuscript branch
     */
    async deleteStation(
        nodeId: number,
        organizationId: number
    ): Promise<{ success: boolean; deletedId: number }> {
        const node = await this.requireNode(nodeId, organizationId);

        // The snapshot is the station's last state. The node row is already in
        // hand, so the record carries the pre-delete state even though the
        // delete below does not wait on it.
        void scribeVersioningService
            .recordNodeRevision(node, organizationId, { kind: "delete", message: `Station "${node.title}" deleted` })
            .catch((err) => logger.warn(`[Scribe] Revision write failed for deleted station ${nodeId}: ${err?.message ?? err}`));

        await db.delete(scribeNodes).where(eq(scribeNodes.id, nodeId));

        // Auto-refresh the Table of Contents if one exists
        await this.refreshTableOfContentsIfPresent(node.documentId, node.branchId);

        return { success: true, deletedId: nodeId };
    }

    /**
     * Rename a station title without touching its content.
     */
    async renameStation(
        nodeId: number,
        organizationId: number,
        newTitle: string
    ): Promise<ScribeNode> {
        const node = await this.requireNode(nodeId, organizationId);
        const [updated] = await db
            .update(scribeNodes)
            .set({ title: newTitle, updatedAt: new Date() })
            .where(eq(scribeNodes.id, nodeId))
            .returning();
        if (!updated) throw new Error(`Node #${nodeId} not found`);

        // Auto-refresh TOC if present
        await this.refreshTableOfContentsIfPresent(node.documentId, node.branchId);

        void scribeVersioningService
            .recordNodeRevision(updated, organizationId, { kind: "rename", message: `Renamed to "${newTitle}"` })
            .catch((err) => logger.warn(`[Scribe] Revision write failed for renamed station ${nodeId}: ${err?.message ?? err}`));

        return updated;
    }

    /**
     * Reorder stations on a branch by accepting an ordered list of node IDs.
     * Each ID receives a new sortOrder equal to its index + 1.
     */
    async reorderStations(
        documentId: number,
        organizationId: number,
        orderedNodeIds: number[],
        branchId?: number
    ): Promise<FullDocumentView> {
        const doc = await this.requireDocument(documentId, organizationId);
        const targetBranchId = branchId || doc.activeBranchId;

        for (let i = 0; i < orderedNodeIds.length; i++) {
            await db
                .update(scribeNodes)
                .set({ sortOrder: i + 1, updatedAt: new Date() })
                .where(
                    and(
                        eq(scribeNodes.id, orderedNodeIds[i]),
                        eq(scribeNodes.documentId, documentId),
                        eq(scribeNodes.branchId, targetBranchId!)
                    )
                );
        }

        // Auto-refresh TOC if present
        await this.refreshTableOfContentsIfPresent(documentId, targetBranchId!);

        void scribeVersioningService
            .recordDocumentRevision(doc, organizationId, {
                kind: "outline",
                message: `Stations reordered (${orderedNodeIds.length})`,
                branchId: targetBranchId ?? undefined,
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed on reorder: ${err?.message ?? err}`));

        return this.getDocument(documentId, organizationId, targetBranchId ?? undefined);
    }

    /**
     * If a Table of Contents station exists on the branch, rebuild its
     * markdown link entries to mirror the current stations and sort orders.
     * Called automatically after rename, reorder, delete, and configureStations.
     *
     * Takes no organizationId, deliberately. It is reached only from methods that
     * have already resolved the caller through requireDocument or requireNode, and
     * it addresses rows by the documentId and branchId those checks returned. An
     * unused org parameter here would read like a tenancy check without being one.
     */
    private async refreshTableOfContentsIfPresent(
        documentId: number,
        branchId: number
    ): Promise<void> {
        const nodes = await db
            .select()
            .from(scribeNodes)
            .where(
                and(
                    eq(scribeNodes.documentId, documentId),
                    eq(scribeNodes.branchId, branchId)
                )
            )
            .orderBy(asc(scribeNodes.sortOrder));

        const toc = nodes.find((n) => n.stationKey === "table_of_contents");
        if (!toc) return;

        const sections = nodes.filter((n) => n.stationKey !== "table_of_contents");
        if (!sections.length) return;

        const content = this.renderTableOfContents(sections);
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        await db
            .update(scribeNodes)
            .set({ content, wordCount, updatedAt: new Date() })
            .where(eq(scribeNodes.id, toc.id));
    }

    /**
     * Reconfigure stations for an outline/table of contents.
     * Updates existing stations by stationKey or sortOrder, adds new stations, or replaces stations if empty/fresh.
     */
    /**
     * Reconcile the outline against an incoming list of stations.
     *
     * Rewritten because the previous implementation lost work in three ways, and
     * an outline change is the one operation an author performs *expecting*
     * nothing to be lost.
     *
     * It decided with `hasSubstantialContent` — whether any station held more
     * than 100 characters — and if not, DELETED every node and re-inserted. Seven
     * stations of ninety characters each counted as empty. scribe_annotations.
     * node_id is ON DELETE CASCADE, so that delete also destroyed every critique
     * on the document, as a side effect of reordering a table of contents.
     *
     * When it did preserve, it matched `existingNodes[i]` to `stations[i]` BY
     * ARRAY INDEX. Inserting one section at the top therefore retitled every
     * station below it, attaching each title to the previous section's prose.
     *
     * And it ran a delete plus N inserts as separate statements, so a failure
     * midway left an outline that was neither the old one nor the new one.
     *
     * Now: match on identity, preserve prose, and do it atomically.
     *
     * - Stations are matched by stationKey, then by normalised title. Never by
     *   position, so reordering is reordering rather than reassignment.
     * - A matched station keeps its id, and therefore its annotations, revisions
     *   and continuity notes. Only title, order and pacing move; content changes
     *   only when the caller explicitly supplies it.
     * - A station absent from the new outline is deleted only if nothing was
     *   written in it. One carrying authored prose is kept and appended after the
     *   outline, because silently discarding an author's paragraphs is never the
     *   right reading of "reorganise the sections".
     * - The table of contents is left alone here and rebuilt afterwards; it is
     *   generated, not authored, so it is not part of the outline being reconciled.
     * - All of it in one transaction, and the document revision is bumped once, so
     *   a reader either sees the old outline or the new one.
     */
    async configureStations(
        documentId: number,
        organizationId: number,
        stations: Array<{
            title: string;
            stationKey?: string;
            sortOrder?: number;
            targetPercentage?: number;
            content?: string;
        }>,
        branchId?: number
    ): Promise<FullDocumentView> {
        const doc = await this.requireDocument(documentId, organizationId);
        const targetBranchId = branchId || doc.activeBranchId;

        await db.transaction(async (tx) => {
            const existingNodes = await tx
                .select()
                .from(scribeNodes)
                .where(
                    and(
                        eq(scribeNodes.documentId, documentId),
                        eq(scribeNodes.branchId, targetBranchId!)
                    )
                )
                .orderBy(asc(scribeNodes.sortOrder));

            const tocNodes = existingNodes.filter((n) => n.stationKey === TABLE_OF_CONTENTS_KEY);
            const outlineNodes = existingNodes.filter((n) => n.stationKey !== TABLE_OF_CONTENTS_KEY);

            const byKey = new Map(outlineNodes.map((n) => [n.stationKey, n]));
            const byTitle = new Map(outlineNodes.map((n) => [normalizeStationTitle(n.title), n]));
            const claimed = new Set<number>();

            const step = stations.length > 0 ? Number((1 / stations.length).toFixed(2)) : 0.2;
            let order = 0;

            for (let i = 0; i < stations.length; i++) {
                const s = stations[i];
                order = s.sortOrder ?? i + 1;

                // Identity first, then the title the author sees. An outline
                // pasted from chat rarely carries keys, so the title is what
                // makes "the same section, renamed" distinguishable from "a new one".
                let match = s.stationKey ? byKey.get(s.stationKey) : undefined;
                if (!match) match = byTitle.get(normalizeStationTitle(s.title));
                if (match && claimed.has(match.id)) match = undefined;

                if (match) {
                    claimed.add(match.id);
                    const patch: Record<string, unknown> = {
                        title: s.title,
                        sortOrder: order,
                        updatedAt: new Date(),
                    };
                    if (s.targetPercentage !== undefined) patch.targetPercentage = s.targetPercentage;
                    if (s.content !== undefined) {
                        patch.content = s.content;
                        patch.wordCount = s.content.trim().split(/\s+/).filter(Boolean).length;
                    }
                    await tx.update(scribeNodes).set(patch).where(eq(scribeNodes.id, match.id));
                    continue;
                }

                const key = s.stationKey || stationKeyFor(s.title, i + 1, byKey);
                // A generated heading is not authored text, so it carries no word
                // count — telemetry and the authored-prose test both read that.
                const supplied = s.content !== undefined;
                const content = supplied ? s.content! : `# ${s.title}\n\n`;
                const [inserted] = await tx
                    .insert(scribeNodes)
                    .values({
                        documentId,
                        branchId: targetBranchId!,
                        stationKey: key,
                        title: s.title,
                        content,
                        sortOrder: order,
                        targetPercentage: s.targetPercentage ?? step,
                        wordCount: supplied ? content.trim().split(/\s+/).filter(Boolean).length : 0,
                        status: "draft",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning();
                if (inserted) {
                    byKey.set(inserted.stationKey, inserted);
                    claimed.add(inserted.id);
                }
            }

            // Whatever the new outline did not name.
            for (const node of outlineNodes) {
                if (claimed.has(node.id)) continue;
                if (hasAuthoredProse(node)) {
                    // Kept, after the outline, rather than destroyed.
                    order += 1;
                    await tx
                        .update(scribeNodes)
                        .set({ sortOrder: order, updatedAt: new Date() })
                        .where(eq(scribeNodes.id, node.id));
                } else {
                    await tx.delete(scribeNodes).where(eq(scribeNodes.id, node.id));
                }
            }

            // The TOC keeps its place at the front; refreshed below.
            for (const toc of tocNodes) {
                await tx
                    .update(scribeNodes)
                    .set({ sortOrder: 0, updatedAt: new Date() })
                    .where(eq(scribeNodes.id, toc.id));
            }

            await tx
                .update(scribeDocuments)
                .set({ currentRevision: doc.currentRevision + 1, updatedAt: new Date() })
                .where(eq(scribeDocuments.id, documentId));
        });

        await this.refreshTableOfContentsIfPresent(documentId, targetBranchId!);

        void scribeVersioningService
            .recordDocumentRevision(doc, organizationId, {
                kind: "outline",
                message: `Outline reconfigured (${stations.length} stations)`,
                branchId: targetBranchId ?? undefined,
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed on outline change: ${err?.message ?? err}`));

        return this.getDocument(documentId, organizationId, targetBranchId ?? undefined);
    }

    /**
     * File one manuscript under another, or move it back to the root.
     *
     * Rejects a parent that is the document itself or one of its descendants.
     * A cycle here is not a cosmetic problem: listDocumentTree and every
     * breadcrumb walk would recurse until the stack ran out, and the row that
     * caused it would be invisible in the tree that failed to render.
     */
    async setDocumentParent(
        documentId: number,
        organizationId: number,
        parentDocumentId: number | null,
    ): Promise<ScribeDocument> {
        await this.requireDocument(documentId, organizationId);

        if (parentDocumentId != null) {
            if (parentDocumentId === documentId) {
                throw new Error("A document cannot be filed under itself.");
            }
            await this.requireDocument(parentDocumentId, organizationId);

            // Walk up from the proposed parent: meeting this document means the
            // new edge would close a loop.
            const seen = new Set<number>();
            let cursor: number | null = parentDocumentId;
            while (cursor != null) {
                if (cursor === documentId) {
                    throw new Error("A document cannot be filed under one of its own children.");
                }
                if (seen.has(cursor)) break; // Pre-existing cycle; do not spin on it.
                seen.add(cursor);
                const [row] = await db
                    .select({ parentDocumentId: scribeDocuments.parentDocumentId })
                    .from(scribeDocuments)
                    .where(
                        and(
                            eq(scribeDocuments.id, cursor),
                            eq(scribeDocuments.organizationId, organizationId),
                        ),
                    )
                    .limit(1);
                cursor = row?.parentDocumentId ?? null;
            }
        }

        const [updated] = await db
            .update(scribeDocuments)
            .set({ parentDocumentId, updatedAt: new Date() })
            .where(
                and(
                    eq(scribeDocuments.id, documentId),
                    eq(scribeDocuments.organizationId, organizationId),
                ),
            )
            .returning();
        if (!updated) throw new Error(`Document #${documentId} not found`);
        return updated;
    }

    /**
     * Replace a document's labels.
     *
     * Trimmed, de-duplicated case-insensitively and stored lowercase, because a
     * label is only useful if "PRD" and "prd" group together — otherwise the
     * filter quietly splits one tag into several.
     */
    async setDocumentLabels(
        documentId: number,
        organizationId: number,
        labels: string[],
    ): Promise<ScribeDocument> {
        await this.requireDocument(documentId, organizationId);

        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const raw of labels ?? []) {
            const label = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
            if (!label || seen.has(label)) continue;
            seen.add(label);
            cleaned.push(label);
        }

        const [updated] = await db
            .update(scribeDocuments)
            .set({ labels: cleaned, updatedAt: new Date() })
            .where(
                and(
                    eq(scribeDocuments.id, documentId),
                    eq(scribeDocuments.organizationId, organizationId),
                ),
            )
            .returning();
        if (!updated) throw new Error(`Document #${documentId} not found`);
        return updated;
    }

    /**
     * Delete a manuscript and everything it owns.
     *
     * Stations, branches, annotations, ledger entries, authoring operations and
     * persisted vault records all carry ON DELETE CASCADE on document_id, so the
     * row delete is the delete. Two edges deliberately survive it: manuscripts
     * filed beneath this one surface at the root (parent_document_id is SET
     * NULL — deleting a parent must not destroy what was filed under it), and a
     * media production storyboarded from it keeps the production with a null
     * manuscript link.
     *
     * The vault's encrypted rows cascade too, but the ephemeral cache is memory
     * a cascade cannot reach, so it is flushed first — otherwise a deleted
     * manuscript's sensitive payloads would outlive it in RAM.
     */
    async deleteDocument(
        documentId: number,
        organizationId: number,
    ): Promise<{ success: boolean; deletedId: number }> {
        const doc = await this.requireDocument(documentId, organizationId);
        await ephemeralVaultCache.flushForDocument(organizationId, documentId);
        await db
            .delete(scribeDocuments)
            .where(
                and(
                    eq(scribeDocuments.id, documentId),
                    eq(scribeDocuments.organizationId, organizationId),
                ),
            );
        return { success: true, deletedId: doc.id };
    }

    /**
     * Every manuscript in the organization as a tree, roots first.
     *
     * Assembled in memory from one query rather than a recursive CTE: an org has
     * tens of documents, not millions, and one round trip beats a query whose
     * behaviour on an accidental cycle is to run forever.
     *
     * A document whose parent is missing or outside the org is returned as a
     * root, so nothing can be filed somewhere the reader cannot see.
     */
    async listDocumentTree(
        organizationId: number,
        options: { label?: string } = {},
    ): Promise<Array<ScribeDocumentTreeNode>> {
        const rows = await db
            .select({
                id: scribeDocuments.id,
                title: scribeDocuments.title,
                parentDocumentId: scribeDocuments.parentDocumentId,
                labels: scribeDocuments.labels,
                archetypeMode: scribeDocuments.archetypeMode,
                sessionId: scribeDocuments.sessionId,
                updatedAt: scribeDocuments.updatedAt,
            })
            .from(scribeDocuments)
            .where(eq(scribeDocuments.organizationId, organizationId))
            .orderBy(asc(scribeDocuments.title));

        const wanted = options.label?.trim().toLowerCase();
        const visible = wanted
            ? rows.filter((r) => (r.labels ?? []).includes(wanted))
            : rows;

        const byId = new Map<number, ScribeDocumentTreeNode>();
        for (const row of visible) {
            byId.set(row.id, { ...row, labels: row.labels ?? [], children: [] });
        }

        const roots: ScribeDocumentTreeNode[] = [];
        for (const node of byId.values()) {
            const parent = node.parentDocumentId != null ? byId.get(node.parentDocumentId) : undefined;
            if (parent && parent.id !== node.id) parent.children.push(node);
            else roots.push(node);
        }
        return roots;
    }

    /** Every distinct label in the organization, with how many documents carry it. */
    async listLabels(organizationId: number): Promise<Array<{ label: string; count: number }>> {
        const rows = await db
            .select({ labels: scribeDocuments.labels })
            .from(scribeDocuments)
            .where(eq(scribeDocuments.organizationId, organizationId));

        const counts = new Map<string, number>();
        for (const row of rows) {
            for (const label of row.labels ?? []) {
                counts.set(label, (counts.get(label) ?? 0) + 1);
            }
        }
        return [...counts.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }

    /**
     * Fork a new branch and optionally spawn a linked Breakout Room
     */
    async forkBranch(
        documentId: number,
        organizationId: number,
        stationKey: string,
        branchName: string,
        description?: string,
        spawnBreakoutRoom = false,
        parentSessionId?: number
    ): Promise<{ branch: ScribeBranch; breakoutSessionKey?: string }> {
        const doc = await this.requireDocument(documentId, organizationId);

        const sourceBranchId = doc.activeBranchId;
        const sourceNodes = await db
            .select()
            .from(scribeNodes)
            .where(and(eq(scribeNodes.documentId, documentId), eq(scribeNodes.branchId, sourceBranchId!)))
            .orderBy(asc(scribeNodes.sortOrder));

        const branchKey = `branch-${Date.now().toString(36)}`;
        let breakoutSessionId: number | undefined;
        let breakoutSessionKey: string | undefined;

        // If breakout room requested, create child session in crew_sessions
        if (spawnBreakoutRoom && parentSessionId) {
            const [parent] = await db.select().from(crewSessions).where(eq(crewSessions.id, parentSessionId)).limit(1);
            if (parent) {
                breakoutSessionKey = `breakout-${branchKey}`;
                const [childSession] = await db
                    .insert(crewSessions)
                    .values({
                        organizationId: parent.organizationId,
                        sessionKey: breakoutSessionKey,
                        title: `Breakout: ${branchName}`,
                        status: "active",
                        mode: "explore",
                        createdBy: "Scribe Studio",
                        cycleContext: {
                            isStandingRoom: false,
                            cycleName: `Scribe Branch: ${branchName}`,
                        },
                    })
                    .returning();
                breakoutSessionId = childSession.id;
            }
        }

        // 1. Insert Branch Record
        const [branch] = await db
            .insert(scribeBranches)
            .values({
                documentId,
                branchKey,
                parentBranchId: sourceBranchId,
                breakoutSessionId: breakoutSessionId || null,
                name: branchName,
                description: description || `Forked at station ${stationKey}`,
                status: "active",
                divergedAtStationKey: stationKey,
                createdAt: new Date(),
            })
            .returning();

        // 2. Clone stations into new branch
        const clonedNodes = sourceNodes.map((n) => ({
            documentId,
            branchId: branch.id,
            stationKey: n.stationKey,
            title: n.title,
            sortOrder: n.sortOrder,
            targetPercentage: n.targetPercentage,
            content: n.content,
            contentRich: n.contentRich,
            wordCount: n.wordCount,
            status: n.status,
            continuityNotes: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        await db.insert(scribeNodes).values(clonedNodes);

        logger.info(`[Scribe] Forked branch '${branchName}' (#${branch.id}) with ${clonedNodes.length} cloned stations`);

        void scribeVersioningService
            .recordDocumentRevision(doc, organizationId, {
                kind: "fork",
                message: `Forked "${branchName}" at station ${stationKey}`,
                branchId: branch.id,
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed on fork: ${err?.message ?? err}`));

        return {
            branch,
            breakoutSessionKey,
        };
    }

    /**
     * Merge branch back into target branch (Trunk) with selective station cherry-picking
     */
    async mergeBranch(
        documentId: number,
        organizationId: number,
        sourceBranchId: number,
        targetBranchId: number,
        selectedNodeIds?: number[]
    ): Promise<FullDocumentView> {
        await this.requireDocument(documentId, organizationId);
        logger.info(`[Scribe] Merging branch #${sourceBranchId} into #${targetBranchId}`);

        const sourceNodes = await db
            .select()
            .from(scribeNodes)
            .where(
                and(
                    eq(scribeNodes.documentId, documentId),
                    eq(scribeNodes.branchId, sourceBranchId)
                )
            );

        const nodesToMerge = selectedNodeIds && selectedNodeIds.length > 0
            ? sourceNodes.filter((n) => selectedNodeIds.includes(n.id))
            : sourceNodes;

        for (const sNode of nodesToMerge) {
            await db
                .update(scribeNodes)
                .set({
                    content: sNode.content,
                    contentRich: sNode.contentRich,
                    wordCount: sNode.wordCount,
                    status: "approved",
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(scribeNodes.documentId, documentId),
                        eq(scribeNodes.branchId, targetBranchId),
                        eq(scribeNodes.stationKey, sNode.stationKey)
                    )
                );
        }

        // Mark source branch as merged
        await db
            .update(scribeBranches)
            .set({ status: "merged" })
            .where(eq(scribeBranches.id, sourceBranchId));

        // Switch active branch to target
        await db
            .update(scribeDocuments)
            .set({ activeBranchId: targetBranchId, updatedAt: new Date() })
            .where(eq(scribeDocuments.id, documentId));

        // Run full continuity audit on merged trunk
        if (nodesToMerge.length > 0) {
            const firstNode = nodesToMerge[0];
            continuityEngine.analyzeDownstreamContinuity(
                documentId,
                targetBranchId,
                firstNode.sortOrder,
                firstNode.content,
                firstNode.stationKey
            ).catch((err) => logger.warn(`[Scribe] Post-merge continuity error: ${err.message}`));
        }

        const [mergeDoc] = await db
            .select()
            .from(scribeDocuments)
            .where(eq(scribeDocuments.id, documentId))
            .limit(1);
        void scribeVersioningService
            .recordDocumentRevision(mergeDoc, organizationId, {
                kind: "merge",
                message: `Merged branch #${sourceBranchId} into #${targetBranchId} (${nodesToMerge.length} stations)`,
                branchId: targetBranchId,
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed on merge: ${err?.message ?? err}`));

        return this.getDocument(documentId, organizationId, targetBranchId);
    }

    /**
     * Point the document at a different branch and return the refreshed view.
     */
    async switchBranch(
        documentId: number,
        organizationId: number,
        branchId: number
    ): Promise<FullDocumentView> {
        await this.requireDocument(documentId, organizationId);

        const [branch] = await db
            .select()
            .from(scribeBranches)
            .where(and(eq(scribeBranches.id, branchId), eq(scribeBranches.documentId, documentId)))
            .limit(1);

        if (!branch) {
            throw Object.assign(new Error(`Branch #${branchId} not found on document ${documentId}`), { status: 404 });
        }

        await db
            .update(scribeDocuments)
            .set({ activeBranchId: branchId, updatedAt: new Date() })
            .where(eq(scribeDocuments.id, documentId));

        return this.getDocument(documentId, organizationId, branchId);
    }

    /**
     * Run Multi-Lens Critic evaluation across stations
     */
    async runCriticEvaluation(
        documentId: number,
        organizationId: number,
        nodeId?: number,
        lenses: ScribeLensType[] = ["legal", "stylistic", "devils_advocate"],
        /**
         * Definitions for lenses the built-in criteria list does not cover. A
         * custom lens used to reach the model as a bare name, so the reviewer
         * was told which hat to wear and never what the hat means.
         */
        lensDefinitions?: Array<{ id: string; label: string; description: string }>
    ): Promise<ScribeAnnotation[]> {
        await this.requireDocument(documentId, organizationId);
        // A node id is scoped to the document as well as the org: otherwise a
        // caller could annotate one of their own documents using another
        // document's node id and cross the boundary through the FK.
        const nodes = nodeId
            ? await db
                  .select()
                  .from(scribeNodes)
                  .where(and(eq(scribeNodes.id, nodeId), eq(scribeNodes.documentId, documentId)))
            : await db.select().from(scribeNodes).where(eq(scribeNodes.documentId, documentId));

        // Screening is against the whole document, not the station under
        // review: a cap agreed in the payment terms is not invented because the
        // indemnity clause is the one being critiqued.
        const documentText = (
            await db
                .select({ content: scribeNodes.content })
                .from(scribeNodes)
                .where(eq(scribeNodes.documentId, documentId))
        )
            .map((n) => n.content ?? "")
            .join("\n\n");

        const annotations: ScribeAnnotation[] = [];

        for (const node of nodes) {
            if (!node.content || node.content.trim().length < 30) continue;

            for (const lens of lenses) {
                const prompt = `You are a specialist reviewer acting in the "${lens.toUpperCase()}" lens.
Evaluate the following section from "${node.title}" (${node.stationKey}):

CONTENT:
"""
${node.content}
"""

LENS CRITERIA:
- "legal": Find uncapped liability, missing remedies, vague definitions, non-compliance risks.
- "stylistic": Find passive voice, bloated sentences, tone inconsistency, filler words.
- "pacing": Check tension curve, emotional resonance, dialogue velocity.
- "devils_advocate": Find plot holes, logical fallacies, contractual loopholes to exploit.
- "fact_check": Check numerical consistency and questionable claims.
${(lensDefinitions ?? [])
    .map((d) => `- "${d.id}" (${d.label}): ${d.description}`)
    .join("\n")}

You are reviewing a document you did not write, for parties you cannot see.
Never invent a term the document does not already contain. In particular:
- Do not choose a liability cap, fee, notice period, service level or deadline.
  If the clause needs one, write a bracketed blank such as "[AMOUNT]" and say in
  the critique that it is the author's decision.
- Do not assert that any law, standard or certification applies — GDPR, HIPAA,
  SOC 2, ISO 27001 and the rest — unless the document already invokes it.
  Whether it applies turns on facts you have not been given.
- Say what is missing or risky. Do not settle it on the author's behalf.

Provide 1-2 sharp, actionable critiques formatted as JSON:
[
  {
    "title": "Short title",
    "severity": "info" | "suggestion" | "warning" | "critical_conflict",
    "critiqueBody": "Clear rationale",
    "excerpt": "the exact phrase from the CONTENT above that this is about, copied character for character, or null if the critique is about the section as a whole",
    "proposedDiff": "Replacement text proposal if applicable"
  }
]

Copy the excerpt exactly as it appears. Do not paraphrase it, correct it, or
shorten it — it is used to locate the critique in the text.

Return ONLY valid JSON.`;

                try {
                    const aiText = await systemAiService.generateText(prompt, { serviceKey: "copilot", temperature: 0.2 });
                    const match = aiText ? aiText.match(/\[[\s\S]*\]/) : null;
                    const items = match ? JSON.parse(match[0]) : [];

                    for (const item of items) {
                        if (item.title && item.critiqueBody) {
                            // The prompt above asks the model not to invent
                            // terms. This does not depend on it having listened:
                            // proposedDiff is one click from the clause.
                            const screened = screenProposal(item.proposedDiff, documentText);
                            const [annot] = await db
                                .insert(scribeAnnotations)
                                .values({
                                    documentId,
                                    nodeId: node.id,
                                    lensType: lens,
                                    severity: item.severity || "suggestion",
                                    title: item.title,
                                    critiqueBody: screened.redactions.length
                                        ? `${item.critiqueBody}\n\n${screened.redactions.join(" ")}`
                                        : item.critiqueBody,
                                    proposedDiff: screened.proposedDiff,
                                    // Anchor the critique to the phrase it is
                                    // about — but only if that phrase actually
                                    // occurs in the station. A model quoting
                                    // something it did not read would place the
                                    // marker on the wrong sentence, which is
                                    // worse than leaving it unplaced.
                                    //
                                    // paragraphAnchor has been on this table
                                    // since Scribe shipped and no critique has
                                    // ever set one, so every AI finding floated
                                    // free of the text: on a long station,
                                    // "use active voice" with no location is
                                    // not actionable.
                                    paragraphAnchor: this.anchorFor(item.excerpt, node.content),
                                    status: "open",
                                    createdAt: new Date(),
                                })
                                .returning();
                            if (annot) annotations.push(annot);
                        }
                    }
                } catch (err: any) {
                    logger.warn(`[Scribe] Critic evaluation failed for lens ${lens}: ${err.message}`);
                }
            }
        }

        return annotations;
    }

    /**
     * Where in the station a critique belongs, or nothing.
     *
     * Verified against the text rather than trusted. A model asked to quote a
     * phrase will sometimes tidy it, paraphrase it, or invent it; anchoring to
     * a phrase that is not there puts the marker beside the wrong sentence, and
     * a marker in the wrong place is worse than one with no place at all.
     */
    private anchorFor(excerpt: unknown, content: string): string | null {
        if (typeof excerpt !== "string") return null;
        const phrase = excerpt.trim();
        // Too short to locate anything uniquely; "the" would match everywhere.
        if (phrase.length < 8) return null;
        return content.includes(phrase) ? phrase : null;
    }

    /**
     * Compile manuscript to formatted Markdown, PDF or DOCX
     */
    async compileManuscript(
        documentId: number,
        organizationId: number,
        branchId?: number
    ): Promise<{ title: string; content: string; wordCount: number }> {
        const docView = await this.getDocument(documentId, organizationId, branchId);
        let markdown = `# ${docView.document.title}\n\n*Generated by Oddjob Scribe Studio (${docView.document.archetypeMode})*\n\n---\n\n`;

        for (const node of docView.nodes) {
            markdown += `## ${node.title}\n\n`;
            if (node.content && node.content.trim()) {
                markdown += `${node.content.trim()}\n\n`;
            } else {
                markdown += `*[Section Draft in Progress]*\n\n`;
            }
        }

        return {
            title: docView.document.title,
            content: markdown,
            wordCount: docView.telemetry.totalWordCount,
        };
    }

    /**
     * Create a user/agent annotation, note, or to-do item
     */
    async createAnnotation(data: {
        documentId: number;
        organizationId: number;
        nodeId: number;
        lensType?: ScribeLensType;
        title: string;
        critiqueBody: string;
        proposedDiff?: string;
        severity?: ScribeAnnotationSeverity;
        paragraphAnchor?: string;
    }): Promise<ScribeAnnotation> {
        await this.requireDocument(data.documentId, data.organizationId);
        const node = await this.requireNode(data.nodeId, data.organizationId);
        if (node.documentId !== data.documentId) {
            throw Object.assign(new Error(`Node #${data.nodeId} not found`), { status: 404 });
        }
        const [annot] = await db
            .insert(scribeAnnotations)
            .values({
                documentId: data.documentId,
                nodeId: data.nodeId,
                lensType: data.lensType || "note",
                severity: data.severity || "info",
                title: data.title,
                critiqueBody: data.critiqueBody,
                proposedDiff: data.proposedDiff || null,
                paragraphAnchor: data.paragraphAnchor || null,
                status: "open",
                createdAt: new Date(),
            })
            .returning();
        return annot;
    }

    /**
     * Update annotation status (e.g. resolve to-do item)
     */
    async updateAnnotationStatus(
        annotationId: number,
        organizationId: number,
        status: ScribeAnnotationStatus
    ): Promise<ScribeAnnotation> {
        await this.requireAnnotation(annotationId, organizationId);
        const [updated] = await db
            .update(scribeAnnotations)
            .set({ status })
            .where(eq(scribeAnnotations.id, annotationId))
            .returning();
        if (!updated) throw new Error(`Annotation ${annotationId} not found`);
        return updated;
    }

    /**
     * Delete an annotation or to-do
     */
    async deleteAnnotation(annotationId: number, organizationId: number): Promise<boolean> {
        await this.requireAnnotation(annotationId, organizationId);
        await db
            .delete(scribeAnnotations)
            .where(eq(scribeAnnotations.id, annotationId));
        return true;
    }

    /**
     * Record the terms this station defines, so the rest of the document knows
     * them.
     *
     * scribe_entity_ledger has had this schema and a read path since Scribe
     * shipped, and no writer at all. Without it both term checks can only see
     * the station being edited, which means a term defined in section 2 reads
     * as undefined while the author works in section 9 — the precise false
     * positive that would make them switch the gutter off.
     *
     * Insert-only against the document+term unique index. A term keeps the node
     * that first defined it; re-defining the same term elsewhere is a different
     * finding, not a reason to move the anchor.
     */
    private async syncDefinedTerms(node: ScribeNode): Promise<void> {
        const terms = extractDefinedTerms(node.content ?? "");
        if (terms.length === 0) return;

        await db
            .insert(scribeEntityLedger)
            .values(
                terms.map((t) => ({
                    documentId: node.documentId,
                    entityType: "defined_term",
                    termName: t.term,
                    firstDefinedNodeId: node.id,
                })),
            )
            .onConflictDoNothing();
    }

    /**
     * Accept a spelling the author says is fine.
     *
     * Drift detection is only useful if the author can disagree with it. A
     * contract that deliberately uses "Confidential Info" as a short form
     * should be able to say so once, rather than dismissing the same marker on
     * every save — a warning that cannot be settled is a warning that gets
     * ignored, along with the ones that matter.
     *
     * Stored on the canonical term's ledger row, so the exemption is scoped to
     * that term in that document rather than becoming a global mute.
     */
    async addTermAlias(
        documentId: number,
        organizationId: number,
        canonical: string,
        alias: string,
    ): Promise<{ canonical: string; aliases: string[] }> {
        await this.requireDocument(documentId, organizationId);

        const term = (canonical || "").trim();
        const value = (alias || "").trim();
        if (!term || !value) {
            throw Object.assign(new Error("canonical and alias are both required"), { status: 400 });
        }

        const [row] = await db
            .select()
            .from(scribeEntityLedger)
            .where(
                and(
                    eq(scribeEntityLedger.documentId, documentId),
                    eq(scribeEntityLedger.termName, term),
                )
            )
            .limit(1);

        if (!row) {
            throw Object.assign(new Error(`"${term}" is not a defined term in this document`), { status: 404 });
        }

        const existing = Array.isArray(row.aliases) ? row.aliases : [];
        // Idempotent on the exact spelling. Not case-insensitively: the drift
        // check matches an alias exactly, because "Confidential information"
        // and "confidential information" are two different forms in a contract
        // and approving one is not approving the other.
        if (existing.includes(value)) {
            return { canonical: term, aliases: existing };
        }

        const aliases = [...existing, value];
        await db
            .update(scribeEntityLedger)
            .set({ aliases })
            .where(eq(scribeEntityLedger.id, row.id));

        logger.info(`[Scribe] Accepted "${value}" as an alias of "${term}" in document #${documentId}`);
        return { canonical: term, aliases };
    }

    /** Terms, blessed aliases, and active data tethers the document knows. */
    private async loadLedgerTerms(documentId: number): Promise<{
        terms: string[];
        aliases: string[];
        tethers: DataTether[];
    }> {
        const rows = await db
            .select()
            .from(scribeEntityLedger)
            .where(eq(scribeEntityLedger.documentId, documentId));

        const tethers: DataTether[] = [];
        const terms: string[] = [];
        const aliases: string[] = [];

        for (const r of rows) {
            if (r.entityType === "data_tether" && r.dataBinding) {
                tethers.push({
                    termName: r.termName,
                    calculationNodeId: r.dataBinding.calculationNodeId,
                    datasetId: r.dataBinding.datasetId,
                    field: r.dataBinding.field,
                    lastValue: r.dataBinding.lastValue,
                    unit: (r.dataBinding as any).unit ?? null,
                });
            }
            terms.push(r.termName);
            if (Array.isArray(r.aliases)) {
                aliases.push(...r.aliases);
            }
        }

        return { terms, aliases, tethers };
    }

    /**
     * Tether a document figure/term to a Calculation Node from the knowledge engine.
     */
    async tetherEntityToCalculation(
        documentId: number,
        organizationId: number,
        termName: string,
        calculationNodeId: number,
        unit?: string
    ): Promise<ScribeEntityLedgerEntry> {
        await this.requireDocument(documentId, organizationId);
        const name = (termName || "").trim();
        if (!name) {
            throw Object.assign(new Error("termName is required"), { status: 400 });
        }

        const { calculationService } = await import("@domain/knowledge/core/calculations/calculation.service.js");
        // A real OrgContext, not a partial: `orgRole` is not a field of it, and
        // the three missing flags are what the calculation service reads to
        // decide whether to apply org scoping. Least privilege is deliberate —
        // getSystemOrgContext() would grant superadmin and skip that scoping.
        const orgContext: OrgContext = {
            userId: "system",
            organizationId,
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };

        const calcNode = await calculationService.getCalculationById(calculationNodeId, orgContext);
        if (!calcNode) {
            throw Object.assign(new Error(`Calculation node #${calculationNodeId} not found`), { status: 404 });
        }

        let calculatedValue: number | string = 0;
        try {
            const execResult = await calculationService.executeCalculation(calculationNodeId, orgContext);
            calculatedValue = execResult.value;
        } catch (err: any) {
            logger.warn(`[Scribe] Calculation execution fallback on tether: ${err.message}`);
            calculatedValue = calcNode.cachedResult ? Number(calcNode.cachedResult) : 0;
        }

        const dataBinding = {
            calculationNodeId,
            lastValue: calculatedValue,
            lastCheckedAt: new Date().toISOString(),
            unit: unit ?? null,
        };

        const [existing] = await db
            .select()
            .from(scribeEntityLedger)
            .where(
                and(
                    eq(scribeEntityLedger.documentId, documentId),
                    eq(scribeEntityLedger.termName, name)
                )
            )
            .limit(1);

        if (existing) {
            const [updated] = await db
                .update(scribeEntityLedger)
                .set({
                    entityType: "data_tether",
                    dataBinding,
                })
                .where(eq(scribeEntityLedger.id, existing.id))
                .returning();
            logger.info(`[Scribe] Updated tether "${name}" to calculation node #${calculationNodeId} (${calculatedValue})`);
            return updated;
        }

        const [created] = await db
            .insert(scribeEntityLedger)
            .values({
                documentId,
                entityType: "data_tether",
                termName: name,
                definitionText: `Tethered to Calculation Node #${calculationNodeId}: ${calcNode.nodeId}`,
                dataBinding,
            })
            .returning();

        logger.info(`[Scribe] Created tether "${name}" to calculation node #${calculationNodeId} (${calculatedValue})`);
        return created;
    }

    /**
     * Re-evaluates all calculation tethers for a document against the calculation engine.
     */
    async refreshDocumentTethers(
        documentId: number,
        organizationId: number
    ): Promise<Array<{ termName: string; oldValue: any; newValue: any }>> {
        await this.requireDocument(documentId, organizationId);
        const { calculationService } = await import("@domain/knowledge/core/calculations/calculation.service.js");
        // A real OrgContext, not a partial: `orgRole` is not a field of it, and
        // the three missing flags are what the calculation service reads to
        // decide whether to apply org scoping. Least privilege is deliberate —
        // getSystemOrgContext() would grant superadmin and skip that scoping.
        const orgContext: OrgContext = {
            userId: "system",
            organizationId,
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };

        const rows = await db
            .select()
            .from(scribeEntityLedger)
            .where(
                and(
                    eq(scribeEntityLedger.documentId, documentId),
                    eq(scribeEntityLedger.entityType, "data_tether")
                )
            );

        const updates: Array<{ termName: string; oldValue: any; newValue: any }> = [];

        for (const r of rows) {
            const calcId = r.dataBinding?.calculationNodeId;
            if (!calcId) continue;

            try {
                const execResult = await calculationService.executeCalculation(calcId, orgContext, { forceRecalculate: true });
                const oldValue = r.dataBinding?.lastValue;
                const newValue = execResult.value;

                await db
                    .update(scribeEntityLedger)
                    .set({
                        dataBinding: {
                            ...r.dataBinding,
                            lastValue: newValue,
                            lastCheckedAt: new Date().toISOString(),
                        },
                    })
                    .where(eq(scribeEntityLedger.id, r.id));

                updates.push({ termName: r.termName, oldValue, newValue });
            } catch (err: any) {
                logger.warn(`[Scribe] Failed to refresh tether for ${r.termName}: ${err.message}`);
            }
        }

        return updates;
    }

    /**
     * Tier 2 ambient review: one model call reading the saved station through
     * the lenses its archetype cares about.
     *
     * Guarded before it spends. shouldReviewOnSave refuses a station that is
     * too short to judge, a save inside the cooldown, or text that has not
     * meaningfully moved since the last review — so a burst of saves on one
     * paragraph costs one call, not one per save.
     *
     * Publishes into the room on the same `scribe-insight` channel as Tier 1,
     * so the client renders both through one path.
     */
    private async reviewStationAmbient(
        node: ScribeNode,
        organizationId: number,
    ): Promise<void> {
        const now = Date.now();
        const decision = shouldReviewOnSave({
            text: node.content ?? "",
            state: getReviewState(node.id),
            now,
        });

        if (!decision.review) {
            logSkip(node.id, decision.reason);
            return;
        }

        const [doc] = await db
            .select()
            .from(scribeDocuments)
            .where(
                and(
                    eq(scribeDocuments.id, node.documentId),
                    eq(scribeDocuments.organizationId, organizationId),
                )
            )
            .limit(1);
        if (!doc) return;

        const lenses = lensesForArchetype(doc.archetypeMode);
        const prompt = buildAmbientPrompt(node.content, node.title, lenses);

        // Recorded BEFORE the call, not after. A model call that hangs or
        // throws would otherwise leave the cooldown unset and let the next save
        // start another one.
        recordReview(node.id, node.content, now);

        const reply = await systemAiService.generateText(prompt, {
            serviceKey: "copilot",
            temperature: 0.2,
        });

        const insights = parseAmbientFindings(reply, node.content, lenses);
        if (insights.length === 0) return;

        const [session] = await db
            .select({ sessionKey: crewSessions.sessionKey })
            .from(crewSessions)
            .where(eq(crewSessions.id, doc.sessionId))
            .limit(1);
        if (!session?.sessionKey) return;

        void crewStreamService.publish({
            type: "scribe-insight",
            organizationId,
            sessionKey: session.sessionKey,
            payload: {
                documentId: doc.id,
                nodeId: node.id,
                tier: 2,
                severity: highestSeverity(insights),
                insights,
            },
        });

        logger.info(`[Scribe] Tier 2 reviewed station ${node.id}: ${insights.length} finding(s)`);
    }

    /**
     * Tier 1 ambient review of a station as it is being typed.
     *
     * Rules only, no model: the tiering exists so this can run on every delta
     * without the spend that a model-backed critic would incur at that rate.
     *
     * Publishes into the room only when the findings actually change. An author
     * typing inside a clean paragraph produces delta after delta with an empty
     * finding set, and broadcasting each one wakes every subscriber to say
     * nothing happened.
     */
    async evaluateAmbientDelta(input: {
        documentId: number;
        organizationId: number;
        nodeId?: number;
        text: string;
        previousInsights?: AmbientInsight[];
    }): Promise<{
        insights: AmbientInsight[];
        severity: ReturnType<typeof highestSeverity>;
        published: boolean;
    }> {
        // Org boundary first: documentId arrives off a request body.
        const doc = await this.requireDocument(input.documentId, input.organizationId);

        const ledger = await this.loadLedgerTerms(doc.id);
        const insights = evaluateAmbient(input.text, doc.archetypeMode, ledger);
        const severity = highestSeverity(insights);
        const changed = insightsChanged(input.previousInsights ?? [], insights);

        if (!changed) {
            return { insights, severity, published: false };
        }

        const [session] = await db
            .select({ sessionKey: crewSessions.sessionKey })
            .from(crewSessions)
            .where(eq(crewSessions.id, doc.sessionId))
            .limit(1);

        if (session?.sessionKey) {
            void crewStreamService.publish({
                type: "scribe-insight",
                organizationId: input.organizationId,
                sessionKey: session.sessionKey,
                payload: {
                    documentId: doc.id,
                    nodeId: input.nodeId ?? null,
                    severity,
                    insights,
                },
            });
        }

        return { insights, severity, published: Boolean(session?.sessionKey) };
    }

    /**
     * Publish manuscript as a canonical project deliverable & asset.
     * Compiles the text, registers in fileBlobs and crewAttachments,
     * updates document revision/published snapshot, and posts a supervisor announcement turn.
     */
    async publishDocument(
        documentId: number,
        organizationId: number,
        options: {
            branchId?: number;
            versionTag?: string;
            releaseNotes?: string;
            userId?: string;
            theme?: string;
        } = {}
    ): Promise<{
        document: ScribeDocument;
        compiled: { title: string; content: string; wordCount: number };
        attachment: any;
        versionTag: string;
        downloadUrl: string;
    }> {
        const doc = await this.requireDocument(documentId, organizationId);

        // 1. Resolve parent session and project
        const [session] = await db
            .select()
            .from(crewSessions)
            .where(eq(crewSessions.id, doc.sessionId))
            .limit(1);

        if (!session) {
            throw Object.assign(new Error(`Session #${doc.sessionId} not found`), { status: 404 });
        }

        // An unscoped room publishes into the org's default project — the one
        // marked isDefault, which is where every unassigned resource lands.
        //
        // This previously took whichever project row came back first from an
        // unordered `limit(1)`, then bound the room to it permanently. That
        // adopted an arbitrary, possibly unrelated project on a non-deterministic
        // basis, and made "export my document" silently rescope the room.
        // projectService.ensureDefaultProject already resolves-or-creates the
        // right one, and handles the concurrent-create race through the partial
        // unique index rather than by racing two inserts.
        let projectId = session.projectId;
        if (!projectId) {
            const { projectService } = await import("@domain/projects/core/project.service.js");
            const defaultProject = await projectService.ensureDefaultProject({
                organizationId,
                userId: options.userId,
            });
            projectId = defaultProject.id;

            await db
                .update(crewSessions)
                .set({ projectId })
                .where(eq(crewSessions.id, session.id));
            logger.info(
                `[Scribe] Room #${session.id} had no project; bound to default project #${projectId} on publish.`,
            );
        }

        // 2. Compile manuscript
        const compiled = await this.compileManuscript(documentId, organizationId, options.branchId);
        const buffer = Buffer.from(compiled.content, "utf-8");
        const versionTag = options.versionTag || `v${doc.currentRevision}.0`;
        const sanitizedTitle = doc.title.replace(/[^a-zA-Z0-9_-]/g, "_");
        const fileName = `${sanitizedTitle}_${versionTag}.md`;

        // 3. Register into Project File Blobs & Room Attachments
        const { attachment, blob } = await attachmentService.attachToRoom({
            orgId: organizationId,
            projectId,
            sessionId: doc.sessionId,
            buffer,
            originalName: fileName,
            mimeType: "text/markdown",
            uploadedBy: options.userId || "Scribe Studio Publisher",
        });

        // 4. Update Document Publication Metadata
        const existingPublications = (doc.settings as any)?.publications || [];
        const newPublication = {
            versionTag,
            publishedAt: new Date().toISOString(),
            releaseNotes: options.releaseNotes || "Published manuscript deliverable",
            wordCount: compiled.wordCount,
            attachmentId: attachment.id,
            blobId: blob.id,
            theme: options.theme || "corporate_legal",
        };

        const [updatedDoc] = await db
            .update(scribeDocuments)
            .set({
                currentRevision: doc.currentRevision + 1,
                settings: {
                    ...(doc.settings as any),
                    // Newest first, and capped: this lives in a jsonb column that
                    // is read whole on every document load, so an unbounded
                    // history would grow the read cost of the studio forever.
                    publications: [newPublication, ...existingPublications].slice(0, 50),
                },
                updatedAt: new Date(),
            })
            .where(eq(scribeDocuments.id, documentId))
            .returning();

        // A publish is a tagged release; the revision records the exact state
        // that went out, so "what did we ship" is a query, not a guess.
        void scribeVersioningService
            .recordDocumentRevision(updatedDoc, organizationId, {
                kind: "publish",
                message: `Published ${versionTag}`,
                actor: options.userId,
                branchId: options.branchId,
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed on publish: ${err?.message ?? err}`));

        // 5. Post Supervisor Announcement Turn in Room
        const [lastTurn] = await db
            .select()
            .from(crewTurns)
            .where(eq(crewTurns.sessionId, doc.sessionId))
            .orderBy(desc(crewTurns.id))
            .limit(1);

        const nextRound = (lastTurn?.round ?? 0) + 1;
        const downloadUrl = `/api/attachments/${attachment.id}/download`;

        await db.insert(crewTurns).values({
            sessionId: doc.sessionId,
            organizationId,
            speakerType: "supervisor",
            speakerName: "Scribe Publisher",
            content: `🚀 **Manuscript Published to Project Assets**\n\n**${compiled.title}** (${versionTag}) has been compiled and catalogued as a primary project deliverable (${compiled.wordCount} words).\n\n${options.releaseNotes ? `*Release Notes*: ${options.releaseNotes}\n\n` : ""}📎 **Deliverable Asset**: [${fileName}](${downloadUrl})`,
            round: nextRound,
            topic: "Deliverable Published",
            intent: "scribe_published",
            artifacts: [
                {
                    tool: "scribe_deliverable",
                    payload: {
                        type: "scribe_publication",
                        title: compiled.title,
                        versionTag,
                        wordCount: compiled.wordCount,
                        attachmentId: attachment.id,
                        url: downloadUrl,
                        downloadUrl,
                    },
                },
            ] as any,
        });

        logger.info(`[Scribe] Published document #${documentId} (${versionTag}) to project #${projectId} and attachment #${attachment.id}`);

        return {
            document: updatedDoc,
            compiled,
            attachment,
            versionTag,
            downloadUrl,
        };
    }

    /**
     * A station's scaffold when the model could not supply one.
     *
     * Deterministic, and deliberately not empty: the author pressed a button
     * that promises a skeleton, so every station comes back with its brief and
     * the context to write against.
     */
    private fallbackScaffold(
        stationDef: { title: string; description: string } | undefined,
        context: string,
    ): string {
        if (!stationDef) return context ? `> Context: ${context}` : "";
        const lead = `_${stationDef.description}_`;
        return context ? `${lead}\n\n> Working from: ${context}` : lead;
    }

    /**
     * One model call drafting an opening for every station from the author's
     * context.
     *
     * One call rather than one per station: a twelve-station framework would
     * otherwise cost twelve calls each time the button is pressed. Returns a
     * map keyed by stationKey; a station the model skips simply has no entry
     * and picks up the deterministic fallback.
     */
    private async draftStationScaffolds(
        framework: { name: string; stations: Array<{ stationKey: string; title: string; description: string }> },
        nodes: ScribeNode[],
        context: string,
        entities: Record<string, string>,
    ): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        if (!context) return out;

        const stationList = nodes
            .map((n) => {
                const def = framework.stations.find((s) => s.stationKey === n.stationKey);
                return `- ${n.stationKey}: ${def?.title ?? n.title} — ${def?.description ?? ""}`;
            })
            .join("\n");

        const entityLines = Object.entries(entities)
            .filter(([, v]) => v)
            .map(([k, v]) => `- ${k}: ${v}`)
            .join("\n");

        const prompt = `You are preparing the skeleton of a "${framework.name}" document.

The author described what they want:
"""
${context}
"""
${entityLines ? `\nKnown details:\n${entityLines}\n` : ""}
Sections to draft, by key:
${stationList}

For EVERY section key above, write 2-3 sentences opening that section, specific
to what the author described. Not a summary of the section's purpose — the
actual opening prose they can edit. Where the author gave no detail for a
section, write the sentences that section needs and mark unknowns as [TBD].

Return ONLY a JSON object mapping every section key to its text:
{ "section_key": "the drafted opening..." }`;

        try {
            const reply = await systemAiService.generateText(prompt, {
                serviceKey: "copilot",
                temperature: 0.4,
            });
            const match = reply?.match(/\{[\s\S]*\}/);
            if (!match) return out;

            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            for (const node of nodes) {
                const v = parsed[node.stationKey];
                if (typeof v === "string" && v.trim().length > 0) {
                    out.set(node.stationKey, v.trim());
                }
            }
        } catch (err: any) {
            // The fallback covers every station, so a failed or malformed
            // draft degrades the skeleton rather than blocking it.
            logger.warn(`[Scribe] Station drafting failed, using deterministic scaffolds: ${err?.message ?? err}`);
        }

        return out;
    }

    /**
     * Crystallizes a document's stations from a user-supplied context paragraph.
     * Maps extracted context and entities to stations, seeds initial content,
     * replaces template variables, and returns the updated FullDocumentView.
     */
    async crystallizeFromContext(
        documentId: number,
        organizationId: number,
        contextParagraph: string,
        extractedEntities: Record<string, string> = {}
    ): Promise<FullDocumentView> {
        const doc = await this.requireDocument(documentId, organizationId);
        const framework = getFramework(doc.archetypeMode as ScribeArchetypeMode);

        const nodes = await db
            .select()
            .from(scribeNodes)
            .where(
                and(
                    eq(scribeNodes.documentId, documentId),
                    eq(scribeNodes.branchId, doc.activeBranchId!)
                )
            )
            .orderBy(asc(scribeNodes.sortOrder));

        const cleanParagraph = (contextParagraph || "").trim();

        // Draft a scaffold for EVERY station in one call.
        //
        // This used to seed a station only when a word from its title or
        // description literally appeared in the author's paragraph, plus
        // whichever station happened to be first. On a twelve-station framework
        // a short paragraph matches almost nothing, so pressing "Crystallize
        // Document Skeleton" filled one station and left the rest blank — the
        // incomplete skeleton the button appears to promise against.
        const drafted = await this.draftStationScaffolds(framework, nodes, cleanParagraph, extractedEntities);

        for (const node of nodes) {
            const stationDef = framework.stations.find((s) => s.stationKey === node.stationKey);
            let seededContent = node.content || "";

            // An author who already wrote something keeps it. Crystallize fills
            // blanks; it does not overwrite work.
            if (seededContent.trim().length === 0 || (!isStationDrafted(node) && seededContent === stationDef?.suggestedScaffolding)) {
                seededContent =
                    drafted.get(node.stationKey) ??
                    // Never blank after the button was pressed. If the model
                    // gave nothing for this station, the station's own brief is
                    // still a better starting point than an empty box.
                    this.fallbackScaffold(stationDef, cleanParagraph);
            }

            // Template variables like {{client_name}}, applied after drafting so
            // they land in generated text too.
            for (const [key, value] of Object.entries(extractedEntities)) {
                if (value) {
                    const placeholderRegex = new RegExp(`\\{\\{${key}\\}\\}`, "gi");
                    seededContent = seededContent.replace(placeholderRegex, value);
                }
            }

            const wordCount = seededContent.trim().split(/\s+/).filter(Boolean).length;

            await db
                .update(scribeNodes)
                .set({
                    content: seededContent,
                    wordCount,
                    updatedAt: new Date(),
                })
                .where(eq(scribeNodes.id, node.id));
        }

        logger.info(`[Scribe] Crystallized document #${documentId} from context (${cleanParagraph.length} chars)`);

        void scribeVersioningService
            .recordDocumentRevision(doc, organizationId, {
                kind: "edit",
                message: "Crystallized from document brief",
                actor: "author",
            })
            .catch((err) => logger.warn(`[Scribe] Revision write failed on crystallize: ${err?.message ?? err}`));

        return this.getDocument(documentId, organizationId);
    }

    /**
     * Live stream evaluation: evaluates in-flight station deltas and returns immediate agent insights
     */
    /**
     * Ambient review for the stream-delta route.
     *
     * A thin adapter over evaluateAmbientDelta rather than a second rule set.
     * This carried its own inline regexes for placeholders, SLA remedies,
     * uncapped liability and long sentences — overlapping Tier 1, with no
     * precision corpus, no defined-term ledger, and no change-gating, so the
     * two would drift and a fix to one would never reach the other.
     *
     * Everything it caught that Tier 1 did not now lives in
     * ambient-sentinel.service.ts as sla_without_remedy and overlong_sentence,
     * with the liability and placeholder patterns widened to match, all covered
     * by the precision corpus.
     *
     * The one rule NOT carried over is the "Flow & Tone Aligned" praise, which
     * fired whenever no other rule matched and the text passed 150 characters,
     * and told the author their prose "has strong cadence and aligns well with
     * the document's voice". Nothing measured that. Praise a rule cannot
     * justify is worse than silence: it is the same manufactured assessment as
     * a safety score with no measurement behind it, and it teaches the author
     * that the gutter does not mean anything.
     */
    async evaluateLiveDelta(
        documentId: number,
        nodeId: number,
        content: string,
        organizationId: number
    ): Promise<{ insights: ScribeLiveInsight[] }> {
        const { insights } = await this.evaluateAmbientDelta({
            documentId,
            organizationId,
            nodeId,
            text: content || "",
        });

        return {
            insights: insights.map((i) => ({
                // Stable across re-evaluations, so a marker keeps its identity
                // instead of remounting on every delta.
                id: `${i.ruleId}:${i.start}`,
                agentRole: "RuleEngine",
                lensType: i.lensType as ScribeLiveInsight["lensType"],
                type:
                    i.severity === "warning" || i.severity === "critical_conflict"
                        ? "warning"
                        : "suggestion",
                title: i.title,
                message: i.detail,
                originalExcerpt: i.excerpt,
                suggestedReplacement: i.ruleId === "tether_conflict" ? i.canonical : undefined,
                canonical: i.canonical,
                // No confidence: a rule match is a literal hit, not a judgement
                // with a probability behind it. The numbers here were invented.
            })),
        };
    }

}

export const scribeService = new ScribeService();
