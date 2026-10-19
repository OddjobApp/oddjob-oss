/**
 * Change Impact Analyzer Service
 *
 * Determines which tests and source files are affected by a set of file changes
 * using dependency graph traversal. Traces transitive dependencies up to a
 * configurable depth to identify the minimal set of tests to run.
 *
 * Fallback behavior: when no dependency graph is available, returns the full
 * test suite with `fullSuiteFallback: true` and confidence "low".
 *
 * Requirements: 7.1, 7.2, 7.3
 */

import { createLogger } from "@server/utils/logger.js";
import type { DependencyGraph, ImpactAnalysis } from "../core/types.js";

const logger = createLogger("ChangeImpactAnalyzer");

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TRACE_DEPTH = 3;

/** Patterns that identify test files */
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
];

// ─── Session Cache ──────────────────────────────────────────────────────────

/**
 * In-memory cache for dependency graph computations scoped to sessions.
 * Avoids redundant recalculation for subsequent file operations within
 * the same session (Requirement 7.4).
 */
const sessionCache = new Map<string, { adjacencyMap: Map<string, Set<string>> }>();

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Determines whether a file path matches a test file pattern.
 */
function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Builds a reverse adjacency map from the dependency graph.
 * Maps each file to the set of files that depend on it (importers).
 *
 * Given edge: source imports target
 * Reverse: target → [source, ...] (files that import target)
 *
 * This allows us to find "what is affected if target changes".
 */
function buildReverseAdjacencyMap(depGraph: DependencyGraph): Map<string, Set<string>> {
  const reverseMap = new Map<string, Set<string>>();

  // Initialize all nodes
  for (const node of depGraph.nodes) {
    if (!reverseMap.has(node.filePath)) {
      reverseMap.set(node.filePath, new Set());
    }
  }

  // Build reverse edges: target → set of sources that import it
  for (const edge of depGraph.edges) {
    if (!reverseMap.has(edge.target)) {
      reverseMap.set(edge.target, new Set());
    }
    const importers = reverseMap.get(edge.target)!;
    importers.add(edge.source);
  }

  return reverseMap;
}

/**
 * Performs BFS from the set of changed files, traversing the reverse dependency
 * graph up to `maxDepth` levels to find all transitively affected files.
 */
function traceAffectedFiles(
  changedFiles: string[],
  reverseAdjacencyMap: Map<string, Set<string>>,
  maxDepth: number
): Set<string> {
  const visited = new Set<string>();
  // Queue contains [filePath, currentDepth] pairs
  const queue: Array<[string, number]> = [];

  // Seed the BFS with all changed files at depth 0
  for (const file of changedFiles) {
    if (!visited.has(file)) {
      visited.add(file);
      queue.push([file, 0]);
    }
  }

  while (queue.length > 0) {
    const [currentFile, depth] = queue.shift()!;

    // Stop traversing beyond maxDepth
    if (depth >= maxDepth) {
      continue;
    }

    // Get all files that import the current file
    const importers = reverseAdjacencyMap.get(currentFile);
    if (!importers) {
      continue;
    }

    for (const importer of importers) {
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push([importer, depth + 1]);
      }
    }
  }

  return visited;
}

/**
 * Determines whether the dependency graph is available and usable.
 * A graph is considered unavailable if it has no nodes and no edges.
 */
function isGraphAvailable(depGraph: DependencyGraph): boolean {
  return depGraph.nodes.length > 0 || depGraph.edges.length > 0;
}

/**
 * Extracts all test file paths from the dependency graph nodes.
 */
function getAllTestFiles(depGraph: DependencyGraph): string[] {
  return depGraph.nodes
    .filter((node) => isTestFile(node.filePath))
    .map((node) => node.filePath);
}

// ─── Service Implementation ─────────────────────────────────────────────────

/**
 * Analyzes the impact of file changes to determine which tests and source
 * files are affected.
 *
 * Algorithm:
 * 1. Build a reverse adjacency map (target → importers) from the dep graph
 * 2. BFS from changed files up to traceDepth levels
 * 3. Partition results into test files and source files
 * 4. Additionally find test files that directly import any affected source file
 *
 * @param sessionId - Generation session identifier
 * @param changedFiles - Array of file paths that were changed
 * @param depGraph - Dependency graph from Repository Context Loader
 * @param traceDepth - Maximum transitive traversal depth (default: 3)
 * @returns Impact analysis with affected test and source files
 */
async function analyzeImpact(
  sessionId: string,
  changedFiles: string[],
  depGraph: DependencyGraph,
  traceDepth: number = DEFAULT_TRACE_DEPTH
): Promise<ImpactAnalysis> {
  logger.info(`Analyzing impact for session ${sessionId}`, {
    changedFileCount: changedFiles.length,
    traceDepth,
  });

  // Fallback: when dependency graph is unavailable
  if (!isGraphAvailable(depGraph)) {
    logger.warn(
      `Dependency graph unavailable for session ${sessionId}. ` +
        `Falling back to full test suite.`
    );

    const allTestFiles = getAllTestFiles(depGraph);

    return {
      affectedTestFiles: allTestFiles,
      affectedSourceFiles: changedFiles,
      traceDepth,
      confidence: "low",
      fullSuiteFallback: true,
    };
  }

  // Build or retrieve cached reverse adjacency map
  let adjacencyMap: Map<string, Set<string>>;
  const cached = sessionCache.get(sessionId);

  if (cached) {
    adjacencyMap = cached.adjacencyMap;
    logger.debug(`Using cached adjacency map for session ${sessionId}`);
  } else {
    adjacencyMap = buildReverseAdjacencyMap(depGraph);
    sessionCache.set(sessionId, { adjacencyMap });
    logger.debug(
      `Built and cached adjacency map for session ${sessionId} (${adjacencyMap.size} nodes)`
    );
  }

  // Trace all affected files via BFS
  const allAffectedFiles = traceAffectedFiles(changedFiles, adjacencyMap, traceDepth);

  // Partition into test files and source files
  const affectedTestFiles: string[] = [];
  const affectedSourceFiles: string[] = [];

  for (const file of allAffectedFiles) {
    if (isTestFile(file)) {
      affectedTestFiles.push(file);
    } else {
      affectedSourceFiles.push(file);
    }
  }

  // Determine confidence based on graph completeness
  // "high" if all changed files exist as nodes in the graph
  // "medium" if some changed files are missing from the graph
  const graphNodePaths = new Set(depGraph.nodes.map((n) => n.filePath));
  const allChangedFilesInGraph = changedFiles.every((f) => graphNodePaths.has(f));
  const confidence = allChangedFilesInGraph ? "high" : "medium";

  logger.info(`Impact analysis complete for session ${sessionId}`, {
    affectedTestCount: affectedTestFiles.length,
    affectedSourceCount: affectedSourceFiles.length,
    confidence,
  });

  return {
    affectedTestFiles,
    affectedSourceFiles,
    traceDepth,
    confidence,
    fullSuiteFallback: false,
  };
}

/**
 * Invalidates cached dependency graph computations for a session.
 * Should be called when the dependency graph changes or when a session ends.
 */
function invalidateCache(sessionId: string): void {
  const hadCache = sessionCache.delete(sessionId);
  if (hadCache) {
    logger.debug(`Invalidated impact analysis cache for session ${sessionId}`);
  }
}

// ─── Exported Service ───────────────────────────────────────────────────────

export const changeImpactAnalyzerService = {
  analyzeImpact,
  invalidateCache,
};
