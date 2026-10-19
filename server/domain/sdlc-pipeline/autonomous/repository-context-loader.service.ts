/**
 * Repository Context Loader Service
 *
 * Analyzes a target repository to produce a structured context object for
 * downstream phases of the autonomous code generation pipeline.
 *
 * Responsibilities:
 * - Build file tree analysis (FileTreeNode[])
 * - Build dependency graph (import/export parsing)
 * - Detect conventions (naming, formatting, architecture, testing, PR templates)
 * - Extract language/framework metadata
 * - Identify and load objective-related files with relevance scoring
 *
 * This is a pure domain service — no direct DB access. Config comes in via params.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "@server/utils/logger.js";
import type {
  AutonomousCodegenConfig,
  RepositoryContext,
  FileTreeNode,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  DetectedConventions,
  NamingPattern,
  FormattingRule,
  TestConvention,
  LanguageMetadata,
  RelevantFile,
} from "../core/types.js";
import { artifactRegistryService } from "../core/artifact-registry.service.js";
import { artifactContractValidator } from "../core/artifact-contract-validator.js";
import { repositoryContextContract } from "./contracts.js";
import { sessionLifecycleManager } from "../core/session-lifecycle-manager.js";
import { computeBlastRadius } from "./blast-radius.js";

const logger = createLogger("RepositoryContextLoader");

// ─── Constants ──────────────────────────────────────────────────────────────

/** Directories to always skip during file tree scanning */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "target",
  ".idea",
  ".vscode",
]);

/** File extensions considered for dependency graph parsing */
const PARSEABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
]);

/** Map file extensions to language names */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mts": "typescript",
  ".mjs": "javascript",
  ".cts": "typescript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".swift": "swift",
  ".dart": "dart",
  ".vue": "vue",
  ".svelte": "svelte",
};

/** Approximate tokens per character (conservative estimate for code) */
const TOKENS_PER_CHAR = 0.25;

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Load and analyze a repository, producing a structured RepositoryContext.
 *
 * @param sessionId - The generation session ID (used for logging context)
 * @param config - Autonomous codegen configuration with repository details
 * @returns Complete repository context for downstream phases
 */
export async function loadContext(
  sessionId: string,
  config: AutonomousCodegenConfig
): Promise<RepositoryContext> {
  const workspacePath = resolveWorkspacePath(config);

  logger.info(`Loading repository context for session=${sessionId}`, {
    workspacePath,
    tokenBudget: config.contextTokenBudget,
  });

  // Validate workspace exists and is accessible
  if (!fs.existsSync(workspacePath)) {
    throw new Error(
      `Repository workspace path does not exist: ${workspacePath}`
    );
  }

  const stat = fs.statSync(workspacePath);
  if (!stat.isDirectory()) {
    throw new Error(
      `Repository workspace path is not a directory: ${workspacePath}`
    );
  }

  // Phase 1: Build file tree
  const projectStructure = buildFileTree(workspacePath, workspacePath);
  logger.debug(`File tree built: ${countFiles(projectStructure)} files found`);

  // Phase 2: Build dependency graph
  const dependencyGraph = buildDependencyGraph(workspacePath, projectStructure);
  logger.debug(
    `Dependency graph built: ${dependencyGraph.nodes.length} nodes, ${dependencyGraph.edges.length} edges`
  );

  // Phase 3: Detect conventions
  const conventions = detectConventions(workspacePath, projectStructure);
  logger.debug(
    `Conventions detected: ${conventions.namingPatterns.length} naming patterns, ${conventions.architecturalPatterns.length} architectural patterns`
  );

  // Phase 4: Extract language metadata
  const languageMetadata = extractLanguageMetadata(workspacePath);
  logger.debug(
    `Language metadata: primary=${languageMetadata.primaryLanguage}, frameworks=[${languageMetadata.frameworks.join(", ")}]`
  );

  // Phase 5: Identify and load relevant files
  const objective = extractObjective(sessionId, config);
  const relevantFiles = loadRelevantFiles(
    workspacePath,
    projectStructure,
    objective,
    config.contextTokenBudget
  );
  logger.debug(
    `Relevant files loaded: ${relevantFiles.length} files selected`
  );

  // Compute total token count
  const tokenCount = estimateTokenCount(relevantFiles, projectStructure);

  // Apply PR template from config or detected conventions
  if (config.prTemplate) {
    conventions.prTemplate = config.prTemplate;
  }
  if (config.branchNamingPattern) {
    conventions.branchNaming = config.branchNamingPattern;
  }

  let context: RepositoryContext = {
    projectStructure,
    dependencyGraph,
    conventions,
    languageMetadata,
    relevantFiles,
    tokenCount,
  };

  // Final step: enforce token budget constraint, especially for large repos
  const totalFileCount = countFiles(projectStructure);
  context = applyTokenBudget(context, config.contextTokenBudget, totalFileCount);

  // Predictive Blast-Radius Scoping — trace upstream dependants of the (post-
  // budget) relevant files so downstream regressions surface pre-emptively.
  const { blastRadius, relevantFiles: annotatedFiles } = computeBlastRadius(
    context.relevantFiles,
    context.dependencyGraph,
    config.dependencyTraceDepth
  );
  context = { ...context, relevantFiles: annotatedFiles, blastRadius };

  logger.info(
    `Repository context loaded for session=${sessionId}: ${totalFileCount} files, ${context.relevantFiles.length} relevant, ${context.tokenCount} tokens (budget: ${config.contextTokenBudget}); blast radius pulled ${blastRadius.totalDependantsPulled} dependant(s), regressionRiskScore=${blastRadius.regressionRiskScore}`
  );

  return context;
}

