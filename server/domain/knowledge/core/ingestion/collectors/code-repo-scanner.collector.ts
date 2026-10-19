/**
 * Code Repository Scanner Collector
 *
 * Implements the SourceCollector interface for GitHub/GitLab repository analysis.
 * Parses a repository URL and fetches README, package metadata (package.json,
 * Cargo.toml, etc.), and key source file summaries via the GitHub/GitLab APIs
 * or raw content URLs.
 *
 * @module ingestion/collectors/code-repo-scanner
 */

import { createLogger } from "@server/utils/logger.js";
import type { CollectorInvocation, SourceCollectorType } from "../types.js";
import type {
  CollectedContent,
  CollectorResult,
  SourceCollector,
} from "./collector.interface.js";

const logger = createLogger("CodeRepoScanner");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** GitHub API base URL */
const GITHUB_API_BASE = "https://api.github.com";

/** GitHub raw content base URL */
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/** GitLab API base URL (gitlab.com; self-hosted instances would need config) */
const GITLAB_API_BASE = "https://gitlab.com/api/v4";

/** Maximum file size we'll attempt to fetch (256 KB) */
const MAX_FILE_SIZE_BYTES = 256 * 1024;

/** Known package manifest filenames to look for */
const PACKAGE_MANIFESTS = [
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
] as const;

/** File extensions considered significant source files */
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".rb",
  ".tsx",
  ".jsx",
]);

/** Maximum number of source files to summarize */
const MAX_SOURCE_FILES = 5;

// ─── Types ─────────────────────────────────────────────────────────────────────

type RepoHost = "github" | "gitlab" | "unknown";

interface ParsedRepo {
  host: RepoHost;
  owner: string;
  repo: string;
  branch?: string;
}

interface GitHubRepoMeta {
  language: string | null;
  stargazers_count: number;
  license: { spdx_id: string } | null;
  topics: string[];
  default_branch: string;
  description: string | null;
}

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

// ─── Collector Implementation ──────────────────────────────────────────────────

