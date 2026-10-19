/**
 * Docs → Code Pipeline (Path B orchestrator)
 * ==========================================
 *
 * The upstream direction: parse Markdown capability docs and register the
 * capabilities they describe back into the live vector router. This is what lets
 * a hand-edited doc introduce or amend a capability.
 *
 * The bi-directional loop is broken by TWO guards, both here:
 *
 *   1. `reconciler.fileChanged` — a per-file content hash. A doc that hasn't
 *      changed since we last processed it (including one Path A just generated)
 *      is skipped BEFORE any LLM call. Cheap and decisive.
 *   2. `reconciler.decide("docs")` — the behavioural signature gate. Even if a
 *      file changed cosmetically, if the extracted manifest matches the stored
 *      signature we do NOT re-register.
 *
 * Ordering is retry-safe: on any extraction/registration failure the file is
 * left UNMARKED so a later scan retries it; the file hash is recorded only after
 * a successful outcome.
 *
 * Collaborators are injectable; folder scanning uses the real filesystem.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { createLogger } from "@server/utils/logger.js";
import {
    capabilityReconciler,
    type CapabilityReconcilerService,
    type FieldDiff,
} from "./capability-reconciler.service.js";
import { capabilityRegistry, type CapabilityRegistryService } from "./capability-registry.service.js";
import { manifestExtractor, type ManifestExtractorService } from "./manifest-extractor.service.js";
import { riskRequiresIsolation } from "@shared/schema/capabilities/index.js";
import {
    capabilityDocumentationPublisher,
    type CapabilityDocumentationPublisher,
} from "./capability-documentation.publisher.js";

const logger = createLogger("DocsToCodePipeline");

export type IngestStatus =
    | "registered"
    | "skipped_unchanged_file"
    | "skipped_in_sync"
    | "review_required"
    | "error";

export interface IngestResult {
    docPath: string;
    capabilityId?: string;
    status: IngestStatus;
    reason?: string;
    changedFields?: FieldDiff[];
}

export interface DocsToCodeDeps {
    reconciler: Pick<CapabilityReconcilerService, "fileChanged" | "decide" | "commit" | "markFile">;
    registry: Pick<CapabilityRegistryService, "register">;
    extractor: Pick<ManifestExtractorService, "extract">;
    publisher: CapabilityDocumentationPublisher;
}

export interface DocsToCodeConfig {
    repoRoot: string;
    docsDir: string;
}

export function isPathWithin(root: string, candidate: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function defaultConfig(): DocsToCodeConfig {
    const repoRoot = process.env.ACDD_DOCS_REPO_PATH || process.cwd();
    const docsDir = path.resolve(repoRoot, process.env.ACDD_DOCS_SUBDIR || "docs/capabilities");
    return { repoRoot, docsDir };
}

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export class DocsToCodePipeline {
    private readonly deps: DocsToCodeDeps;
    private readonly config: DocsToCodeConfig;

    constructor(deps: Partial<DocsToCodeDeps> = {}, config: Partial<DocsToCodeConfig> = {}) {
        this.deps = {
            reconciler: deps.reconciler ?? capabilityReconciler,
            registry: deps.registry ?? capabilityRegistry,
            extractor: deps.extractor ?? manifestExtractor,
            publisher: deps.publisher ?? capabilityDocumentationPublisher,
        };
        this.config = { ...defaultConfig(), ...config };
    }

    /**
     * Core testable unit: ingest a single doc's content under a stable path key.
     * @param docPath repo-relative path used as the file-hash key (e.g.
     *   `docs/capabilities/x.md`).
     */
    async ingestDoc(organizationId: number, docPath: string, content: string): Promise<IngestResult> {
        // Guard 1: unchanged file — skip before any LLM cost.
        const changed = await this.deps.reconciler.fileChanged(organizationId, docPath, content);
        if (!changed) {
            return { docPath, status: "skipped_unchanged_file" };
        }

        let manifest;
        try {
            manifest = await this.deps.extractor.extract(content);
        } catch (err) {
            // Leave unmarked so a later scan retries (could be a transient LLM error).
            logger.warn(`Extraction failed for ${docPath}: ${errMessage(err)}`);
            return { docPath, status: "error", reason: `extraction failed: ${errMessage(err)}` };
        }

        try {
            // Guard 2: behavioural signature gate.
            const decision = await this.deps.reconciler.decide(organizationId, manifest, "docs");
            if (decision.apply) {
                if (riskRequiresIsolation(manifest.runtime_context.risk_profile)) {
                    return {
                        docPath,
                        capabilityId: manifest.capability_id,
                        status: "review_required",
                        reason: `${manifest.runtime_context.risk_profile}-risk documentation changes require approval before registry activation`,
                        changedFields: decision.changedFields,
                    };
                }
                await this.deps.registry.register(organizationId, manifest);
                const nextRevision = (decision.previous?.revision ?? 0) + 1;
                await this.deps.publisher.publish({
                    organizationId,
                    manifest,
                    markdown: content,
                    revision: nextRevision,
                    source: "docs",
                    changeKind: decision.changeKind === "none" ? "documentation" : decision.changeKind,
                    changedFields: decision.changedFields,
                    contentHash: decision.contentHash,
                    docPath,
                });
                await this.deps.reconciler.commit(organizationId, manifest, "docs", { docMarkdown: content });
                await this.deps.reconciler.markFile(organizationId, docPath, content);
                logger.info(
                    `Registered ${manifest.capability_id} from ${docPath} (${decision.isNew ? "new" : "drift"}).`,
                );
                return {
                    docPath,
                    capabilityId: manifest.capability_id,
                    status: "registered",
                    reason: decision.reason,
                    changedFields: decision.changedFields,
                };
            }

            // In sync (e.g. a doc Path A just generated) — record the file so we
            // don't re-extract it next scan.
            await this.deps.reconciler.markFile(organizationId, docPath, content);
            return {
                docPath,
                capabilityId: manifest.capability_id,
                status: "skipped_in_sync",
                reason: decision.reason,
            };
        } catch (err) {
            logger.warn(`Registration failed for ${docPath}: ${errMessage(err)}`);
            return {
                docPath,
                capabilityId: manifest.capability_id,
                status: "error",
                reason: errMessage(err),
            };
        }
    }

    /** Read a Markdown file from disk and ingest it. */
    async ingestFile(organizationId: number, requestedPath: string): Promise<IngestResult> {
        const absPath = await this.resolveContainedPath(requestedPath);
        if (path.extname(absPath).toLowerCase() !== ".md") {
            throw new Error("Capability documentation ingestion only accepts Markdown files.");
        }
        const content = await fs.readFile(absPath, "utf8");
        const relPath = path.relative(this.config.repoRoot, absPath).split(path.sep).join("/");
        return this.ingestDoc(organizationId, relPath, content);
    }

    /** Scan the docs directory (recursively) and ingest every Markdown file. */
    async ingestFolder(organizationId: number, dir?: string): Promise<IngestResult[]> {
        const root = await this.resolveContainedPath(dir ?? this.config.docsDir);
        const files = await this.listMarkdown(root);
        const results: IngestResult[] = [];
        for (const file of files) {
            results.push(await this.ingestFile(organizationId, file));
        }
        logger.info(`Path B scan of ${root}: ${summarize(results)}`);
        return results;
    }

    /** Resolve symlinks and reject every target outside the configured docs root. */
    private async resolveContainedPath(requestedPath: string): Promise<string> {
        const root = await fs.realpath(this.config.docsDir).catch(() => path.resolve(this.config.docsDir));
        const candidate = path.isAbsolute(requestedPath)
            ? requestedPath
            : path.resolve(this.config.docsDir, requestedPath);
        const resolved = await fs.realpath(candidate);
        if (!isPathWithin(root, resolved)) {
            throw new Error(`Refusing to read outside capability docs root: ${requestedPath}`);
        }
        return resolved;
    }

    private async listMarkdown(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const out: string[] = [];
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                out.push(...(await this.listMarkdown(full)));
            } else if (entry.isFile() && entry.name.endsWith(".md")) {
                out.push(full);
            }
        }
        return out.sort();
    }
}

function summarize(results: IngestResult[]): string {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
}

export const docsToCodePipeline = new DocsToCodePipeline();
