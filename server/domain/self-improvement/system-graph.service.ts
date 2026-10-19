import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SystemGraphService");

export interface ChangeImpactAssessment {
  /** 0..1. Consumers gate on this; see ProposalValidationService. */
  riskScore: number;
  /** Repo-relative paths that transitively import the changed file. */
  affectedNodes: string[];
  /** Files that import the changed file directly. */
  directDependents: number;
  /** Total distinct dependents across all traversed depths. */
  transitiveDependents: number;
  /** Human-readable justification for the score. */
  reason: string;
  /**
   * Exported symbols defined in the changed file, from the AST index when it is
   * populated. Empty when the index has not been built — the score never
   * depends on this, it is added detail only.
   */
  affectedSymbols?: Array<{ name: string; kind: string }>;
  /** Depths at which transitive dependents were discovered. */
  depthBreakdown?: Record<number, string[]>;
}

export interface SystemGraphNode {
  id: string;
  label: string;
  category: "server" | "client" | "shared" | "scripts" | "other";
  directDependents: number;
  transitiveDependents: number;
  isHighLeverage: boolean;
  leverageReason?: string;
}

export interface SystemGraphEdge {
  source: string;
  target: string;
}

export interface SystemGraphTopology {
  nodes: SystemGraphNode[];
  edges: SystemGraphEdge[];
  stats: {
    totalFiles: number;
    totalEdges: number;
    highLeverageFiles: number;
    builtAt: number;
    buildDurationMs?: number;
  };
}

/** Source trees that participate in the dependency graph. */
const SOURCE_ROOTS = ["server", "shared", "client", "scripts"];

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage",
  "storage", "artifacts", "external", "playwright-test-repo",
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Fraction of the source tree that must be transitively reachable before the
 * topology term of the risk score saturates.
 */
const TOPOLOGY_SATURATION_REACH = 0.25;

/**
 * tsconfig `compilerOptions.paths`, longest-prefix-first so that `@domain/`
 * is matched before `@d`. Kept in sync with tsconfig.json manually — a
 * mismatch degrades resolution to "unresolved", never to a wrong file.
 */
const PATH_ALIASES: Array<[string, string]> = [
  ["@oddjob/shared-utils/", "packages/shared-utils/src/"],
  ["@domain-ui/", "server/domain/"],
  ["@domain/", "server/domain/"],
  ["@shared/", "shared/"],
  ["@server/", "server/"],
  ["@/", "client/src/"],
];

/**
 * Files whose blast radius is structurally larger than their dependent count
 * suggests — editing them can break callers that never import them by name.
 */
const HIGH_LEVERAGE_PATTERNS: Array<[RegExp, string]> = [
  [/(^|\/)database_service\.ts$/, "database connection singleton"],
  [/(^|\/)shared\/schema\//, "database schema"],
  [/\.route\.ts$/, "HTTP route surface"],
  [/(^|\/)security\.service\.ts$/, "authentication/authorization"],
  [/(^|\/)auth-context\.ts$/, "tenant isolation"],
  [/(^|\/)index\.ts$/, "barrel export"],
  [/(^|\/)server\/routes\.ts$/, "route registration"],
];

/** Matches static imports, re-exports, dynamic import(), and require(). */
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

interface DependencyIndex {
  /** Every source file discovered under SOURCE_ROOTS. */
  files: Set<string>;
  /** importer (repo-relative, posix) → resolved targets (repo-relative, posix) */
  forward: Map<string, Set<string>>;
  /** target → importers */
  reverse: Map<string, Set<string>>;
  builtAt: number;
  buildDurationMs?: number;
}

// Keyed by repoRoot: the same process may assess changes against different
// trees (repo vs. a sandboxed checkout), and a shared slot would serve one
// tree's graph for another's query.
const indexCache = new Map<string, DependencyIndex>();
const inFlightByRoot = new Map<string, Promise<DependencyIndex>>();
const INDEX_TTL_MS = 60_000;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

async function collectSourceFiles(root: string, repoRoot: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await collectSourceFiles(full, repoRoot, out);
    } else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(toPosix(path.relative(repoRoot, full)));
    }
  }
}

/**
 * Resolve an import specifier to a repo-relative source path.
 *
 * TypeScript ESM imports name the *emitted* `.js` file, so `./foo.js` has to be
 * probed as `./foo.ts` too. Returns null for bare package specifiers.
 */
