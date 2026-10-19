/**
 * Module Parser — Domain module & workspace package discovery
 *
 * Discovers platform module boundaries by:
 * 1. Reading immediate subdirectories of server/domain/ as domain modules
 * 2. Resolving workspace globs from root package.json as workspace packages
 * 3. Scanning source files for cross-module import references
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { listSourceFilesSafe } from "../utils/safe-scanner.js";

const logger = createLogger("ModuleParser");

export interface ParsedModule {
  name: string;
  type: 'domain' | 'workspace';
  dirPath: string;
  group: string; // "Modules" or workspace prefix
}

/**
 * Discover domain modules by reading immediate subdirectories of the server/domain/ directory.
 *
 * Each subdirectory is treated as a domain module boundary.
 * Entries that are not directories are skipped.
 * Returns empty array if the directory cannot be read.
 */
export async function discoverDomainModules(serverDomainDir: string): Promise<ParsedModule[]> {
  try {
    const entries = await fs.readdir(serverDomainDir, { withFileTypes: true });

    const modules: ParsedModule[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      modules.push({
        name: entry.name,
        type: 'domain',
        dirPath: path.join(serverDomainDir, entry.name),
        group: 'Modules',
      });
    }

    return modules;
  } catch (err: any) {
    logger.warn("Failed to read server/domain directory for module discovery", {
      directory: serverDomainDir,
      error: err.message,
    });
    return [];
  }
}

/**
 * Discover workspace packages by reading the `workspaces` field from root package.json
 * and resolving each glob pattern to actual directories.
 *
 * Handles both array format (`"workspaces": ["packages/*"]`) and object format
 * (`"workspaces": { "packages": ["packages/*"] }`).
 *
 * Returns empty array if package.json is unreadable or has no workspaces field.
 */
export async function discoverWorkspacePackages(packageJsonPath: string): Promise<ParsedModule[]> {
  let content: string;
  try {
    content = await fs.readFile(packageJsonPath, "utf-8");
  } catch (err: any) {
    logger.warn("Failed to read package.json for workspace discovery", {
      path: packageJsonPath,
      error: err.message,
    });
    return [];
  }

  let pkg: any;
  try {
    pkg = JSON.parse(content);
  } catch (err: any) {
    logger.warn("Failed to parse package.json for workspace discovery", {
      path: packageJsonPath,
      error: err.message,
    });
    return [];
  }

  // Extract workspaces — can be string[] or { packages: string[] }
  let globs: string[];
  if (Array.isArray(pkg.workspaces)) {
    globs = pkg.workspaces;
  } else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    globs = pkg.workspaces.packages;
  } else {
    return [];
  }

  const rootDir = path.dirname(packageJsonPath);
  const modules: ParsedModule[] = [];

  for (const glob of globs) {
    // Extract the prefix directory from glob (e.g., "packages/*" → "packages")
    // We only handle simple "<prefix>/*" globs
    const globPrefix = glob.replace(/\/\*$/, "").replace(/\\\*$/, "");
    const prefixDir = path.join(rootDir, globPrefix);

    let entries;
    try {
      entries = await fs.readdir(prefixDir, { withFileTypes: true });
    } catch (err: any) {
      logger.warn("Failed to read workspace glob directory", {
        glob,
        directory: prefixDir,
        error: err.message,
      });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      modules.push({
        name: entry.name,
        type: 'workspace',
        dirPath: path.join(prefixDir, entry.name),
        group: globPrefix,
      });
    }
  }

  return modules;
}

/**
 * Detect cross-module imports within a domain module's source files.
 *
 * Scans `.ts` and `.tsx` files in the module directory using `listSourceFilesSafe`
 * for import paths that reference other domain modules, such as:
 * - `from "@domain/<other-module>/..."`
 * - `from "../../<other-module>/..."`
 * - `from "@server/domain/<other-module>/..."`
 *
 * Returns unique list of referenced module names that exist in allModuleNames.
 */
export async function detectCrossModuleImports(
  moduleDir: string,
  allModuleNames: string[]
): Promise<string[]> {
  const referenced = new Set<string>();
  const moduleNameSet = new Set(allModuleNames);

  try {
    const files = await listSourceFilesSafe(moduleDir, moduleDir, {
      extensions: [".ts", ".tsx"],
      maxDepth: 5,
    });

    for (const filePath of files) {
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      // Match import paths referencing other domain modules
      const importRegex = /from\s+["'](?:@domain\/|\.\.\/\.\.\/|.*server\/domain\/)(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const moduleName = match[1];
        if (moduleNameSet.has(moduleName)) {
          referenced.add(moduleName);
        }
      }

      // Also match @server/domain/<name> patterns (alternate import alias)
      const serverDomainRegex = /from\s+["']@server\/domain\/(\w+)/g;
      while ((match = serverDomainRegex.exec(content)) !== null) {
        const moduleName = match[1];
        if (moduleNameSet.has(moduleName)) {
          referenced.add(moduleName);
        }
      }
    }
  } catch (err: any) {
    logger.warn("Failed to scan module for cross-module imports", {
      directory: moduleDir,
      error: err.message,
    });
    return [];
  }

  // Remove self-references (the module's own name)
  const ownName = path.basename(moduleDir);
  referenced.delete(ownName);

  return Array.from(referenced);
}
