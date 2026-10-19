import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_FORGE_WORKSPACE =
    process.platform === "win32"
        ? "C:\\LocalData\\forge\\workspace"
        : path.resolve("storage/forge-workspace");

const DEFAULT_PREWARM_WORKSPACE =
    process.platform === "win32"
        ? "C:\\LocalData\\forge\\prewarm"
        : path.resolve("storage/forge-prewarm");

const DEFAULT_NM_CACHE_ROOT =
    process.platform === "win32"
        ? "C:\\LocalData\\forge\\nm-cache"
        : path.resolve("storage/forge-nm-cache");

export const FORGE_WORKSPACE_ROOT = path.resolve(process.env.FORGE_WORKSPACE || DEFAULT_FORGE_WORKSPACE);
export const LEGACY_FORGE_WORKSPACE_ROOT = path.resolve("storage/forge-workspace");
export const PREWARM_WORKSPACE_ROOT = path.resolve(process.env.FORGE_PREWARM_WORKSPACE || DEFAULT_PREWARM_WORKSPACE);
export const NM_CACHE_ROOT = path.resolve(process.env.FORGE_NM_CACHE_ROOT || DEFAULT_NM_CACHE_ROOT);

/**
 * Shared server apps that are located in the root directory instead of storage/forge-workspace
 * These are monorepo-style apps that host multiple workbenches in a single Next.js server
 */
const SHARED_SERVER_APPS = new Set(["sdlc-workbench", "budgetmaster-workbench"]);

export function isSharedServerApp(slug: string): boolean {
    return SHARED_SERVER_APPS.has(slug);
}

export function getForgeWorkspacePath(slug: string): string {
    // Shared server apps are located in the root directory
    if (isSharedServerApp(slug)) {
        return path.resolve(process.cwd(), slug);
    }
    return path.join(FORGE_WORKSPACE_ROOT, slug);
}

export async function resolveForgeWorkspacePath(slug: string): Promise<string> {
    // Shared server apps are located in the root directory
    if (isSharedServerApp(slug)) {
        const sharedPath = path.resolve(process.cwd(), slug);
        if (await exists(sharedPath)) return sharedPath;
    }

    const canonical = getForgeWorkspacePath(slug);
    if (await exists(canonical)) return canonical;

    const legacy = path.join(LEGACY_FORGE_WORKSPACE_ROOT, slug);
    if (legacy !== canonical && await exists(legacy)) return legacy;

    return canonical;
}

export function isWithinDirectory(basePath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
    return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(targetPath: string): Promise<boolean> {
    return fs.access(targetPath).then(() => true).catch(() => false);
}