function resolveSpecifier(
  specifier: string,
  importer: string,
  fileSet: Set<string>,
): string | null {
  let base: string | null = null;

  if (specifier.startsWith(".")) {
    base = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier)));
  } else {
    for (const [alias, target] of PATH_ALIASES) {
      if (specifier.startsWith(alias)) {
        base = target + specifier.slice(alias.length);
        break;
      }
    }
  }
  if (!base) return null; // bare package import — not part of the internal graph

  const withoutExt = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  const candidates = [
    base,
    `${withoutExt}.ts`,
    `${withoutExt}.tsx`,
    `${withoutExt}.js`,
    `${withoutExt}/index.ts`,
    `${withoutExt}/index.tsx`,
    `${withoutExt}/index.js`,
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

async function buildIndex(repoRoot: string): Promise<DependencyIndex> {
  const started = Date.now();
  const files: string[] = [];
  for (const rootName of SOURCE_ROOTS) {
    await collectSourceFiles(path.join(repoRoot, rootName), repoRoot, files);
  }
  const fileSet = new Set(files);

  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();

  await Promise.all(
    files.map(async (rel) => {
      let source: string;
      try {
        source = await fs.readFile(path.join(repoRoot, rel), "utf-8");
      } catch {
        return;
      }
      const targets = new Set<string>();
      for (const match of source.matchAll(SPECIFIER_RE)) {
        const resolved = resolveSpecifier(match[1], rel, fileSet);
        if (resolved && resolved !== rel) targets.add(resolved);
      }
      if (targets.size > 0) forward.set(rel, targets);
      for (const target of targets) {
        let importers = reverse.get(target);
        if (!importers) reverse.set(target, (importers = new Set()));
        importers.add(rel);
      }
    }),
  );

  const buildDurationMs = Date.now() - started;
  logger.info(
    `Built dependency index: ${files.length} files, ${reverse.size} imported targets in ${buildDurationMs}ms`,
  );
  return { files: fileSet, forward, reverse, builtAt: Date.now(), buildDurationMs };
}

async function getIndex(repoRoot: string): Promise<DependencyIndex> {
  const cached = indexCache.get(repoRoot);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;

  // Collapse concurrent callers onto one build — validateProposal can fan out.
  const existing = inFlightByRoot.get(repoRoot);
  if (existing) return existing;

  const build = buildIndex(repoRoot)
    .then((index) => {
      indexCache.set(repoRoot, index);
      return index;
    })
    .finally(() => {
      inFlightByRoot.delete(repoRoot);
    });
  inFlightByRoot.set(repoRoot, build);
  return build;
}

/**
 * Normalize an arbitrary caller-supplied path (absolute, backslashed, or
 * `./`-prefixed) to the repo-relative posix form used by the index.
 */
function normalizeTarget(filePath: string, repoRoot: string): string {
  const posix = toPosix(filePath).replace(/^\.\//, "");
  if (path.isAbsolute(filePath)) {
    return toPosix(path.relative(repoRoot, filePath));
  }
  return posix;
}

/**
 * Look up the symbols the AST index recorded for a file.
 *
 * Strictly supplementary: the risk score is computed from the filesystem walk
 * above and never consults this. If the code graph has not been indexed, or the
 * knowledge pod is not registered in this process, callers get an empty list
 * rather than a failed assessment — a stale indexer must not be able to break
 * the safety gate.
 */
async function lookupSymbols(
  target: string,
): Promise<Array<{ name: string; kind: string }>> {
  try {
    const { podRegistry } = await import("@domain/core/infrastructure/pod-registry.service.js");
    const graph = podRegistry.getPodSync<{ graph: { searchNodes: Function } }>("knowledge")?.graph;
    if (!graph) return [];

    const result = await graph.searchNodes(
      { organizationId: null, isSuperAdmin: true } as any,
      { limit: 2000 },
    );

    return ((result?.nodes as any[]) ?? [])
      .filter(n =>
        n.data?.fingerprintPrefix === "repo:oddjob" &&
        n.data?.filePath === target &&
        n.data?.codeKind !== "code_file" &&
        n.data?.isExported,
      )
      .map(n => ({ name: n.name, kind: n.data?.codeKind ?? n.label }));
  } catch {
    return [];
  }
}

export class SystemGraphService {
  /** Exposed for tests; forces the next assessment to re-scan. */
  static invalidateCache(): void {
    indexCache.clear();
  }

  /**
   * Reverse-dependency closure of a file, mapped to the hop distance at which
   * each dependent was first reached.
   *
   * Distance matters to callers that decay influence with graph distance (see
   * the failure-propagation service); `assessChangeImpact` collapses it.
   *
   * Returns an empty map for a path the index does not contain — callers that
   * must distinguish "isolated" from "unknown" should consult
   * `assessChangeImpact`, which fails closed.
   */
  static async getReverseDependents(
    filePath: string,
    options: { repoRoot?: string; maxDepth?: number } = {},
  ): Promise<Map<string, number>> {
    const repoRoot = options.repoRoot ?? process.cwd();
    const maxDepth = options.maxDepth ?? 3;
    const target = normalizeTarget(filePath, repoRoot);

    let index: DependencyIndex;
    try {
      index = await getIndex(repoRoot);
    } catch {
      return new Map();
    }
    if (!index.files.has(target)) return new Map();

    const distances = new Map<string, number>();
    let frontier = [...(index.reverse.get(target) ?? [])];
    for (const node of frontier) distances.set(node, 1);

    for (let depth = 2; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const importer of index.reverse.get(node) ?? []) {
          // First visit wins, so a node keeps its shortest distance.
          if (importer !== target && !distances.has(importer)) {
            distances.set(importer, depth);
            next.push(importer);
          }
        }
      }
      frontier = next;
    }

    return distances;
  }

  /**
   * Assess the blast radius of changing a single file.
   *
   * Walks the reverse-import closure of the file to `maxDepth` and scores the
   * result. This reads the working tree directly rather than a stored graph, so
   * it stays correct without a background indexer being healthy.
   *
   * Fails CLOSED: if the file cannot be located in the dependency index the
   * score is inconclusive-but-elevated, so an unknown change is not waved
   * through by a gate that is supposed to catch exactly that case.
   */
  static async assessChangeImpact(
    proposedChange: { filePath: string },
    options: { repoRoot?: string; maxDepth?: number } = {},
  ): Promise<ChangeImpactAssessment> {
    const repoRoot = options.repoRoot ?? process.cwd();
    const maxDepth = options.maxDepth ?? 3;
    const target = normalizeTarget(proposedChange.filePath, repoRoot);

    logger.info(`Assessing change impact for ${target}...`);

    let index: DependencyIndex;
    try {
      index = await getIndex(repoRoot);
    } catch (error: any) {
      logger.error(`Dependency index build failed: ${error.message}`);
      return {
        riskScore: 0.8,
        affectedNodes: [],
        directDependents: 0,
        transitiveDependents: 0,
        reason: `Could not build dependency index (${error.message}); treating change as high risk.`,
      };
    }

    // Existence is decided by the file set, not by edge membership: a real file
    // that neither imports nor is imported is genuinely isolated (low risk), and
    // must not be conflated with a path we could not find at all.
    if (!index.files.has(target)) {
      return {
        riskScore: 0.75,
        affectedNodes: [],
        directDependents: 0,
        transitiveDependents: 0,
        reason: `${target} is not present in the dependency index — it may be a new file, outside the scanned source roots, or an incorrect path. Cannot bound the blast radius.`,
      };
    }

    // Breadth-first walk over reverse edges.
    const direct = index.reverse.get(target) ?? new Set<string>();
    const seen = new Set<string>([target]);
    const depthBreakdown: Record<number, string[]> = {};
    if (direct.size > 0) {
      depthBreakdown[1] = [...direct].sort();
    }
    let frontier = [...direct];
    for (const f of frontier) seen.add(f);

    for (let depth = 2; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const importer of index.reverse.get(node) ?? []) {
          if (!seen.has(importer)) {
            seen.add(importer);
            next.push(importer);
          }
        }
      }
      if (next.length > 0) {
        depthBreakdown[depth] = [...next].sort();
      }
      frontier = next;
    }

    seen.delete(target);
    const affectedNodes = [...seen].sort();
    const directCount = direct.size;
    const transitiveCount = affectedNodes.length;

    // Score: how much of the codebase this change can reach, floored by
    // structural role.
    const totalFiles = Math.max(index.files.size, 1);
    const reach = transitiveCount / totalFiles;
    const topologyScore = Math.min(Math.sqrt(reach / TOPOLOGY_SATURATION_REACH), 1) * 0.7;

    let leverageScore = 0;
    const leverageReasons: string[] = [];
    for (const [pattern, label] of HIGH_LEVERAGE_PATTERNS) {
      if (pattern.test(target)) {
        leverageScore = Math.max(leverageScore, 0.45);
        leverageReasons.push(label);
      }
    }

    const riskScore = Math.min(1, Number((topologyScore + leverageScore).toFixed(3)));

    const reasonParts = [
      `${directCount} direct and ${transitiveCount} transitive dependents ` +
        `(${(reach * 100).toFixed(1)}% of ${totalFiles} source files, depth ${maxDepth})`,
    ];
    if (leverageReasons.length > 0) {
      reasonParts.push(`high-leverage file: ${leverageReasons.join(", ")}`);
    }

    logger.info(
      `Impact for ${target}: risk=${riskScore} direct=${directCount} transitive=${transitiveCount}`,
    );

    return {
      riskScore,
      affectedNodes,
      directDependents: directCount,
      transitiveDependents: transitiveCount,
      reason: reasonParts.join("; "),
      affectedSymbols: await lookupSymbols(target),
      depthBreakdown,
    };
  }

  /**
   * Export the complete dependency graph topology with node leverage, category,
   * and dependent counts.
   */
  static async getTopologyGraph(
    options: { repoRoot?: string; filterRoot?: string; maxNodes?: number } = {},
  ): Promise<SystemGraphTopology> {
    const repoRoot = options.repoRoot ?? process.cwd();
    const index = await getIndex(repoRoot);

    const nodes: SystemGraphNode[] = [];
    const edges: SystemGraphEdge[] = [];
    let highLeverageCount = 0;

    let targetFiles = Array.from(index.files);
    if (options.filterRoot) {
      const prefix = options.filterRoot.replace(/\/$/, "") + "/";
      targetFiles = targetFiles.filter(f => f.startsWith(prefix) || f === options.filterRoot);
    }

    if (options.maxNodes && targetFiles.length > options.maxNodes) {
      targetFiles = targetFiles.slice(0, options.maxNodes);
    }

    const filteredSet = new Set(targetFiles);

    for (const file of targetFiles) {
      const directCount = (index.reverse.get(file) ?? new Set()).size;
      const category = file.startsWith("server/")
        ? "server"
        : file.startsWith("client/")
        ? "client"
        : file.startsWith("shared/")
        ? "shared"
        : file.startsWith("scripts/")
        ? "scripts"
        : "other";

      let isHighLeverage = false;
      let leverageReason: string | undefined;
      for (const [pattern, label] of HIGH_LEVERAGE_PATTERNS) {
        if (pattern.test(file)) {
          isHighLeverage = true;
          leverageReason = label;
          highLeverageCount++;
          break;
        }
      }

      nodes.push({
        id: file,
        label: path.posix.basename(file),
        category,
        directDependents: directCount,
        transitiveDependents: directCount,
        isHighLeverage,
        leverageReason,
      });

      const targets = index.forward.get(file);
      if (targets) {
        for (const target of targets) {
          if (filteredSet.has(target)) {
            edges.push({ source: file, target });
          }
        }
      }
    }

    return {
      nodes,
      edges,
      stats: {
        totalFiles: index.files.size,
        totalEdges: edges.length,
        highLeverageFiles: highLeverageCount,
        builtAt: index.builtAt,
        buildDurationMs: index.buildDurationMs,
      },
    };
  }

  /**
   * Get dependency index statistics and health metrics.
   */
  static async getSystemStats(
    options: { repoRoot?: string } = {},
  ): Promise<{
    totalFiles: number;
    totalEdges: number;
    highLeverageCount: number;
    builtAt: number;
    cacheAgeMs: number;
    buildDurationMs?: number;
  }> {
    const repoRoot = options.repoRoot ?? process.cwd();
    const index = await getIndex(repoRoot);

    let totalEdges = 0;
    for (const targets of index.forward.values()) {
      totalEdges += targets.size;
    }

    let highLeverageCount = 0;
    for (const file of index.files) {
      for (const [pattern] of HIGH_LEVERAGE_PATTERNS) {
        if (pattern.test(file)) {
          highLeverageCount++;
          break;
        }
      }
    }

    return {
      totalFiles: index.files.size,
      totalEdges,
      highLeverageCount,
      builtAt: index.builtAt,
      cacheAgeMs: Date.now() - index.builtAt,
      buildDurationMs: index.buildDurationMs,
    };
  }
}
