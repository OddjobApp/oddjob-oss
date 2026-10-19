/**
 * Code Graph Service
 *
 * Orchestrates the parse → store pipeline for workspace code analysis.
 * Stores code nodes/edges in the existing knowledgeNodes/knowledgeEdges
 * tables via the knowledge pod's graphService — no new database needed.
 *
 * Accessed by other pods via: podRegistry.getPod('xray')
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { codeParserService, DEFAULT_FILE_LIMIT, type ParsedCodeNode, type ParsedCodeEdge, type CodeNodeKind } from "./code-parser.service.js";
import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";
import { resolveForgeWorkspacePath } from "@domain/apps/core/forge-paths.js";
import { mapCodeNodeLabel } from "./code-label-mapper.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { CodeMetrics, GraphQueryResult, GraphNode, GraphEdge } from "../types/graph.js";

const logger = createLogger("CodeGraphService");

const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");

// Sentinel org context used ONLY for shared system blueprint nodes
const SYSTEM_ORG: { organizationId: null; isSuperAdmin: boolean } = {
    organizationId: null,
    isSuperAdmin: true,
};

/** Enforces multi-tenant organization isolation for workspace queries. */
function getTenantScopedOrgContext(orgId?: number | null) {
    if (!orgId) return SYSTEM_ORG;
    return { organizationId: orgId, isSuperAdmin: false };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const codeGraphService = {

    /**
     * Index a forged app workspace.
     * Called after forgeApp() completes and on file changes.
     */
    async indexWorkspace(slug: string, appId?: number, deploymentId?: number): Promise<void> {
        // resolveForgeWorkspacePath honours $FORGE_WORKSPACE, handles shared-server
        // apps that live at the repo root, and falls back to the legacy
        // storage/forge-workspace location.
        const workspacePath = await resolveForgeWorkspacePath(slug);

        logger.info(`[XRay] Indexing workspace: ${slug}${appId ? ` (AppID: ${appId})` : ''} at ${workspacePath}`);
        await indexPath(workspacePath, `forge:${slug}`, appId, deploymentId);
    },

    /**
     * Index all blueprint templates at startup.
     */
    async indexBlueprints(): Promise<void> {
        logger.info("[XRay] Indexing blueprint templates...");
        const fs = await import("node:fs/promises");
        let blueprints: string[] = [];
        try {
            const entries = await fs.readdir(BLUEPRINT_ROOT, { withFileTypes: true });
            blueprints = entries.filter(e => e.isDirectory()).map(e => e.name);
        } catch {
            logger.warn("[XRay] Blueprint root not found, skipping blueprint indexing");
            return;
        }
        for (const bp of blueprints) {
            await indexPath(path.join(BLUEPRINT_ROOT, bp), `blueprint:${bp}`);
        }
        logger.info(`[XRay] Indexed ${blueprints.length} blueprints`);
    },

    /**
     * Index the Oddjob repository itself.
     *
     * Unlike a forged app, the repo is large enough that a full re-parse on every
     * change is not viable, so this is incremental: each file carries a content
     * hash and only files whose hash moved are re-parsed and rewritten.
     *
     * Pass `files` to index a specific subset (the watcher does this); omit it
     * for a full sweep.
     */
    async indexRepo(options: { repoRoot?: string; files?: string[]; fileLimit?: number } = {}): Promise<RepoIndexResult> {
        const repoRoot = options.repoRoot ?? path.resolve(process.cwd());
        const fileLimit = options.fileLimit ?? REPO_FILE_LIMIT;
        const started = Date.now();

        const fsp = await import("node:fs/promises");
        const graphSvc = getGraphService();

        // Existing file-level hashes, so unchanged files can be skipped.
        const existing = await loadRepoFileHashes(graphSvc);

        const targets = options.files
            ? options.files.map(f => normalizeRepoPath(f, repoRoot))
            : (await collectRepoFiles(repoRoot, fileLimit));

        let changed = 0;
        let skipped = 0;
        const failures: string[] = [];

        for (const rel of targets) {
            let source: string;
            try {
                source = await fsp.readFile(path.join(repoRoot, rel), "utf-8");
            } catch {
                // Deleted since the walk — drop whatever we had for it.
                await removeRepoFileNodes(graphSvc, rel);
                continue;
            }

            const hash = createHash("sha256").update(source).digest("hex");
            if (existing.get(rel) === hash) {
                skipped++;
                continue;
            }

            try {
                await reindexRepoFile(graphSvc, repoRoot, rel, source, hash);
                changed++;
            } catch (err: any) {
                logger.warn(`[XRay] Failed to index ${rel}: ${err.message}`);
                failures.push(rel);
            }
        }

        const result: RepoIndexResult = {
            scanned: targets.length,
            changed,
            skipped,
            failed: failures.length,
            durationMs: Date.now() - started,
        };
        logger.info(
            `[XRay] Repo index: ${result.changed} changed, ${result.skipped} unchanged, ` +
            `${result.failed} failed of ${result.scanned} in ${result.durationMs}ms`,
        );
        return result;
    },

    /**
     * Query the code graph for a given workspace slug.
     * Returns nodes + edges scoped to that workspace's fingerprint prefix.
     */
    async queryGraph(slug: string): Promise<GraphQueryResult> {
        const graphSvc = getGraphService();
        const prefix = resolveFingerprintPrefix(slug);

        const result = await graphSvc.searchNodes(SYSTEM_ORG as any, {
            label: undefined,
            limit: 50_000,
        });

        // Filter to this workspace via the exact prefix recorded on each node.
        const workspaceNodes = (result.nodes as any[]).filter(n =>
            (n.data as ParsedCodeNode["data"])?.fingerprintPrefix === prefix
        );

        const nodeIds = new Set(workspaceNodes.map(n => n.id));
        const edges: GraphQueryResult["edges"] = [];

        // Batch fetch edges in parallel to eliminate N+1 queries
        const nodeEdgePromises = workspaceNodes.map(node => graphSvc.getEdges(node.id, undefined as any));
        const allNodeEdgesResults = await Promise.all(nodeEdgePromises);

        for (const nodeEdges of allNodeEdgesResults) {
            for (const e of nodeEdges) {
                if (nodeIds.has(e.sourceId) && nodeIds.has(e.targetId)) {
                    edges.push({ sourceId: e.sourceId, targetId: e.targetId, relation: e.relation });
                }
            }
        }

        return {
            nodes: workspaceNodes.map(n => ({
                id: n.id,
                name: n.name,
                kind: n.label,
                filePath: (n.data as ParsedCodeNode["data"])?.filePath ?? "",
                startLine: (n.data as ParsedCodeNode["data"])?.startLine ?? 0,
            })),
            edges,
        };
    },

    /**
     * Return code health metrics for a workspace.
     * Used by checkExecutionProgress() and the Vibe Critic.
     */
    async getMetrics(slug: string): Promise<CodeMetrics> {
        const graphSvc = getGraphService();
        const prefix = resolveFingerprintPrefix(slug);

        const result = await graphSvc.searchNodes(SYSTEM_ORG as any, {
            fingerprintPrefix: prefix,
            limit: 50_000,
        });
        const nodes = result.nodes as any[];

        const parseErrors = nodes.filter((n: any) => n.label === "code_parse_error").length;
        const files = nodes.filter((n: any) => n.label === "code_file");
        const functions = nodes.filter((n: any) => n.label === "code_function");
        const classes = nodes.filter((n: any) => n.label === "code_class");
        const interfaces = nodes.filter((n: any) => n.label === "code_interface");
        const exported = functions.filter((n: any) => (n.data as ParsedCodeNode["data"])?.isExported);

        // Edge counts
        let callEdges = 0;
        let importEdges = 0;
        for (const node of nodes.slice(0, 50)) { // sample to avoid N+1 at scale
            const nodeEdges = await graphSvc.getEdges(node.id, undefined as any);
            for (const e of nodeEdges) {
                if (e.relation === "CALLS") callEdges++;
                if (e.relation === "IMPORTS") importEdges++;
            }
        }

        return {
            fileCount: files.length,
            functionCount: functions.length,
            classCount: classes.length,
            interfaceCount: interfaces.length,
            parseErrors,
            exportedFunctions: exported.length,
            callEdgeCount: callEdges,
            importEdgeCount: importEdges,
        };
    },
};

// ─── Repo indexing ────────────────────────────────────────────────────────────

/** Fingerprint namespace for nodes derived from the Oddjob repo itself. */
export const REPO_PREFIX = "repo:oddjob";

/** The repo is ~5.6k source files; the per-app default of 500 would cover ~9%. */
const REPO_FILE_LIMIT = 20_000;

const REPO_SOURCE_ROOTS = ["server", "shared", "client", "scripts"];
const REPO_SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", ".next", "build", "coverage",
    "storage", "artifacts", "external", "playwright-test-repo",
]);
const REPO_SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export interface RepoIndexResult {
    scanned: number;
    changed: number;
    skipped: number;
    failed: number;
    durationMs: number;
}

