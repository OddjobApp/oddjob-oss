/**
 * Capability Reconciler Service
 * =============================
 *
 * The loop-breaker at the centre of the ACDD bi-directional engine. Both
 * pipeline directions call into it before they write anything:
 *
 *   - Path A (code → docs) asks "did the code actually change?" before it
 *     recompiles/commits a doc.
 *   - Path B (docs → code) asks "did the doc actually change the capability?"
 *     before it re-registers into the vector router.
 *
 * How the loop is broken
 * ----------------------
 * Every manifest yields a *signature hash* — a SHA-256 over only its behavioural
 * fields (id, category, input/output types, guardrails, risk, environment),
 * deliberately excluding cosmetic prose. If an incoming manifest's signature
 * hash equals the stored one, {@link CapabilityReconcilerService.decide} returns
 * `apply=false`. Because a doc generated *from* the current code round-trips to
 * the same signature, Path B never re-ingests what Path A just produced, and
 * vice-versa. Only a genuine behavioural change (a changed data type, a new
 * guardrail) flips the gate open.
 *
 * When drift *is* real, changes are applied non-destructively: the compiled doc
 * is merged with any pre-existing changelog block and a dated
 * `[Auto-Changelog YYYY-MM-DD]` entry is appended — history is patched, never
 * blindly overwritten.
 *
 * State is org-scoped Postgres (see `shared/schema/capabilities/sync.ts`), not a
 * process-local file, so reconciliation is correct across the worker fleet.
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    capabilitySyncState,
    capabilityDocFileState,
    capabilitySignature,
    stableStringify,
    riskRequiresIsolation,
    type CapabilityManifest,
    type CapabilitySyncStateRow,
    type SyncSource,
} from "@shared/schema/capabilities/index.js";

const logger = createLogger("CapabilityReconciler");

const CHANGELOG_MARKER = "<!-- ACDD:CHANGELOG -->";

// ---------------------------------------------------------------------------
// Pure, DB-free primitives (exported for direct unit testing).
// ---------------------------------------------------------------------------

export type FieldChangeType = "added" | "removed" | "modified";
export type ReconcileChangeKind = "new" | "behavioral" | "documentation" | "none";

export interface FieldDiff {
    /** Dotted path into the signature, e.g. `inputs.amount` or `risk_profile`. */
    path: string;
    changeType: FieldChangeType;
    old: unknown;
    new: unknown;
}

export interface ReconcileDecision {
    /** Whether the incoming state should be applied (compiled/registered). */
    apply: boolean;
    /** True when no prior state existed for this capability. */
    isNew: boolean;
    /** Human-readable rationale, surfaced in logs and the status endpoint. */
    reason: string;
    /** Behavioural field changes vs. the stored signature (empty when new/no-op). */
    changedFields: FieldDiff[];
    /** The stored row, when one existed. */
    previous?: CapabilitySyncStateRow;
    signatureHash: string;
    contentHash: string;
    /** Classification used by documentation and release-note integrations. */
    changeKind: ReconcileChangeKind;
}

