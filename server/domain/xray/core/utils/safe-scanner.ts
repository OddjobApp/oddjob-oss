/**
 * Safe File Scanner
 *
 * Enhanced recursive directory scanning with safety limits:
 * - Symlink resolution (skip if outside project root)
 * - Maximum depth tracking
 * - Maximum file count tracking
 * - Configurable skip directories and file extensions
 */

import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SafeScanner");

export interface ScanOptions {
  maxFiles?: number;
  maxDepth?: number;
  extensions?: string[];
  skipDirs?: Set<string>;
}

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  "storage",
]);

/**
 * Recursively scan a directory for source files with safety limits.
 *
 * Returns absolute file paths matching the configured extensions.
 * Gracefully handles missing directories, permission errors, symlink escape,
 * and depth/count overflow by logging warnings and returning partial results.
 */
export async function listSourceFilesSafe(
  dir: string,
  projectRoot: string,
  options?: ScanOptions
): Promise<string[]> {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const extensions = options?.extensions ?? DEFAULT_EXTENSIONS;
  const skipDirs = options?.skipDirs ?? DEFAULT_SKIP_DIRS;

  // Normalize projectRoot for consistent prefix comparison
  const normalizedRoot = path.resolve(projectRoot);

  const results: string[] = [];
  let fileCount = 0;
  let limitReached = false;

  async function scan(currentDir: string, depth: number): Promise<void> {
    if (limitReached) return;

    if (depth > maxDepth) {
      logger.warn("Max depth limit reached during file scan", {
        directory: currentDir,
        limit: maxDepth,
      });
      limitReached = true;
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err: any) {
      // ENOENT or EACCES — return gracefully
      if (err.code === "ENOENT" || err.code === "EACCES") {
        return;
      }
      // For other unexpected errors, still don't throw
      return;
    }

    for (const entry of entries) {
      if (limitReached) return;

      const entryName = entry.name;

      // Skip configured directories
      if (skipDirs.has(entryName) && entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(currentDir, entryName);

      if (entry.isSymbolicLink()) {
        // Resolve symlink and check if it's within projectRoot
        let realPath: string;
        try {
          realPath = await fs.realpath(fullPath);
        } catch {
          // Can't resolve symlink — skip it
          continue;
        }

        const normalizedReal = path.resolve(realPath);
        if (!normalizedReal.startsWith(normalizedRoot + path.sep) && normalizedReal !== normalizedRoot) {
          // Symlink points outside project root — skip
          continue;
        }

        // Check if the resolved path is a directory or file
        let stat;
        try {
          stat = await fs.stat(realPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          if (skipDirs.has(entryName)) continue;
          await scan(realPath, depth + 1);
        } else if (stat.isFile()) {
          const ext = path.extname(entryName).toLowerCase();
          if (extensions.includes(ext)) {
            if (fileCount >= maxFiles) {
              logger.warn("Max file count limit reached during file scan", {
                directory: currentDir,
                limit: maxFiles,
              });
              limitReached = true;
              return;
            }
            results.push(fullPath);
            fileCount++;
          }
        }
      } else if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entryName).toLowerCase();
        if (extensions.includes(ext)) {
          if (fileCount >= maxFiles) {
            logger.warn("Max file count limit reached during file scan", {
              directory: currentDir,
              limit: maxFiles,
            });
            limitReached = true;
            return;
          }
          results.push(fullPath);
          fileCount++;
        }
      }
    }
  }

  await scan(path.resolve(dir), 0);
  return results;
}
