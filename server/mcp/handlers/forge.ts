/**
 * Forge MCP Tool Handlers
 *
 * Exposes forge_app as an MCP tool so both rolling wave and dynamic
 * orchestrators can trigger app scaffolding from within a mission wave.
 */

import { errorResponse, type ToolContext } from "./utils.js";

interface ForgeAppArgs { blueprint: string; name: string; slug: string; description: string; systemPrompt?: string; parentAppSlug?: string; forgeDepth?: number; }
interface ForgeStatusArgs { jobId: string; }
interface ForgeSanitizeDepsArgs { slug: string; blueprintSlug: string; }
interface ForgeInjectBuildConfigArgs { slug: string; blueprintSlug: string; }
interface ForgeValidateWorkspaceArgs { slug: string; }
interface ForgeCheckReadinessArgs { appId: number; probeRuntime?: boolean; }
interface ForgeEditFileArgs { slug: string; filePath: string; content: string; }
interface ForgeNpmCommandArgs { slug: string; command: string; }
interface StudioListFilesArgs { slug: string; }
interface StudioReadFileArgs { slug: string; filePath: string; }
interface StudioEnhanceAppArgs { appId: number; instruction: string; }
interface StudioPlanEnhancementArgs { appId: number; instruction: string; scopePath?: string; }
interface SearchHilContextArgs { query: string; limit?: number; }
interface GetBlueprintSpecArgs { blueprintSlug: string; }

/**
 * forge_app — scaffold a new mini-app from a blueprint
 * Args: { blueprint: string, name: string, slug: string, description: string, systemPrompt?: string }
 */