function sha256(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 over the behavioural signature — the gate that breaks the loop. */
export function computeSignatureHash(manifest: CapabilityManifest): string {
    return sha256(stableStringify(capabilitySignature(manifest)));
}

/** SHA-256 over the full canonical manifest — detects *any* change. */
export function computeContentHash(manifest: CapabilityManifest): string {
    return sha256(stableStringify(manifest));
}

/** SHA-256 over a compiled/ingested Markdown doc — cheap file-level dedupe. */
export function computeDocHash(markdown: string): string {
    return sha256(markdown);
}

/**
 * Compute the behavioural field diff between a previously-stored signature and a
 * new manifest. Used to build changelog entries and status reports.
 */
export function diffSignature(
    oldSignature: Record<string, unknown>,
    newManifest: CapabilityManifest,
): FieldDiff[] {
    const oldSig = oldSignature ?? {};
    const newSig = capabilitySignature(newManifest);
    const diffs: FieldDiff[] = [];

    for (const key of ["capability_id", "category", "risk_profile", "execution_environment"]) {
        const oldValue = oldSig[key];
        const newValue = newSig[key];
        if (oldValue !== newValue) {
            diffs.push({
                path: key,
                changeType: oldValue === undefined ? "added" : newValue === undefined ? "removed" : "modified",
                old: oldValue,
                new: newValue,
            });
        }
    }

    for (const key of ["inputs", "outputs"]) {
        diffMap(
            key,
            (oldSig[key] as Record<string, unknown>) ?? {},
            (newSig[key] as Record<string, unknown>) ?? {},
            diffs,
        );
    }

    diffArray("guardrails", (oldSig.guardrails as unknown[]) ?? [], (newSig.guardrails as unknown[]) ?? [], diffs);

    return diffs;
}

/**
 * Report non-behavioural manifest changes. These fields still need a rebuilt
 * document and refreshed semantic index even though they must not create a
 * behavioural code⇄docs ping-pong.
 */
export function diffDocumentation(
    oldManifest: Partial<CapabilityManifest> | null | undefined,
    newManifest: CapabilityManifest,
): FieldDiff[] {
    if (!oldManifest) return [];
    const paths: Array<[string, unknown, unknown]> = [
        ["schema_version", oldManifest.schema_version, newManifest.schema_version],
        ["capability_version", oldManifest.capability_version, newManifest.capability_version],
        ["metadata.display_name", oldManifest.metadata?.display_name, newManifest.metadata.display_name],
        ["metadata.description", oldManifest.metadata?.description, newManifest.metadata.description],
        ["metadata.owner", oldManifest.metadata?.owner, newManifest.metadata.owner],
        ["documentation_meta.summary", oldManifest.documentation_meta?.summary, newManifest.documentation_meta.summary],
        [
            "documentation_meta.business_use_cases",
            oldManifest.documentation_meta?.business_use_cases,
            newManifest.documentation_meta.business_use_cases,
        ],
        ["runtime_context.dependencies", oldManifest.runtime_context?.dependencies, newManifest.runtime_context.dependencies],
    ];
    return paths.flatMap(([path, oldValue, newValue]) => {
        if (stableStringify(oldValue) === stableStringify(newValue)) return [];
        return [{
            path,
            changeType: oldValue === undefined ? "added" : newValue === undefined ? "removed" : "modified",
            old: oldValue,
            new: newValue,
        } satisfies FieldDiff];
    });
}

function diffMap(
    prefix: string,
    oldMap: Record<string, unknown>,
    newMap: Record<string, unknown>,
    diffs: FieldDiff[],
): void {
    const keys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    for (const key of keys) {
        const oldValue = oldMap[key];
        const newValue = newMap[key];
        if (oldValue === newValue) continue;
        diffs.push({
            path: `${prefix}.${key}`,
            changeType: oldValue === undefined ? "added" : newValue === undefined ? "removed" : "modified",
            old: oldValue,
            new: newValue,
        });
    }
}

function diffArray(prefix: string, oldArr: unknown[], newArr: unknown[], diffs: FieldDiff[]): void {
    const oldSet = new Set(oldArr.map((v) => String(v)));
    const newSet = new Set(newArr.map((v) => String(v)));
    for (const value of newSet) {
        if (!oldSet.has(value)) diffs.push({ path: prefix, changeType: "added", old: undefined, new: value });
    }
    for (const value of oldSet) {
        if (!newSet.has(value)) diffs.push({ path: prefix, changeType: "removed", old: value, new: undefined });
    }
}

function formatValue(value: unknown): string {
    if (value === undefined || value === null) return "—";
    return typeof value === "string" ? value : JSON.stringify(value);
}

/** Render a single dated changelog entry from a set of field diffs. */
export function formatChangelogEntry(diffs: FieldDiff[], source: SyncSource, date = new Date()): string {
    const stamp = date.toISOString().slice(0, 10);
    const header = `- **[Auto-Changelog ${stamp}]** (source: ${source}) — ${diffs.length} field change(s):`;
    const lines = diffs.map(
        (d) => `  - ${d.changeType} \`${d.path}\`: \`${formatValue(d.old)}\` → \`${formatValue(d.new)}\``,
    );
    return [header, ...lines].join("\n");
}

/** The newest entry in a changelog section (entries are appended at the bottom). */
function lastEntry(entries: string): string {
    const starts = [...entries.matchAll(/^- \*\*\[Auto-Changelog /gm)].map((m) => m.index ?? 0);
    return starts.length ? entries.slice(starts[starts.length - 1]) : "";
}

/** An entry's per-field lines, without the dated header: what changed, not when. */
function changeLines(entry: string): string {
    return entry
        .split(/\r?\n/)
        .filter((line) => line.startsWith("  - "))
        .map((line) => line.trimEnd())
        .join("\n");
}

/**
 * Merge freshly compiled Markdown with any pre-existing changelog so history is
 * preserved rather than overwritten. When there are no diffs (a brand-new
 * capability) the body is returned untouched — no empty changelog section.
 */
export function mergeWithChangelog(
    newBody: string,
    existingText: string | null | undefined,
    diffs: FieldDiff[],
    source: SyncSource,
    date = new Date(),
): string {
    const priorEntries =
        existingText && existingText.includes(CHANGELOG_MARKER)
            ? existingText.split(CHANGELOG_MARKER)[1]?.trim() ?? ""
            : "";

    let newEntry = diffs.length > 0 ? formatChangelogEntry(diffs, source, date) : "";

    // A retry, not a new change. The pipeline writes the doc before it persists
    // reconciled state, so a run that fails after the write retries with the same
    // diff against the same stored state, and appended the same entry again on
    // every attempt: one risk_profile change reached a doc six times. The same
    // field changes as the latest entry are that entry; a real change back and
    // forth would show the reverse change in between.
    if (newEntry && changeLines(lastEntry(priorEntries)) === changeLines(newEntry)) {
        newEntry = "";
    }

    if (!priorEntries && !newEntry) {
        return newBody.trimEnd() + "\n";
    }

    // Newest entry appended to the bottom, per the "append to the bottom" rule.
    const combined = [priorEntries, newEntry].filter(Boolean).join("\n\n");
    return (
        `${newBody.trimEnd()}\n\n---\n\n## Change History\n\n${CHANGELOG_MARKER}\n\n${combined}\n`
    );
}

// ---------------------------------------------------------------------------
// DB-backed service
// ---------------------------------------------------------------------------

export interface SyncStatusReport {
    organizationId: number;
    synchronized: boolean;
    total: number;
    inSync: string[];
    drifted: Array<{ capabilityId: string; previousSource: SyncSource; storedRevision: number }>;
    missingState: string[];
}

export class CapabilityReconcilerService {
    /**
     * Decide whether an incoming manifest should be applied.
     * Reads (does not mutate) the stored state — call {@link commit} to persist.
     */
    async decide(
        organizationId: number,
        manifest: CapabilityManifest,
        _source: SyncSource,
    ): Promise<ReconcileDecision> {
        const signatureHash = computeSignatureHash(manifest);
        const contentHash = computeContentHash(manifest);
        const previous = await this.getState(organizationId, manifest.capability_id);

        if (!previous) {
            return {
                apply: true,
                isNew: true,
                reason: "new capability",
                changedFields: [],
                signatureHash,
                contentHash,
                changeKind: "new",
            };
        }

        if (previous.signatureHash === signatureHash) {
            if (previous.contentHash !== contentHash) {
                return {
                    apply: true,
                    isNew: false,
                    reason: "documentation drift detected",
                    changedFields: diffDocumentation(
                        previous.manifest as Partial<CapabilityManifest> | null,
                        manifest,
                    ),
                    previous,
                    signatureHash,
                    contentHash,
                    changeKind: "documentation",
                };
            }
            // Loop break: identical behaviour is never re-applied, regardless of
            // which direction the request came from.
            return {
                apply: false,
                isNew: false,
                reason: "already in sync (signature unchanged)",
                changedFields: [],
                previous,
                signatureHash,
                contentHash,
                changeKind: "none",
            };
        }

        const changedFields = diffSignature(
            (previous.signature as Record<string, unknown>) ?? {},
            manifest,
        );
        return {
            apply: true,
            isNew: false,
            reason: "behavioural drift detected",
            changedFields,
            previous,
            signatureHash,
            contentHash,
            changeKind: "behavioral",
        };
    }

    /**
     * Persist the applied state for a capability. Bumps the changelog revision on
     * an existing row. Should be called only after {@link decide} returned
     * `apply=true` and the doc/registry side-effects have succeeded.
     */
    async commit(
        organizationId: number,
        manifest: CapabilityManifest,
        source: SyncSource,
        options: { docMarkdown?: string } = {},
    ): Promise<CapabilitySyncStateRow> {
        const signatureHash = computeSignatureHash(manifest);
        const contentHash = computeContentHash(manifest);
        const docHash = options.docMarkdown !== undefined ? computeDocHash(options.docMarkdown) : null;
        const signature = capabilitySignature(manifest);
        const riskProfile = manifest.runtime_context.risk_profile;

        const [row] = await db
            .insert(capabilitySyncState)
            .values({
                organizationId,
                capabilityId: manifest.capability_id,
                schemaVersion: manifest.schema_version,
                capabilityVersion: manifest.capability_version,
                signatureHash,
                contentHash,
                docHash,
                lastSource: source,
                signature,
                manifest,
                riskProfile,
                revision: 1,
            })
            .onConflictDoUpdate({
                target: [capabilitySyncState.organizationId, capabilitySyncState.capabilityId],
                set: {
                    signatureHash,
                    contentHash,
                    schemaVersion: manifest.schema_version,
                    capabilityVersion: manifest.capability_version,
                    // Preserve an existing doc hash if this commit didn't supply one.
                    docHash: docHash ?? sql`${capabilitySyncState.docHash}`,
                    lastSource: source,
                    signature,
                    manifest,
                    riskProfile,
                    revision: sql`${capabilitySyncState.revision} + 1`,
                    updatedAt: new Date(),
                },
            })
            .returning();

        logger.info(
            `Committed sync state for ${manifest.capability_id} (source=${source}, risk=${riskProfile}` +
                `${riskRequiresIsolation(riskProfile) ? ", isolation-required" : ""}, rev=${row.revision})`,
        );
        return row;
    }

    async getState(
        organizationId: number,
        capabilityId: string,
    ): Promise<CapabilitySyncStateRow | undefined> {
        const [row] = await db
            .select()
            .from(capabilitySyncState)
            .where(
                and(
                    eq(capabilitySyncState.organizationId, organizationId),
                    eq(capabilitySyncState.capabilityId, capabilityId),
                ),
            )
            .limit(1);
        return row;
    }

    /**
     * Path B fast-path: has this Markdown file changed since we last saw it?
     * Returns true when unseen or when the content hash differs. This is what
     * lets docs→code cheaply skip files the engine itself just generated.
     */
    async fileChanged(organizationId: number, docPath: string, fileContent: string): Promise<boolean> {
        const hash = computeDocHash(fileContent);
        const [row] = await db
            .select({ fileHash: capabilityDocFileState.fileHash })
            .from(capabilityDocFileState)
            .where(
                and(
                    eq(capabilityDocFileState.organizationId, organizationId),
                    eq(capabilityDocFileState.docPath, docPath),
                ),
            )
            .limit(1);
        return !row || row.fileHash !== hash;
    }

    /** Record the current hash of a Markdown file so unchanged re-scans are skipped. */
    async markFile(organizationId: number, docPath: string, fileContent: string): Promise<void> {
        const fileHash = computeDocHash(fileContent);
        await db
            .insert(capabilityDocFileState)
            .values({ organizationId, docPath, fileHash })
            .onConflictDoUpdate({
                target: [capabilityDocFileState.organizationId, capabilityDocFileState.docPath],
                set: { fileHash, updatedAt: new Date() },
            });
    }

    /**
     * Produce a diff report of whether the live capabilities (from the registry)
     * match the stored doc state. Backs `GET /api/v1/sync/status`.
     */
    async status(organizationId: number, manifests: CapabilityManifest[]): Promise<SyncStatusReport> {
        const rows = await db
            .select()
            .from(capabilitySyncState)
            .where(eq(capabilitySyncState.organizationId, organizationId));
        const byId = new Map(rows.map((r) => [r.capabilityId, r]));

        const inSync: string[] = [];
        const drifted: SyncStatusReport["drifted"] = [];
        const missingState: string[] = [];

        for (const manifest of manifests) {
            const stored = byId.get(manifest.capability_id);
            if (!stored) {
                missingState.push(manifest.capability_id);
                continue;
            }
            if (stored.signatureHash === computeSignatureHash(manifest)) {
                inSync.push(manifest.capability_id);
            } else {
                drifted.push({
                    capabilityId: manifest.capability_id,
                    previousSource: stored.lastSource as SyncSource,
                    storedRevision: stored.revision,
                });
            }
        }

        return {
            organizationId,
            synchronized: drifted.length === 0 && missingState.length === 0,
            total: manifests.length,
            inSync,
            drifted,
            missingState,
        };
    }
}

export const capabilityReconciler = new CapabilityReconcilerService();