export const codeRepoScannerCollector: SourceCollector = {
  type: "code_repository_scanner" as SourceCollectorType,

  async collect(invocation: CollectorInvocation): Promise<CollectorResult> {
    const startTime = new Date().toISOString();
    const timeout = invocation.timeout || 60_000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const parsed = parseRepoUrl(invocation.query);

      if (!parsed) {
        return buildResult(invocation.id, startTime, "failed", [], {
          error: `Unable to parse repository URL: ${invocation.query}`,
        });
      }

      if (parsed.host === "unknown") {
        return buildResult(invocation.id, startTime, "failed", [], {
          error: `Unsupported repository host. Only GitHub and GitLab are supported.`,
        });
      }

      logger.info("Scanning code repository", {
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo,
      });

      const content: CollectedContent[] = [];

      if (parsed.host === "github") {
        const collected = await collectFromGitHub(
          parsed,
          invocation,
          controller.signal
        );
        content.push(...collected);
      } else if (parsed.host === "gitlab") {
        const collected = await collectFromGitLab(
          parsed,
          invocation,
          controller.signal
        );
        content.push(...collected);
      }

      return buildResult(invocation.id, startTime, "completed", content);
    } catch (error: unknown) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");

      if (isAbort) {
        logger.warn("Code repository scan timed out", {
          query: invocation.query,
          timeout,
        });
        return buildResult(invocation.id, startTime, "timeout", [], {
          error: `Repository scan timed out after ${timeout}ms`,
        });
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error during repository scan";

      logger.error("Code repository scan failed", {
        query: invocation.query,
        error: errorMessage,
      });

      return buildResult(invocation.id, startTime, "failed", [], {
        error: errorMessage,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

// ─── GitHub Collection ─────────────────────────────────────────────────────────

async function collectFromGitHub(
  parsed: ParsedRepo,
  invocation: CollectorInvocation,
  signal: AbortSignal
): Promise<CollectedContent[]> {
  const content: CollectedContent[] = [];
  const { owner, repo } = parsed;

  // Fetch repository metadata
  const repoMeta = await fetchJson<GitHubRepoMeta>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
    signal
  );

  if (!repoMeta) {
    logger.warn("Failed to fetch GitHub repo metadata", { owner, repo });
    return content;
  }

  const branch = parsed.branch || repoMeta.default_branch || "main";
  const repoUrl = `https://github.com/${owner}/${repo}`;

  const metadata: Record<string, unknown> = {
    language: repoMeta.language,
    stars: repoMeta.stargazers_count,
    license: repoMeta.license?.spdx_id ?? null,
    topics: repoMeta.topics ?? [],
    defaultBranch: branch,
    description: repoMeta.description,
  };

  // Fetch README.md
  const readmeContent = await fetchRawFile(
    `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/README.md`,
    signal
  );

  if (readmeContent) {
    content.push({
      url: `${repoUrl}/blob/${branch}/README.md`,
      title: `${owner}/${repo} - README`,
      content: readmeContent,
      contentType: "text/markdown",
      sourceType: "code_repository_scanner",
      contentSize: new TextEncoder().encode(readmeContent).length,
      metadata,
    });
  }

  // Fetch package manifest
  const manifest = await fetchPackageManifest(owner, repo, branch, signal);

  if (manifest) {
    content.push({
      url: `${repoUrl}/blob/${branch}/${manifest.filename}`,
      title: `${owner}/${repo} - ${manifest.filename}`,
      content: manifest.content,
      contentType: "application/json",
      sourceType: "code_repository_scanner",
      contentSize: new TextEncoder().encode(manifest.content).length,
      metadata,
    });
  }

  // Fetch key source files via tree API
  const sourceFiles = await fetchKeySourceFiles(
    owner,
    repo,
    branch,
    signal
  );

  for (const file of sourceFiles) {
    content.push({
      url: `${repoUrl}/blob/${branch}/${file.path}`,
      title: `${owner}/${repo} - ${file.path}`,
      content: file.content,
      contentType: "text/plain",
      sourceType: "code_repository_scanner",
      contentSize: new TextEncoder().encode(file.content).length,
      metadata,
    });
  }

  logger.info("GitHub repository scan completed", {
    owner,
    repo,
    itemsCollected: content.length,
  });

  return content;
}

// ─── GitLab Collection ─────────────────────────────────────────────────────────

async function collectFromGitLab(
  parsed: ParsedRepo,
  invocation: CollectorInvocation,
  signal: AbortSignal
): Promise<CollectedContent[]> {
  const content: CollectedContent[] = [];
  const { owner, repo } = parsed;
  const projectPath = encodeURIComponent(`${owner}/${repo}`);

  // Fetch project metadata
  const projectMeta = await fetchJson<{
    star_count: number;
    default_branch: string;
    description: string | null;
    topics: string[];
  }>(`${GITLAB_API_BASE}/projects/${projectPath}`, signal);

  if (!projectMeta) {
    logger.warn("Failed to fetch GitLab project metadata", { owner, repo });
    return content;
  }

  const branch = parsed.branch || projectMeta.default_branch || "main";
  const repoUrl = `https://gitlab.com/${owner}/${repo}`;

  const metadata: Record<string, unknown> = {
    stars: projectMeta.star_count,
    topics: projectMeta.topics ?? [],
    defaultBranch: branch,
    description: projectMeta.description,
  };

  // Fetch README via GitLab file API
  const readmeContent = await fetchGitLabFile(
    projectPath,
    "README.md",
    branch,
    signal
  );

  if (readmeContent) {
    content.push({
      url: `${repoUrl}/-/blob/${branch}/README.md`,
      title: `${owner}/${repo} - README`,
      content: readmeContent,
      contentType: "text/markdown",
      sourceType: "code_repository_scanner",
      contentSize: new TextEncoder().encode(readmeContent).length,
      metadata,
    });
  }

  // Fetch package manifest
  for (const manifestName of PACKAGE_MANIFESTS) {
    const manifestContent = await fetchGitLabFile(
      projectPath,
      manifestName,
      branch,
      signal
    );
    if (manifestContent) {
      content.push({
        url: `${repoUrl}/-/blob/${branch}/${manifestName}`,
        title: `${owner}/${repo} - ${manifestName}`,
        content: manifestContent,
        contentType: "application/json",
        sourceType: "code_repository_scanner",
        contentSize: new TextEncoder().encode(manifestContent).length,
        metadata,
      });
      break; // Only include the first matching manifest
    }
  }

  logger.info("GitLab repository scan completed", {
    owner,
    repo,
    itemsCollected: content.length,
  });

  return content;
}

// ─── URL Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a repository URL into its constituent parts.
 * Supports GitHub and GitLab URL formats.
 */
function parseRepoUrl(url: string): ParsedRepo | null {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname
      .split("/")
      .filter((p) => p.length > 0);

    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    // Strip .git suffix if present
    const repo = pathParts[1].replace(/\.git$/, "");

    let host: RepoHost = "unknown";
    if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
      host = "github";
    } else if (
      parsed.hostname === "gitlab.com" ||
      parsed.hostname === "www.gitlab.com"
    ) {
      host = "gitlab";
    }

    // Extract branch from tree/blob paths: /owner/repo/tree/branch-name
    let branch: string | undefined;
    if (pathParts.length >= 4 && (pathParts[2] === "tree" || pathParts[2] === "blob")) {
      branch = pathParts[3];
    }

    return { host, owner, repo, branch };
  } catch {
    return null;
  }
}

// ─── File Fetching Helpers ─────────────────────────────────────────────────────

/**
 * Fetch a raw file from a URL and return its content as text.
 * Returns null if the file is not found or exceeds size limits.
 */
async function fetchRawFile(
  url: string,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const response = await fetch(url, { signal, redirect: "follow" });

    if (!response.ok) {
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      logger.warn("File exceeds size limit, skipping", { url });
      return null;
    }

    const text = await response.text();

    if (new TextEncoder().encode(text).length > MAX_FILE_SIZE_BYTES) {
      return text.slice(0, MAX_FILE_SIZE_BYTES);
    }

    return text;
  } catch {
    return null;
  }
}