export async function handleForgeApp(args: unknown, context?: ToolContext) {
    const { blueprint, name, slug, description, systemPrompt, parentAppSlug, forgeDepth } = (args as ForgeAppArgs) ?? {};

    if (!blueprint) return errorResponse("blueprint is required");
    if (!name) return errorResponse("name is required");
    if (!slug) return errorResponse("slug is required (URL-safe identifier)");
    if (!description) return errorResponse("description is required");

    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const { appRegistryService } = await import("@domain/apps/app-registry.service.js");

        let currentDepth = forgeDepth || 0;
        if (!forgeDepth && parentAppSlug) {
            try {
                const parentApp = await appRegistryService.getApp(parentAppSlug);
                currentDepth = ((parentApp as any).runtimeMetadata?.forge_depth || 0) + 1;
            } catch (e) {
                // Fallback to 1 if parent found but metadata missing or error
                currentDepth = 1;
            }
        }

        const result = await appForgeService.forgeApp(blueprint, {
            name,
            slug,
            description,
            oddjobMissionId: context?.missionId ?? 0,
            ...(systemPrompt ? { systemPrompt } : {}),
            blackboard: {
                parent_app_slug: parentAppSlug,
                forge_depth: currentDepth
            },
            ...(context?.organizationId ? { organizationId: context.organizationId } : {}),
        } as any);

        if (!result.success || !result.jobId) {
            return errorResponse("Forge queuing failed");
        }

        return {
            success: true,
            jobId: result.jobId,
            slug,
            message: `App '${name}' forge request accepted. Monitor status with jobId: ${result.jobId}`,
        };

    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * list_blueprints — discover available application architectures
 */
export async function handleListBlueprints(_args: unknown, _context?: ToolContext) {
    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const blueprints = await appForgeService.listBlueprints();
        return { success: true, blueprints };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * get_forge_status — monitor real-time assembly progress
 * Args: { jobId: string }
 */
export async function handleGetForgeStatus(args: unknown, _context?: ToolContext) {
    const { jobId } = (args as ForgeStatusArgs) ?? {};
    if (!jobId) return errorResponse("jobId is required");

    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const raw = await redis.get(`forge:job:${jobId}`);
        if (!raw) return errorResponse("Forge job not found");
        return { success: true, ...JSON.parse(raw) };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * forge_sanitize_deps — strip AI-hallucinated packages from package.json
 * Args: { slug: string, blueprintSlug: string }
 */
export async function handleForgeSanitizeDeps(args: unknown, _context?: ToolContext) {
    const { slug, blueprintSlug } = (args as ForgeSanitizeDepsArgs) ?? {};
    if (!slug) return errorResponse("slug is required");
    if (!blueprintSlug) return errorResponse("blueprintSlug is required");

    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const result = await appForgeService.sanitizeDependencies(slug, blueprintSlug);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * forge_inject_build_config — inject next.config.js, tsconfig.json, etc.
 * Args: { slug: string }
 */
export async function handleForgeInjectBuildConfig(args: unknown, _context?: ToolContext) {
    const { slug, blueprintSlug } = (args as ForgeInjectBuildConfigArgs) ?? {};
    if (!slug) return errorResponse("slug is required");
    if (!blueprintSlug) return errorResponse("blueprintSlug is required");

    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const result = await appForgeService.injectBuildConfig(slug, blueprintSlug);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * forge_validate_workspace — pre-flight validation before Docker build
 * Args: { slug: string }
 */
export async function handleForgeValidateWorkspace(args: unknown, _context?: ToolContext) {
    const { slug } = (args as ForgeValidateWorkspaceArgs) ?? {};
    if (!slug) return errorResponse("slug is required");

    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const result = await appForgeService.validateWorkspace(slug);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * forge_check_readiness â€” run app readiness gate
 * Args: { appId: number, probeRuntime?: boolean }
 */
export async function handleForgeCheckReadiness(args: unknown, context?: ToolContext) {
    const { appId, probeRuntime } = (args as ForgeCheckReadinessArgs) ?? {};
    if (!appId) return errorResponse("appId is required");

    try {
        const { appReadinessService } = await import("@domain/apps/core/app-readiness.service.js");
        const result = await appReadinessService.getAppReadiness(appId, context?.organizationId ?? undefined, { probeRuntime });
        return { success: true, ...result };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * forge_edit_file — edit or create a file in the forge workspace
 * Args: { slug: string, filePath: string, content: string }
 */
export async function handleForgeEditFile(args: unknown, _context?: ToolContext) {
    const { slug, filePath, content } = (args as ForgeEditFileArgs) ?? {};
    if (!slug) return errorResponse("slug is required");
    if (!filePath) return errorResponse("filePath is required");
    if (typeof content !== "string") return errorResponse("content must be a string");

    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const result = await appForgeService.editFile(slug, filePath, content);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * forge_npm_command — run npm command in the forge workspace
 * Args: { slug: string, command: string }
 */
export async function handleForgeNpmCommand(args: unknown, _context?: ToolContext) {
    const { slug, command } = (args as ForgeNpmCommandArgs) ?? {};
    if (!slug) return errorResponse("slug is required");
    if (!command) return errorResponse("command is required");

    try {
        const { appForgeService } = await import("@domain/apps/app-forge.service.js");
        const parts = command.split(' ');
        const result = await appForgeService.runCommand(slug, "npm", parts);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * studio_list_files — list file tree of a forged app
 * Args: { slug: string }
 */
export async function handleStudioListFiles(args: unknown, _context?: ToolContext) {
    const { slug } = (args as StudioListFilesArgs) ?? {};
    if (!slug) return errorResponse("slug is required");

    try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const { resolveForgeWorkspacePath } = await import("@domain/apps/core/forge-paths.js");
        const workspacePath = await resolveForgeWorkspacePath(slug);
        const SKIP = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache"]);

        async function walk(dir: string, rel: string): Promise<any[]> {
            let entries: any[];
            try { entries = await fs.default.readdir(dir, { withFileTypes: true }); } catch { return []; }
            const nodes: any[] = [];
            for (const e of entries) {
                if (SKIP.has(e.name)) continue;
                const full = path.default.join(dir, e.name);
                const relPath = (rel ? rel + "/" : "") + e.name;
                if (e.isDirectory()) {
                    nodes.push({ name: e.name, path: relPath, type: "dir", children: await walk(full, relPath) });
                } else {
                    const stat = await fs.default.stat(full).catch(() => ({ size: 0 }));
                    nodes.push({ name: e.name, path: relPath, type: "file", ext: path.default.extname(e.name).slice(1), size: (stat as any).size });
                }
            }
            return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
        }

        try {
            await fs.default.access(workspacePath);
            const tree = await walk(workspacePath, "");
            return { success: true, slug, tree };
        } catch {
            return errorResponse(`Workspace not found for slug: ${slug}`);
        }
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * studio_read_file — read content of a specific file
 * Args: { slug: string, filePath: string }
 */
export async function handleStudioReadFile(args: unknown, _context?: ToolContext) {
    const { slug, filePath } = (args as StudioReadFileArgs) ?? {};
    if (!slug) return errorResponse("slug is required");
    if (!filePath) return errorResponse("filePath is required");

    try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const { resolveForgeWorkspacePath, isWithinDirectory } = await import("@domain/apps/core/forge-paths.js");
        const workspacePath = await resolveForgeWorkspacePath(slug);
        const fullPath = path.default.resolve(workspacePath, filePath);
        if (!isWithinDirectory(workspacePath, fullPath)) return errorResponse("Invalid path");
        try {
            const content = await fs.default.readFile(fullPath, "utf-8");
            return { success: true, slug, path: filePath, content };
        } catch {
            return errorResponse(`File not found: ${filePath}`);
        }
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * studio_enhance_app — apply AI changes and rebuild
 * Args: { appId: number, instruction: string }
 */
export async function handleStudioEnhanceApp(args: unknown, context?: ToolContext) {
    const { appId, instruction } = (args as StudioEnhanceAppArgs) ?? {};
    if (!appId) return errorResponse("appId is required");
    if (!instruction) return errorResponse("instruction is required");

    try {
        const { appBuilderService } = await import("@domain/apps/app-builder.service.js");
        const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
        const app = await appRegistryService.getApp(appId);
        if (!app) return errorResponse(`App ${appId} not found`);
        const result = await appBuilderService.enhanceApp(appId, (app as any).slug, instruction, context?.organizationId ?? undefined);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * studio_plan_enhancement â€” preview App Builder writes before applying them
 * Args: { appId: number, instruction: string, scopePath?: string }
 */
export async function handleStudioPlanEnhancement(args: unknown, context?: ToolContext) {
    const { appId, instruction, scopePath } = (args as StudioPlanEnhancementArgs) ?? {};
    if (!appId) return errorResponse("appId is required");
    if (!instruction) return errorResponse("instruction is required");

    try {
        const { appBuilderService } = await import("@domain/apps/app-builder.service.js");
        const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
        const app = await appRegistryService.getApp(appId);
        if (!app) return errorResponse(`App ${appId} not found`);
        const result = await appBuilderService.previewEnhancementPlan(appId, (app as any).slug, instruction, context?.organizationId ?? undefined, scopePath);
        return result as any;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * search_hil_context — search past HIL decisions
 * Args: { query: string, limit?: number }
 */
export async function handleSearchHilContext(args: unknown, context?: ToolContext) {
    const { query, limit = 10 } = (args as SearchHilContextArgs) ?? {};
    if (!query) return errorResponse("query is required");

    try {
        const { db } = await import("@server/database_service.js");
        const { approvalRequests } = await import("@shared/schema/hil.js");
        const { sql, eq, and } = await import("drizzle-orm");

        const conditions: any[] = [
            sql`${approvalRequests.comments} ilike ${'%' + query + '%'}`
        ];

        if (context?.organizationId) {
            conditions.push(eq(approvalRequests.organizationId, context.organizationId));
        }

        const rows = await db.select({
            id: approvalRequests.id,
            status: approvalRequests.status,
            comments: approvalRequests.comments,
            decisionAt: approvalRequests.decisionAt,
            modifiedOutput: approvalRequests.modifiedOutput,
        })
            .from(approvalRequests)
            .where(and(...conditions))
            .limit(limit);

        return { success: true, results: rows, count: rows.length };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * get_blueprint_spec — retrieve the file structure and metadata of a blueprint
 * Args: { blueprintSlug: string }
 */
export async function handleGetBlueprintSpec(args: unknown, _context?: ToolContext) {
    const { blueprintSlug } = (args as GetBlueprintSpecArgs) ?? {};
    if (!blueprintSlug) return errorResponse("blueprintSlug is required");

    try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const blueprintPath = path.default.resolve("server/blueprints/apps", blueprintSlug);

        async function walk(dir: string, rel: string): Promise<any[]> {
            let entries: any[];
            try { entries = await fs.default.readdir(dir, { withFileTypes: true }); } catch { return []; }
            const nodes: any[] = [];
            for (const e of entries) {
                const relPath = (rel ? rel + "/" : "") + e.name;
                if (e.isDirectory()) {
                    nodes.push({ name: e.name, path: relPath, type: "dir", children: await walk(path.default.join(dir, e.name), relPath) });
                } else {
                    nodes.push({ name: e.name, path: relPath, type: "file" });
                }
            }
            return nodes;
        }

        try {
            await fs.default.access(blueprintPath);
            const tree = await walk(blueprintPath, "");

            // Read package.json to get metadata if it exists
            let metadata = {};
            try {
                const pkgJson = await fs.default.readFile(path.default.join(blueprintPath, "package.json"), "utf-8");
                metadata = JSON.parse(pkgJson).oddjob || {};
            } catch {}

            return { success: true, blueprintSlug, tree, metadata };
        } catch {
            return errorResponse(`Blueprint not found: ${blueprintSlug}`);
        }
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