function normalizeRepoPath(filePath: string, repoRoot: string): string {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
    return path.relative(repoRoot, abs).split(path.sep).join("/");
}

export async function collectRepoFiles(repoRoot: string, limit: number = REPO_FILE_LIMIT): Promise<string[]> {
    const fsp = await import("node:fs/promises");
    const out: string[] = [];

    async function walk(dir: string): Promise<void> {
        if (out.length >= limit) return;
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= limit) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (REPO_SKIP_DIRS.has(entry.name)) continue;
                await walk(full);
            } else if (REPO_SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) {
                out.push(normalizeRepoPath(full, repoRoot));
            }
        }
    }

    for (const root of REPO_SOURCE_ROOTS) {
        await walk(path.join(repoRoot, root));
    }
    if (out.length >= limit) {
        logger.warn(`[XRay] Repo file limit ${limit} reached; index is PARTIAL.`);
    }
    return out;
}

/** Map of repo-relative path → stored content hash, from existing code_file nodes. */
async function loadRepoFileHashes(graphSvc: any): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    try {
        // Cannot filter by `label: "code_file"` — file nodes are relabelled to
        // Service/API_Route/… by the mapper. codeKind carries the structural
        // identity and every repo node stores contentHash anyway.
        const result = await graphSvc.searchNodes(SYSTEM_ORG as any, {
            fingerprintPrefix: REPO_PREFIX,
            limit: 50_000,
        });
        for (const node of (result.nodes as any[]) ?? []) {
            const data = node.data ?? {};
            if (data.filePath && data.contentHash) hashes.set(data.filePath, data.contentHash);
        }
    } catch (err: any) {
        // An empty map degrades to a full re-index, which is correct but slower.
        logger.warn(`[XRay] Could not load existing repo hashes, forcing full index: ${err.message}`);
    }
    return hashes;
}