/**
 * Fetch JSON from a URL, returning null on failure.
 */
async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Oddjob-Research-Ingestion/1.0",
    };

    const response = await fetch(url, { signal, headers, redirect: "follow" });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Attempt to fetch the first available package manifest from a GitHub repo.
 */
async function fetchPackageManifest(
  owner: string,
  repo: string,
  branch: string,
  signal: AbortSignal
): Promise<{ filename: string; content: string } | null> {
  for (const filename of PACKAGE_MANIFESTS) {
    const url = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${filename}`;
    const content = await fetchRawFile(url, signal);
    if (content) {
      return { filename, content };
    }
  }
  return null;
}

/**
 * Fetch key source files from a GitHub repository using the Git Tree API.
 * Selects significant source files based on extension and size.
 */
async function fetchKeySourceFiles(
  owner: string,
  repo: string,
  branch: string,
  signal: AbortSignal
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];

  // Fetch recursive tree
  const tree = await fetchJson<{
    tree: GitHubTreeItem[];
    truncated: boolean;
  }>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    signal
  );

  if (!tree?.tree) {
    return results;
  }

  // Filter to significant source files
  const sourceFiles = tree.tree
    .filter((item) => {
      if (item.type !== "blob") return false;
      if (!item.size || item.size > MAX_FILE_SIZE_BYTES) return false;
      const ext = getFileExtension(item.path);
      return SOURCE_EXTENSIONS.has(ext);
    })
    // Prefer root-level and src/ files; sort by path depth then size
    .sort((a, b) => {
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return (b.size ?? 0) - (a.size ?? 0);
    })
    .slice(0, MAX_SOURCE_FILES);

  // Fetch content for each selected file
  for (const file of sourceFiles) {
    const content = await fetchRawFile(
      `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${file.path}`,
      signal
    );
    if (content) {
      results.push({ path: file.path, content });
    }
  }

  return results;
}

/**
 * Fetch a file from GitLab's repository files API.
 */
async function fetchGitLabFile(
  projectPath: string,
  filePath: string,
  branch: string,
  signal: AbortSignal
): Promise<string | null> {
  const encodedFilePath = encodeURIComponent(filePath);
  const url = `${GITLAB_API_BASE}/projects/${projectPath}/repository/files/${encodedFilePath}/raw?ref=${branch}`;

  return fetchRawFile(url, signal);
}

/**
 * Extract file extension from a path (e.g., ".ts" from "src/index.ts").
 */
function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.slice(lastDot);
}

// ─── Result Builder ────────────────────────────────────────────────────────────

/**
 * Build a standardized CollectorResult.
 */
function buildResult(
  collectorId: string,
  startTime: string,
  status: CollectorResult["status"],
  content: CollectedContent[],
  options?: { error?: string }
): CollectorResult {
  const endTime = new Date().toISOString();
  const contentSize = content.reduce((sum, item) => sum + item.contentSize, 0);

  return {
    collectorId,
    status,
    startTime,
    endTime,
    content: content.length > 0 ? content : undefined,
    error: options?.error,
    contentSize,
  };
}