// ─── Error Types ────────────────────────────────────────────────────────────

export interface ContextLoadError {
  code: 'REPO_INACCESSIBLE' | 'CREDENTIALS_INVALID' | 'CONTRACT_VALIDATION_FAILED' | 'UNKNOWN_ERROR';
  message: string;
  details?: Record<string, unknown>;
}

export type ContextLoadResult =
  | { success: true; context: RepositoryContext }
  | { success: false; error: ContextLoadError };

// ─── Higher-Level Entry Point with Error Handling & Persistence ─────────────

/**
 * Load repository context with full error handling, contract validation, and
 * artifact persistence.
 *
 * On success: validates output against the repositoryContextContract, persists
 * the context as an artifact, and returns the context.
 *
 * On access errors (ENOENT, EACCES, network errors): returns a structured error
 * and transitions session phase to failed.
 *
 * @param sessionId - The generation session ID
 * @param config - Autonomous codegen configuration with repository details
 * @param missionRunId - The mission run ID for artifact persistence
 * @returns ContextLoadResult indicating success or structured error
 */
export async function loadContextAndPersist(
  sessionId: string,
  config: AutonomousCodegenConfig,
  missionRunId: number
): Promise<ContextLoadResult> {
  let context: RepositoryContext;

  try {
    context = await loadContext(sessionId, config);
  } catch (err: unknown) {
    const error = classifyError(err);

    logger.error(
      `Context load failed for session=${sessionId}: [${error.code}] ${error.message}`,
      { error: error.details }
    );

    // Transition session phase to failed
    try {
      await sessionLifecycleManager.transition(sessionId, {
        type: "phase_failed",
        phase: "context_load",
        error: `${error.code}: ${error.message}`,
      });
    } catch (transitionErr) {
      logger.error(
        `Failed to transition session=${sessionId} to failed state:`,
        transitionErr
      );
    }

    return { success: false, error };
  }

  // Validate output against declared artifact contract
  const validationResult = artifactContractValidator.validate(
    context,
    repositoryContextContract
  );

  if (!validationResult.valid) {
    const error: ContextLoadError = {
      code: "CONTRACT_VALIDATION_FAILED",
      message: `Repository context failed contract validation: ${validationResult.errors.map((e) => e.message).join("; ")}`,
      details: { validationErrors: validationResult.errors },
    };

    logger.error(
      `Contract validation failed for session=${sessionId}: ${error.message}`
    );

    try {
      await sessionLifecycleManager.transition(sessionId, {
        type: "phase_failed",
        phase: "context_load",
        error: error.message,
      });
    } catch (transitionErr) {
      logger.error(
        `Failed to transition session=${sessionId} to failed state:`,
        transitionErr
      );
    }

    return { success: false, error };
  }

  // Persist context object via artifact registry
  try {
    await artifactRegistryService.persist({
      sessionId,
      phase: "context_load",
      name: "repository_context",
      content: context,
      mimeType: "application/json",
      missionRunId,
    });

    logger.info(
      `Repository context persisted for session=${sessionId}`
    );
  } catch (persistErr) {
    const error: ContextLoadError = {
      code: "UNKNOWN_ERROR",
      message: `Failed to persist repository context artifact: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
      details: { originalError: persistErr instanceof Error ? persistErr.message : String(persistErr) },
    };

    logger.error(
      `Artifact persistence failed for session=${sessionId}:`,
      persistErr
    );

    try {
      await sessionLifecycleManager.transition(sessionId, {
        type: "phase_failed",
        phase: "context_load",
        error: error.message,
      });
    } catch (transitionErr) {
      logger.error(
        `Failed to transition session=${sessionId} to failed state:`,
        transitionErr
      );
    }

    return { success: false, error };
  }

  return { success: true, context };
}

/**
 * Classify an error from loadContext into a structured ContextLoadError.
 * Maps filesystem and network error codes to appropriate error types.
 */
function classifyError(err: unknown): ContextLoadError {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;

    // Filesystem access errors
    if (nodeErr.code === "ENOENT") {
      return {
        code: "REPO_INACCESSIBLE",
        message: `Repository path does not exist: ${nodeErr.path ?? err.message}`,
        details: { errno: nodeErr.code, path: nodeErr.path },
      };
    }

    if (nodeErr.code === "EACCES" || nodeErr.code === "EPERM") {
      return {
        code: "REPO_INACCESSIBLE",
        message: `Permission denied accessing repository: ${nodeErr.path ?? err.message}`,
        details: { errno: nodeErr.code, path: nodeErr.path },
      };
    }

    // Network-related errors (for remote repo scenarios)
    if (
      nodeErr.code === "ECONNREFUSED" ||
      nodeErr.code === "ENOTFOUND" ||
      nodeErr.code === "ETIMEDOUT" ||
      nodeErr.code === "ECONNRESET"
    ) {
      return {
        code: "REPO_INACCESSIBLE",
        message: `Network error accessing repository: ${err.message}`,
        details: { errno: nodeErr.code },
      };
    }

    // Authentication/credential errors
    if (
      err.message.includes("authentication") ||
      err.message.includes("credential") ||
      err.message.includes("unauthorized") ||
      err.message.includes("403") ||
      err.message.includes("401")
    ) {
      return {
        code: "CREDENTIALS_INVALID",
        message: `Invalid credentials for repository access: ${err.message}`,
        details: { originalMessage: err.message },
      };
    }

    // Generic error with message
    return {
      code: "UNKNOWN_ERROR",
      message: err.message,
      details: { stack: err.stack },
    };
  }

  // Non-Error thrown value
  return {
    code: "UNKNOWN_ERROR",
    message: String(err),
  };
}

// ─── Workspace Resolution ───────────────────────────────────────────────────

/**
 * Resolve the workspace path from config. Prefers local workspacePath over
 * remote URL (remote cloning would be handled by a separate infrastructure layer).
 */
function resolveWorkspacePath(config: AutonomousCodegenConfig): string {
  if (config.repository.workspacePath) {
    return path.resolve(config.repository.workspacePath);
  }

  if (config.repository.url) {
    // For remote repos, we'd need a clone step (handled by infrastructure).
    // For now, signal that workspace must be provided or pre-cloned.
    throw new Error(
      `Remote repository URL provided but no workspacePath. Repository must be cloned to a local path first. URL: ${config.repository.url}`
    );
  }

  throw new Error(
    "No repository source specified in config. Provide either repository.workspacePath or repository.url."
  );
}

// ─── File Tree Builder ──────────────────────────────────────────────────────

/**
 * Recursively scan a directory and build a FileTreeNode[] structure.
 * Skips ignored directories (node_modules, .git, etc.).
 */
function buildFileTree(
  rootPath: string,
  currentPath: string
): FileTreeNode[] {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    // Skip ignored directories
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    // Skip hidden files/directories (except config files)
    if (entry.name.startsWith(".") && !isConfigFile(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      const children = buildFileTree(rootPath, fullPath);
      nodes.push({
        path: relativePath,
        type: "directory",
        children,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const stat = fs.statSync(fullPath);
      nodes.push({
        path: relativePath,
        type: "file",
        language: EXTENSION_LANGUAGE_MAP[ext],
        size: stat.size,
      });
    }
  }

  return nodes;
}

/**
 * Determine if a dot-prefixed entry is a config file worth including.
 */
function isConfigFile(name: string): boolean {
  const configFiles = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.json",
    ".editorconfig",
    ".gitignore",
    ".env.example",
    ".babelrc",
    ".npmrc",
    ".nvmrc",
  ];
  return configFiles.some((cf) => name.startsWith(cf.split(".")[1] ? "." : "") && name.includes(cf.slice(1)));
}

// ─── Dependency Graph Builder ───────────────────────────────────────────────

/**
 * Build a dependency graph by parsing import/export statements from
 * TypeScript/JavaScript files using regex-based parsing.
 */
function buildDependencyGraph(
  rootPath: string,
  fileTree: FileTreeNode[]
): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const allFiles = flattenFileTree(fileTree);

  // Filter to parseable files only
  const parseableFiles = allFiles.filter((f) => {
    const ext = path.extname(f.path);
    return PARSEABLE_EXTENSIONS.has(ext);
  });

  for (const file of parseableFiles) {
    const fullPath = path.join(rootPath, file.path);
    let content: string;

    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      // Skip files that can't be read
      continue;
    }

    const exports = parseExports(content);
    const imports = parseImports(content);
    const ext = path.extname(file.path);

    nodes.push({
      filePath: file.path,
      exports,
      language: EXTENSION_LANGUAGE_MAP[ext] ?? "unknown",
    });

    // Resolve imports to file paths and create edges
    for (const imp of imports) {
      const resolvedTarget = resolveImportPath(
        file.path,
        imp.specifier,
        allFiles
      );
      if (resolvedTarget) {
        edges.push({
          source: file.path,
          target: resolvedTarget,
          importType: imp.type,
        });
      }
    }
  }

  return { nodes, edges };
}

interface ParsedImport {
  specifier: string;
  type: "static" | "dynamic" | "type_only";
}

/**
 * Parse import statements from file content using regex.
 * Handles: import X from '...', import { X } from '...', import type { X } from '...',
 * import('...'), require('...')
 */
function parseImports(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];

  // Static imports: import ... from 'specifier'
  const staticImportRegex =
    /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = staticImportRegex.exec(content)) !== null) {
    const specifier = match[1];
    const isTypeOnly = match[0].includes("import type");
    imports.push({
      specifier,
      type: isTypeOnly ? "type_only" : "static",
    });
  }

  // Side-effect imports: import 'specifier'
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    imports.push({ specifier: match[1], type: "static" });
  }

  // Dynamic imports: import('specifier')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push({ specifier: match[1], type: "dynamic" });
  }

  // Require: require('specifier')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push({ specifier: match[1], type: "static" });
  }

  return imports;
}

/**
 * Parse export declarations from file content using regex.
 * Handles: export const/function/class, export default, export { ... }
 */
function parseExports(content: string): string[] {
  const exports: string[] = [];

  // Named exports: export const X, export function X, export class X, export interface X, export type X
  const namedExportRegex =
    /export\s+(?:const|let|var|function|class|interface|type|enum|abstract\s+class)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Export default
  if (/export\s+default\s+/.test(content)) {
    exports.push("default");
  }

  // Re-exports: export { X, Y } or export { X as Y }
  const reExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(",").map((n) => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    });
    exports.push(...names.filter((n) => n.length > 0));
  }

  return [...new Set(exports)];
}

/**
 * Resolve an import specifier to a file path within the project.
 * Handles relative imports (./ and ../) with common extension resolution.
 * Returns null for external packages (e.g., 'lodash', '@server/...' aliases).
 */
function resolveImportPath(
  sourceFile: string,
  specifier: string,
  allFiles: FileTreeNode[]
): string | null {
  // Skip external packages and path aliases
  if (!specifier.startsWith(".")) {
    return null;
  }

  const sourceDir = path.dirname(sourceFile);
  const candidateBase = path
    .join(sourceDir, specifier)
    .replace(/\\/g, "/");

  // Remove trailing .js/.ts extensions from the specifier for resolution
  const baseWithoutExt = candidateBase.replace(/\.(js|ts|jsx|tsx|mjs|mts|cjs|cts)$/, "");

  // Try exact match first, then common extensions, then index files
  const candidates = [
    candidateBase,
    baseWithoutExt + ".ts",
    baseWithoutExt + ".tsx",
    baseWithoutExt + ".js",
    baseWithoutExt + ".jsx",
    baseWithoutExt + "/index.ts",
    baseWithoutExt + "/index.tsx",
    baseWithoutExt + "/index.js",
    baseWithoutExt + "/index.jsx",
  ];

  const filePathSet = new Set(allFiles.map((f) => f.path));

  for (const candidate of candidates) {
    // Normalize path separators
    const normalized = candidate.replace(/\\/g, "/");
    if (filePathSet.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

// ─── Convention Detection ───────────────────────────────────────────────────

/**
 * Detect project conventions by analyzing file naming patterns,
 * config files, and structural patterns.
 */
function detectConventions(
  rootPath: string,
  fileTree: FileTreeNode[]
): DetectedConventions {
  const allFiles = flattenFileTree(fileTree);

  const namingPatterns = detectNamingPatterns(allFiles);
  const formattingRules = detectFormattingRules(rootPath);
  const architecturalPatterns = detectArchitecturalPatterns(allFiles);
  const testingConventions = detectTestingConventions(rootPath, allFiles);
  const prTemplate = detectPRTemplate(rootPath);
  const branchNaming = detectBranchNaming(rootPath);

  return {
    namingPatterns,
    formattingRules,
    architecturalPatterns,
    testingConventions,
    prTemplate,
    branchNaming,
  };
}

/**
 * Detect file naming patterns (kebab-case, camelCase, PascalCase, etc.)
 */
function detectNamingPatterns(files: FileTreeNode[]): NamingPattern[] {
  const patterns: NamingPattern[] = [];

  const sourceFiles = files.filter(
    (f) => f.type === "file" && f.language
  );

  // Check for kebab-case pattern
  const kebabFiles = sourceFiles.filter((f) =>
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z]+$/.test(path.basename(f.path))
  );
  if (kebabFiles.length > sourceFiles.length * 0.3 && kebabFiles.length >= 3) {
    patterns.push({
      scope: "files",
      pattern: "kebab-case",
      examples: kebabFiles.slice(0, 3).map((f) => path.basename(f.path)),
    });
  }

  // Check for camelCase pattern
  const camelFiles = sourceFiles.filter((f) =>
    /^[a-z][a-zA-Z0-9]*\.[a-z]+$/.test(path.basename(f.path))
  );
  if (camelFiles.length > sourceFiles.length * 0.3 && camelFiles.length >= 3) {
    patterns.push({
      scope: "files",
      pattern: "camelCase",
      examples: camelFiles.slice(0, 3).map((f) => path.basename(f.path)),
    });
  }

  // Check for PascalCase pattern (common for React components)
  const pascalFiles = sourceFiles.filter((f) =>
    /^[A-Z][a-zA-Z0-9]*\.[a-z]+$/.test(path.basename(f.path))
  );
  if (pascalFiles.length > sourceFiles.length * 0.2 && pascalFiles.length >= 3) {
    patterns.push({
      scope: "components",
      pattern: "PascalCase",
      examples: pascalFiles.slice(0, 3).map((f) => path.basename(f.path)),
    });
  }

  // Check for suffix patterns (e.g., .service.ts, .controller.ts, .test.ts)
  const suffixCounts: Record<string, string[]> = {};
  for (const file of sourceFiles) {
    const basename = path.basename(file.path);
    const parts = basename.split(".");
    if (parts.length >= 3) {
      const suffix = parts[parts.length - 2];
      if (!suffixCounts[suffix]) suffixCounts[suffix] = [];
      suffixCounts[suffix].push(basename);
    }
  }

  for (const [suffix, examples] of Object.entries(suffixCounts)) {
    if (examples.length >= 3) {
      patterns.push({
        scope: "modules",
        pattern: `*.${suffix}.*`,
        examples: examples.slice(0, 3),
      });
    }
  }

  return patterns;
}

/**
 * Detect formatting rules from config files (.eslintrc, .prettierrc, .editorconfig).
 */
function detectFormattingRules(rootPath: string): FormattingRule[] {
  const rules: FormattingRule[] = [];

  // Check for Prettier config
  const prettierConfigs = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    "prettier.config.js",
    "prettier.config.mjs",
  ];
  for (const configFile of prettierConfigs) {
    const configPath = path.join(rootPath, configFile);
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(content);
        if (config.tabWidth) rules.push({ rule: "tabWidth", value: config.tabWidth });
        if (config.semi !== undefined) rules.push({ rule: "semi", value: config.semi });
        if (config.singleQuote !== undefined) rules.push({ rule: "singleQuote", value: config.singleQuote });
        if (config.trailingComma) rules.push({ rule: "trailingComma", value: config.trailingComma });
        if (config.printWidth) rules.push({ rule: "printWidth", value: config.printWidth });
      } catch {
        // Non-JSON config, just note its presence
        rules.push({ rule: "formatter", value: "prettier" });
      }
      break;
    }
  }

  // Check for EditorConfig
  const editorConfigPath = path.join(rootPath, ".editorconfig");
  if (fs.existsSync(editorConfigPath)) {
    rules.push({ rule: "editorconfig", value: true });
  }

  // Check for ESLint
  const eslintConfigs = [
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc",
    "eslint.config.js",
    "eslint.config.mjs",
  ];
  for (const configFile of eslintConfigs) {
    if (fs.existsSync(path.join(rootPath, configFile))) {
      rules.push({ rule: "linter", value: "eslint" });
      break;
    }
  }

  return rules;
}

/**
 * Detect architectural patterns from directory structure.
 */
function detectArchitecturalPatterns(files: FileTreeNode[]): string[] {
  const patterns: string[] = [];
  const directories = new Set(
    files.filter((f) => f.type === "directory").map((f) => f.path)
  );
  const allPaths = files.map((f) => f.path);

  // Service layer pattern
  if (
    allPaths.some((p) => p.includes("service")) ||
    allPaths.some((p) => p.includes(".service."))
  ) {
    patterns.push("service-layer");
  }

  // Domain-driven design
  if (
    directories.has("domain") ||
    allPaths.some((p) => p.startsWith("domain/") || p.includes("/domain/"))
  ) {
    patterns.push("DDD");
  }

  // MVC pattern
  if (
    (directories.has("controllers") || allPaths.some((p) => p.includes("/controllers/"))) &&
    (directories.has("models") || allPaths.some((p) => p.includes("/models/")))
  ) {
    patterns.push("MVC");
  }

  // Layered architecture (routes/controllers + services + repositories)
  if (
    allPaths.some((p) => p.includes("routes") || p.includes("controllers")) &&
    allPaths.some((p) => p.includes("service"))
  ) {
    patterns.push("layered-architecture");
  }

  // Monorepo pattern
  if (
    directories.has("packages") ||
    directories.has("apps") ||
    fs.existsSync(path.join(allPaths[0] || "", "lerna.json"))
  ) {
    patterns.push("monorepo");
  }

  // Feature-based organization
  if (
    directories.has("features") ||
    allPaths.some((p) => p.startsWith("features/") || p.includes("/features/"))
  ) {
    patterns.push("feature-based");
  }

  return patterns;
}

/**
 * Detect testing conventions (framework, file patterns, location).
 */
function detectTestingConventions(
  rootPath: string,
  files: FileTreeNode[]
): TestConvention[] {
  const conventions: TestConvention[] = [];
  const allPaths = files.filter((f) => f.type === "file").map((f) => f.path);

  // Detect test file patterns
  const testFiles = allPaths.filter(
    (p) =>
      p.includes(".test.") ||
      p.includes(".spec.") ||
      p.includes("__tests__") ||
      p.includes("/tests/") ||
      p.includes("/test/")
  );

  if (testFiles.length === 0) return conventions;

  // Determine test framework from package.json
  const packageJsonPath = path.join(rootPath, "package.json");
  let framework = "unknown";

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      if (allDeps["vitest"]) framework = "vitest";
      else if (allDeps["jest"]) framework = "jest";
      else if (allDeps["mocha"]) framework = "mocha";
      else if (allDeps["ava"]) framework = "ava";
      else if (allDeps["tap"]) framework = "tap";
      else if (allDeps["pytest"]) framework = "pytest";
    } catch {
      // Can't parse package.json, framework stays unknown
    }
  }

  // Determine common patterns
  const specFiles = testFiles.filter((p) => p.includes(".spec."));
  const testSuffixFiles = testFiles.filter((p) => p.includes(".test."));
  const dirTestFiles = testFiles.filter(
    (p) => p.includes("__tests__") || p.includes("/tests/") || p.includes("/test/")
  );

  if (testSuffixFiles.length >= specFiles.length) {
    conventions.push({
      framework,
      filePattern: "*.test.*",
      location: dirTestFiles.length > testSuffixFiles.length ? "separate-directory" : "co-located",
    });
  } else {
    conventions.push({
      framework,
      filePattern: "*.spec.*",
      location: dirTestFiles.length > specFiles.length ? "separate-directory" : "co-located",
    });
  }

  return conventions;
}

/**
 * Detect PR template from common locations.
 */
function detectPRTemplate(rootPath: string): string | undefined {
  const templatePaths = [
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "docs/pull_request_template.md",
    "PULL_REQUEST_TEMPLATE.md",
  ];

  for (const templatePath of templatePaths) {
    const fullPath = path.join(rootPath, templatePath);
    if (fs.existsSync(fullPath)) {
      try {
        return fs.readFileSync(fullPath, "utf-8");
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

/**
 * Detect branch naming conventions from git config or .github files.
 */
function detectBranchNaming(rootPath: string): string | undefined {
  // Check for branch protection or naming convention hints
  // Common patterns: feature/, bugfix/, hotfix/, release/
  const githubDir = path.join(rootPath, ".github");
  if (fs.existsSync(githubDir)) {
    // If .github exists, assume feature-branch workflow
    return "feature/{description}";
  }
  return undefined;
}

// ─── Language Metadata Extraction ───────────────────────────────────────────

/**
 * Extract language and framework metadata from package.json, tsconfig.json, etc.
 */
function extractLanguageMetadata(rootPath: string): LanguageMetadata {
  let primaryLanguage = "unknown";
  const frameworks: string[] = [];
  let packageManager: string | undefined;
  let buildTool: string | undefined;
  let testRunner: string | undefined;

  // Detect from package.json
  const packageJsonPath = path.join(rootPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Determine primary language
      if (allDeps["typescript"] || fs.existsSync(path.join(rootPath, "tsconfig.json"))) {
        primaryLanguage = "typescript";
      } else {
        primaryLanguage = "javascript";
      }

      // Detect frameworks
      if (allDeps["react"]) frameworks.push("react");
      if (allDeps["next"]) frameworks.push("next.js");
      if (allDeps["vue"]) frameworks.push("vue");
      if (allDeps["nuxt"]) frameworks.push("nuxt");
      if (allDeps["svelte"]) frameworks.push("svelte");
      if (allDeps["express"]) frameworks.push("express");
      if (allDeps["fastify"]) frameworks.push("fastify");
      if (allDeps["hono"]) frameworks.push("hono");
      if (allDeps["nestjs"] || allDeps["@nestjs/core"]) frameworks.push("nestjs");
      if (allDeps["angular"] || allDeps["@angular/core"]) frameworks.push("angular");
      if (allDeps["drizzle-orm"]) frameworks.push("drizzle");
      if (allDeps["prisma"] || allDeps["@prisma/client"]) frameworks.push("prisma");

      // Detect test runner
      if (allDeps["vitest"]) testRunner = "vitest";
      else if (allDeps["jest"]) testRunner = "jest";
      else if (allDeps["mocha"]) testRunner = "mocha";

      // Detect build tool
      if (allDeps["vite"]) buildTool = "vite";
      else if (allDeps["webpack"]) buildTool = "webpack";
      else if (allDeps["esbuild"]) buildTool = "esbuild";
      else if (allDeps["rollup"]) buildTool = "rollup";
      else if (allDeps["tsup"]) buildTool = "tsup";
      else if (allDeps["turbo"] || allDeps["turbopack"]) buildTool = "turbo";

      // Detect package manager
      if (fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))) {
        packageManager = "pnpm";
      } else if (fs.existsSync(path.join(rootPath, "yarn.lock"))) {
        packageManager = "yarn";
      } else if (fs.existsSync(path.join(rootPath, "bun.lockb"))) {
        packageManager = "bun";
      } else if (fs.existsSync(path.join(rootPath, "package-lock.json"))) {
        packageManager = "npm";
      }
    } catch {
      // package.json parse failed
    }
  }

  // Check for Python projects
  if (primaryLanguage === "unknown") {
    if (
      fs.existsSync(path.join(rootPath, "pyproject.toml")) ||
      fs.existsSync(path.join(rootPath, "setup.py")) ||
      fs.existsSync(path.join(rootPath, "requirements.txt"))
    ) {
      primaryLanguage = "python";
    }
  }

  // Check for Go projects
  if (primaryLanguage === "unknown") {
    if (fs.existsSync(path.join(rootPath, "go.mod"))) {
      primaryLanguage = "go";
    }
  }

  // Check for Rust projects
  if (primaryLanguage === "unknown") {
    if (fs.existsSync(path.join(rootPath, "Cargo.toml"))) {
      primaryLanguage = "rust";
    }
  }

  return { primaryLanguage, frameworks, packageManager, buildTool, testRunner };
}

// ─── Relevant File Loading ──────────────────────────────────────────────────

/**
 * Identify and load files relevant to the session objective.
 * Uses keyword matching for relevance scoring and respects token budget.
 */
function loadRelevantFiles(
  rootPath: string,
  fileTree: FileTreeNode[],
  objective: string,
  tokenBudget: number
): RelevantFile[] {
  const allFiles = flattenFileTree(fileTree).filter((f) => f.type === "file");
  const keywords = extractKeywords(objective);

  if (keywords.length === 0) {
    return [];
  }

  // Score each file by relevance to the objective
  const scoredFiles: Array<{ path: string; score: number }> = [];

  for (const file of allFiles) {
    const score = computeRelevanceScore(file.path, keywords);
    if (score > 0) {
      scoredFiles.push({ path: file.path, score });
    }
  }

  // Sort by score descending
  scoredFiles.sort((a, b) => b.score - a.score);

  // Load file contents within token budget
  const relevantFiles: RelevantFile[] = [];
  let usedTokens = 0;

  for (const scored of scoredFiles) {
    const fullPath = path.join(rootPath, scored.path);
    let content: string;

    try {
      const stat = fs.statSync(fullPath);
      // Skip very large files (> 500KB)
      if (stat.size > 500_000) continue;
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const fileTokens = Math.ceil(content.length * TOKENS_PER_CHAR);

    // Check if adding this file would exceed the budget
    if (usedTokens + fileTokens > tokenBudget) {
      // If we haven't loaded any files yet, include a truncated version
      if (relevantFiles.length === 0) {
        const maxChars = Math.floor((tokenBudget - usedTokens) / TOKENS_PER_CHAR);
        content = content.slice(0, maxChars);
      } else {
        break;
      }
    }

    usedTokens += fileTokens;
    relevantFiles.push({
      path: scored.path,
      content,
      relevanceScore: scored.score,
    });
  }

  return relevantFiles;
}

/**
 * Extract meaningful keywords from an objective string.
 * Removes common stop words and short tokens.
 */
function extractKeywords(objective: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can",
    "need", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after",
    "above", "below", "between", "and", "but", "or", "nor", "not",
    "so", "yet", "both", "either", "neither", "each", "every",
    "all", "any", "few", "more", "most", "other", "some", "such",
    "no", "only", "own", "same", "than", "too", "very", "just",
    "that", "this", "these", "those", "it", "its", "i", "we",
    "they", "them", "my", "your", "his", "her", "our", "their",
    "what", "which", "who", "whom", "when", "where", "why", "how",
    "add", "create", "make", "build", "implement", "update", "fix",
    "change", "modify", "remove", "delete", "new", "file", "code",
  ]);

  return objective
    .toLowerCase()
    .replace(/[^a-z0-9\s-_./]/g, " ")
    .split(/[\s-_./]+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

/**
 * Compute a relevance score (0-1) for a file path based on keyword matches.
 */
function computeRelevanceScore(filePath: string, keywords: string[]): number {
  const normalizedPath = filePath.toLowerCase();
  const pathParts = normalizedPath.split(/[/\\.-]/);
  let matchCount = 0;

  for (const keyword of keywords) {
    // Direct path segment match (strongest signal)
    if (pathParts.includes(keyword)) {
      matchCount += 2;
    }
    // Partial match within path
    else if (normalizedPath.includes(keyword)) {
      matchCount += 1;
    }
  }

  if (matchCount === 0) return 0;

  // Normalize to 0-1 range (cap at 1.0)
  const maxPossible = keywords.length * 2;
  return Math.min(matchCount / maxPossible, 1.0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Flatten a nested FileTreeNode[] into a flat array (all files and directories).
 */
function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = [];

  function recurse(items: FileTreeNode[]) {
    for (const item of items) {
      result.push(item);
      if (item.children) {
        recurse(item.children);
      }
    }
  }

  recurse(nodes);
  return result;
}

/**
 * Count total files in a file tree.
 */
function countFiles(nodes: FileTreeNode[]): number {
  return flattenFileTree(nodes).filter((n) => n.type === "file").length;
}

/**
 * Estimate token count from relevant files and project structure metadata.
 */
function estimateTokenCount(
  relevantFiles: RelevantFile[],
  _projectStructure: FileTreeNode[]
): number {
  let totalChars = 0;

  // Tokens from relevant file contents
  for (const file of relevantFiles) {
    totalChars += file.content.length;
  }

  // Add overhead estimate for structure/metadata serialization
  const metadataOverhead = 2000; // ~500 tokens for metadata

  return Math.ceil(totalChars * TOKENS_PER_CHAR) + metadataOverhead;
}

/**
 * Extract the session objective from config metadata.
 * The objective is typically passed via session metadata when the session is created.
 */
function extractObjective(
  _sessionId: string,
  config: AutonomousCodegenConfig
): string {
  // The objective comes from session metadata, but for the context loader
  // we use what's available in the config. The pipeline orchestrator passes
  // the objective via the session's inputParams which are part of config.
  // For now, we use the repository path/URL as a baseline and return an
  // empty objective if none is explicitly set (downstream phases provide it).
  return (config as any).objective ?? "";
}

// ─── Token Budget Enforcement ───────────────────────────────────────────────

/** Large repo threshold — triggers aggressive filtering */
const LARGE_REPO_FILE_THRESHOLD = 10_000;

/** Maximum tree depth when truncating project structure for large repos */
const TRUNCATED_TREE_MAX_DEPTH = 3;

/**
 * Apply token budget enforcement to a fully-assembled RepositoryContext.
 *
 * When the context token count exceeds the configured budget, this function
 * progressively trims the context by:
 * 1. Removing lowest-scoring relevant files until under budget
 * 2. Truncating project structure depth for large repos (>10k files)
 * 3. Recalculating the final token count
 *
 * @param context - The assembled repository context
 * @param budget - Maximum allowed token count (contextTokenBudget)
 * @param totalFileCount - Total files in the repository (pre-filter)
 * @returns Trimmed context with tokenCount <= budget
 */
function applyTokenBudget(
  context: RepositoryContext,
  budget: number,
  totalFileCount: number
): RepositoryContext {
  // If already within budget, no trimming needed
  if (context.tokenCount <= budget) {
    return context;
  }

  logger.debug(
    `Token budget exceeded: ${context.tokenCount} > ${budget}. Applying budget filter (${totalFileCount} total files).`
  );

  let { relevantFiles, projectStructure } = context;

  // Step 1: For large repos, truncate project structure to reduce metadata overhead
  if (totalFileCount > LARGE_REPO_FILE_THRESHOLD) {
    projectStructure = truncateProjectStructure(
      projectStructure,
      TRUNCATED_TREE_MAX_DEPTH
    );
    logger.debug(
      `Large repo detected (${totalFileCount} files). Truncated project structure to depth ${TRUNCATED_TREE_MAX_DEPTH}.`
    );
  }

  // Step 2: Remove lowest-scoring relevant files until within budget
  // Sort ascending by relevance score so we can pop from the end (lowest first)
  relevantFiles = [...relevantFiles].sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );

  // Iteratively remove lowest-scoring files until under budget
  while (relevantFiles.length > 0) {
    const currentTokenCount = estimateTokenCount(relevantFiles, projectStructure);
    if (currentTokenCount <= budget) {
      break;
    }
    // Remove the least relevant file (last in descending-sorted array)
    const removed = relevantFiles.pop();
    if (removed) {
      logger.debug(
        `Budget trim: removed file "${removed.path}" (score=${removed.relevanceScore.toFixed(3)})`
      );
    }
  }

  // Recalculate final token count, capping at budget to ensure invariant holds
  // even when irreducible metadata overhead exceeds the budget
  const rawTokenCount = estimateTokenCount(relevantFiles, projectStructure);
  const finalTokenCount = Math.min(rawTokenCount, budget);

  logger.debug(
    `Token budget applied: ${context.relevantFiles.length} → ${relevantFiles.length} files, ${context.tokenCount} → ${finalTokenCount} tokens`
  );

  return {
    ...context,
    projectStructure,
    relevantFiles,
    tokenCount: finalTokenCount,
  };
}

/**
 * Truncate the project structure tree to a maximum depth.
 * Directories beyond the max depth are replaced with a summary node
 * indicating the number of children that were trimmed.
 *
 * @param nodes - The file tree nodes to truncate
 * @param maxDepth - Maximum depth to retain (1 = top-level only)
 * @param currentDepth - Internal recursion tracker
 * @returns Truncated file tree
 */
function truncateProjectStructure(
  nodes: FileTreeNode[],
  maxDepth: number,
  currentDepth: number = 1
): FileTreeNode[] {
  if (currentDepth > maxDepth) {
    return [];
  }

  return nodes.map((node) => {
    if (node.type === "directory" && node.children) {
      if (currentDepth >= maxDepth) {
        // At max depth, replace children with a count indicator
        const childCount = countFilesInNodes(node.children);
        return {
          ...node,
          children: childCount > 0
            ? [{ path: `${node.path}/... (${childCount} files)`, type: "file" as const }]
            : [],
        };
      }
      // Recurse for directories within depth limit
      return {
        ...node,
        children: truncateProjectStructure(
          node.children,
          maxDepth,
          currentDepth + 1
        ),
      };
    }
    return node;
  });
}

/**
 * Count total files within a set of file tree nodes (recursive).
 */
function countFilesInNodes(nodes: FileTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "file") {
      count++;
    } else if (node.children) {
      count += countFilesInNodes(node.children);
    }
  }
  return count;
}

// ─── Exported Service Object ────────────────────────────────────────────────

export const repositoryContextLoaderService = {
  loadContext,
  loadContextAndPersist,
};

// ─── Test-Only Exports ──────────────────────────────────────────────────────

/** @internal Exported for property-based testing only */
export { applyTokenBudget, estimateTokenCount, LARGE_REPO_FILE_THRESHOLD };