/** Remove every node previously derived from one repo file. */
async function removeRepoFileNodes(graphSvc: any, relPath: string): Promise<void> {
    try {
        // Filtered in SQL (node_data_file_path_idx). This used to pull 50,000
        // nodes -- 23 MB -- across the wire to keep the handful matching one path.
        const result = await graphSvc.searchNodes(SYSTEM_ORG as any, {
            fingerprintPrefix: REPO_PREFIX,
            filePath: relPath,
            limit: 50_000,
        });
        const stale = (result.nodes as any[]) ?? [];
        for (const node of stale) {
            await graphSvc.deleteNode(node.id, SYSTEM_ORG as any);
        }
    } catch (err: any) {
        logger.warn(`[XRay] Failed to remove stale nodes for ${relPath}: ${err.message}`);
    }
}

/** Re-parse one repo file and upsert its nodes/edges. */
async function reindexRepoFile(
    graphSvc: any,
    repoRoot: string,
    relPath: string,
    source: string,
    contentHash: string,
): Promise<void> {
    const parsed = codeParserService.parseSource(source, relPath);

    const nodeInputs = parsed.nodes.map(n => ({
        // File-level nodes are stored under the admin UI's domain vocabulary
        // (Service / API_Route / Component / …); symbol-level nodes keep their
        // structural kind. See code-label-mapper.ts.
        label: mapCodeNodeLabel(n.kind, n.filePath, n.data),
        name: n.name,
        fingerprint: buildFingerprint(REPO_PREFIX, `${n.filePath}:${n.name}`),
        organizationId: null,
        verificationStatus: "verified" as const,
        data: {
            filePath: n.filePath,
            startLine: n.startLine,
            endLine: n.endLine,
            isExported: n.isExported,
            fingerprintPrefix: REPO_PREFIX,
            // Retain the structural kind so the mapping stays reversible and
            // callers can still ask "is this a function?" after relabelling.
            codeKind: n.kind,
            // Stored on every node so the hash survives even if the synthetic
            // code_file node is missing for some reason.
            contentHash,
            ...n.data,
        },
    }));

    // Guarantee a file-level node so the content hash is always recoverable.
    // Checked against codeKind, not label — a file node is relabelled to
    // Service/API_Route/… by the mapper, so testing `label === "code_file"`
    // would miss it and append a duplicate on every pass.
    if (!nodeInputs.some(n => n.data.codeKind === "code_file")) {
        nodeInputs.push({
            label: mapCodeNodeLabel("code_file", relPath) as any,
            name: relPath,
            fingerprint: buildFingerprint(REPO_PREFIX, `${relPath}:__file__`),
            organizationId: null,
            verificationStatus: "verified" as const,
            data: {
                filePath: relPath,
                startLine: 0,
                endLine: 0,
                isExported: false,
                fingerprintPrefix: REPO_PREFIX,
                codeKind: "code_file",
                contentHash,
            },
        });
    }

    const created = await graphSvc.createNodesBatch(nodeInputs, SYSTEM_ORG as any);

    const nameToId = new Map<string, number>();
    for (const node of created) {
        nameToId.set(`${node.data?.filePath}:${node.name}`, node.id);
        nameToId.set(node.name, node.id);
    }

    const edgeInputs: any[] = [];
    for (const edge of parsed.edges) {
        const srcId = nameToId.get(`${edge.sourceFile}:${edge.sourceName}`) ?? nameToId.get(edge.sourceName);
        const tgtId = edge.targetFile
            ? nameToId.get(`${edge.targetFile}:${edge.targetName}`) ?? nameToId.get(edge.targetName)
            : nameToId.get(edge.targetName);
        if (srcId && tgtId && srcId !== tgtId) {
            edgeInputs.push({ sourceNodeId: srcId, targetNodeId: tgtId, relation: edge.relation, weight: 5 });
        }
    }

    if (edgeInputs.length > 0) {
        await graphSvc.createEdgesBatch(edgeInputs, SYSTEM_ORG as any);
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getGraphService() {
    try {
        const pod = podRegistry.getPodSync<{
            graph: any;
        }>('knowledge');
        if (pod?.graph) return pod.graph;
    } catch {
        // Fall back to direct graphService import when running in standalone CLI scripts
    }
    return graphService;
}

export function resolveFingerprintPrefix(slug: string): string {
    if (slug === "oddjob" || slug === REPO_PREFIX) return REPO_PREFIX;
    if (slug.startsWith("repo:") || slug.startsWith("forge:") || slug.startsWith("blueprint:")) {
        return slug;
    }
    return `forge:${slug}`;
}

/**
 * Build a node fingerprint.
 *
 * `fingerprint` is validated at max 64 characters and backs the
 * (organizationId, fingerprint) unique index, so the identity string is hashed
 * rather than stored raw — `prefix:some/long/path.ts:symbolName` routinely
 * exceeds the cap and would be rejected by the validated write path.
 *
 * The prefix is retained in readable form so fingerprints remain greppable and
 * `startsWith(prefix)` scans keep working.
 */
export function buildFingerprint(prefix: string, identity: string): string {
    const digest = createHash("sha256").update(`${prefix}:${identity}`).digest("hex");
    const readable = prefix.slice(0, 20);
    return `${readable}:${digest}`.slice(0, 64);
}

async function indexPath(
    workspacePath: string,
    fingerprintPrefix: string,
    appId?: number,
    deploymentId?: number,
    fileLimit: number = DEFAULT_FILE_LIMIT,
): Promise<void> {
    const graphSvc = getGraphService();

    let parsed;
    try {
        parsed = await codeParserService.parseWorkspaceStructural(workspacePath, fileLimit);
    } catch (err: any) {
        logger.error(`[XRay] Parse failed for ${fingerprintPrefix}: ${err.message}`);
        return;
    }

    if (parsed.nodes.length === 0) {
        logger.info(`[XRay] No source files found in ${fingerprintPrefix}`);
        return;
    }

    // Build a name → DB id map for edge creation
    const nameToId = new Map<string, number>();

    // Batch-create nodes
    const nodeInputs = parsed.nodes.map(n => ({
        label: n.kind,
        name: n.name,
        fingerprint: buildFingerprint(fingerprintPrefix, `${n.filePath}:${n.name}`),
        organizationId: null,
        appId: appId || null,
        deploymentId: deploymentId || null,
        verificationStatus: "verified" as const,
        data: {
            filePath: n.filePath,
            startLine: n.startLine,
            endLine: n.endLine,
            isExported: n.isExported,
            // Exact workspace discriminator. Fingerprints are hashed, so a
            // startsWith() scan over them can no longer identify a workspace
            // (and truncating the readable prefix would let two long slugs
            // collide into each other's result sets).
            fingerprintPrefix,
            ...n.data,
        },
    }));

    let createdNodes: any[] = [];
    try {
        createdNodes = await graphSvc.createNodesBatch(nodeInputs, SYSTEM_ORG as any);
    } catch (err: any) {
        logger.error(`[XRay] Node batch insert failed: ${err.message}`);
        return;
    }

    for (const node of createdNodes) {
        const nodeData = node.data as ParsedCodeNode["data"];
        nameToId.set(`${nodeData?.filePath}:${node.name}`, node.id);
        nameToId.set(node.name, node.id); // fallback by name
    }

    // Build edges — only between nodes we successfully created
    const edgeInputs: any[] = [];
    for (const edge of parsed.edges) {
        const srcKey = `${edge.sourceFile}:${edge.sourceName}`;
        const tgtKey = edge.targetFile
            ? `${edge.targetFile}:${edge.targetName}`
            : edge.targetName;

        const srcId = nameToId.get(srcKey) ?? nameToId.get(edge.sourceName);
        const tgtId = nameToId.get(tgtKey) ?? nameToId.get(edge.targetName);

        if (srcId && tgtId && srcId !== tgtId) {
            edgeInputs.push({
                sourceNodeId: srcId,
                targetNodeId: tgtId,
                relation: edge.relation,
                weight: 5,
            });
        }
    }

    if (edgeInputs.length > 0) {
        try {
            await graphSvc.createEdgesBatch(edgeInputs, SYSTEM_ORG as any);
        } catch (err: any) {
            logger.warn(`[XRay] Edge batch insert partial failure: ${err.message}`);
        }
    }

    logger.info(`[XRay] ${fingerprintPrefix} → ${createdNodes.length} nodes, ${edgeInputs.length} edges indexed`);
}
