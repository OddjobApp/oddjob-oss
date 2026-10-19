/**
 * Code → Docs Pipeline (Path A orchestrator)
 * ==========================================
 *
 * Ties the four Path-A services into one governed flow. Given a capability
 * manifest (built from tool reflection or a visual-canvas save), it:
 *
 *   1. Asks the reconciler whether the code actually changed (the loop-break
 *      gate). If not, it stops — no recompile, no commit, no re-index.
 *   2. Compiles the manifest to Markdown (Gemini-first, deterministic fallback).
 *   3. Merges the fresh body with any existing changelog and, on drift, appends a
 *      dated `[Auto-Changelog]` entry — history preserved, never overwritten.
 *   4. Writes + risk-gates the commit (safe-by-default git writer).
 *   5. Indexes the manifest into the vector router so `discover()` reflects it.
 *   6. Persists the reconciled sync state LAST, so any mid-flow failure leaves
 *      the capability un-synced and the worker safely retries.
 *
 * All collaborators are injectable for testing; production uses the singletons.
 */

import { createLogger } from "@server/utils/logger.js";
import {
    parseCapabilityManifest,
    type CapabilityManifest,
} from "@shared/schema/capabilities/index.js";
import {
    capabilityReconciler,
    mergeWithChangelog,
    type CapabilityReconcilerService,
    type FieldDiff,
} from "./capability-reconciler.service.js";
import { capabilityRegistry, type CapabilityRegistryService } from "./capability-registry.service.js";
import { docCompiler, type DocCompilerService } from "./doc-compiler.service.js";
import { gitDocWriter, type GitDocWriterService, type CommitResult } from "./git-doc-writer.service.js";
import {
    capabilityDocumentationPublisher,
    type CapabilityDocumentationPublisher,
} from "./capability-documentation.publisher.js";

const logger = createLogger("CodeToDocsPipeline");

export interface CodeToDocsResult {
    capabilityId: string;
    /** False when the reconciler gated the run out (nothing changed). */
    applied: boolean;
    reason: string;
    isNew: boolean;
    changedFields: FieldDiff[];
    /** Present when the run applied. */
    commit?: CommitResult;
    indexed: boolean;
    revision?: number;
}

export interface CodeToDocsDeps {
    reconciler: Pick<CapabilityReconcilerService, "decide" | "commit">;
    registry: Pick<CapabilityRegistryService, "register">;
    compiler: Pick<DocCompilerService, "compile">;
    writer: Pick<GitDocWriterService, "readExisting" | "write">;
    publisher: CapabilityDocumentationPublisher;
}

export class CodeToDocsPipeline {
    private readonly deps: CodeToDocsDeps;

    constructor(deps: Partial<CodeToDocsDeps> = {}) {
        this.deps = {
            reconciler: deps.reconciler ?? capabilityReconciler,
            registry: deps.registry ?? capabilityRegistry,
            compiler: deps.compiler ?? docCompiler,
            writer: deps.writer ?? gitDocWriter,
            publisher: deps.publisher ?? capabilityDocumentationPublisher,
        };
    }

    /**
     * Run Path A for a single capability.
     *
     * @param organizationId owning org
     * @param input a manifest (validated defensively)
     * @throws if embedding/indexing fails, so the worker can retry (the sync
     *   state is only persisted after indexing succeeds).
     */
    async run(organizationId: number, input: CapabilityManifest | Record<string, unknown>): Promise<CodeToDocsResult> {
        const manifest = parseCapabilityManifest(input);
        const capabilityId = manifest.capability_id;

        const decision = await this.deps.reconciler.decide(organizationId, manifest, "code");
        if (!decision.apply) {
            logger.info(`Skipping ${capabilityId}: ${decision.reason}`);
            return {
                capabilityId,
                applied: false,
                reason: decision.reason,
                isNew: decision.isNew,
                changedFields: [],
                indexed: false,
            };
        }

        // Compile, then merge with any existing changelog (non-destructive).
        const body = await this.deps.compiler.compile(manifest);
        const existing = await this.deps.writer.readExisting(capabilityId);
        const markdown = mergeWithChangelog(body, existing, decision.changedFields, "code");

        // Write + risk-gated commit.
        const commit = await this.deps.writer.write(
            capabilityId,
            markdown,
            manifest.runtime_context.risk_profile,
        );

        // Index into the vector router (may throw if embeddings are down -> retry).
        await this.deps.registry.register(organizationId, manifest);

        // Publish into Documentation before committing reconciler state. The
        // publisher is idempotent, so a later failure retries without duplicating
        // the register entry and cannot leave an applied change undocumented.
        const nextRevision = (decision.previous?.revision ?? 0) + 1;
        await this.deps.publisher.publish({
            organizationId,
            manifest,
            markdown,
            revision: nextRevision,
            source: "code",
            changeKind: decision.changeKind === "none" ? "documentation" : decision.changeKind,
            changedFields: decision.changedFields,
            contentHash: decision.contentHash,
            docPath: commit.docPath,
        });

        // Persist reconciled state LAST.
        const row = await this.deps.reconciler.commit(organizationId, manifest, "code", {
            docMarkdown: markdown,
        });

        logger.info(
            `Path A complete for ${capabilityId} (${decision.isNew ? "new" : "drift"}, ` +
                `rev=${row.revision}, committed=${commit.committed}, review=${commit.requiresReview})`,
        );

        return {
            capabilityId,
            applied: true,
            reason: decision.reason,
            isNew: decision.isNew,
            changedFields: decision.changedFields,
            commit,
            indexed: true,
            revision: row.revision,
        };
    }
}

export const codeToDocsPipeline = new CodeToDocsPipeline();
