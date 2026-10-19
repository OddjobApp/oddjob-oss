/**
 * Admin System Routes
 * Endpoints for system administration, including software updates and health checks.
 */
import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { requireSuperAdmin } from "../utils/auth-context.js";
import { SimpleCache } from "../utils/simple-cache.js";
import path from "path";

const router = Router();
const versionCache = new SimpleCache({ stdTTL: 3600 }); // Cache for 1 hour


interface SoftwareInfo {
    name: string;
    currentVersion: string;
    latestVersion?: string;
    status: 'up_to_date' | 'update_available' | 'unknown';
    releaseUrl?: string;
}

// Hardcoded current versions from docker-compose.yml
// In a real production env, these might be read from process.env or a manifest file
const CURRENT_VERSIONS: Record<string, string> = {
    'qdrant': 'v1.8.1',
    'redis': 'alpine', // Tag is generic, difficult to know exact version without querying CLI
    'rabbitmq': '3-management',
    'postgres': '15-alpine'
};

router.get("/software-updates", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const cached = versionCache.get<SoftwareInfo[]>('software_updates');
    if (cached) {
        res.json({ updates: cached });
        return;
    }

    const updates: SoftwareInfo[] = [];

    // Helper to fetch Docker Hub tags
    const fetchLatestTag = async (image: string, filter?: RegExp): Promise<string | undefined> => {
        try {
            // Docker Hub API
            const response = await fetch(`https://hub.docker.com/v2/repositories/${image}/tags?page_size=10`);
            if (!response.ok) return undefined;

            const data = await response.json() as any;
            const tags = data.results.map((r: any) => r.name);

            // Find latest matching tag
            // Simplification: just take the first one that looks like a version number and matches our major version preference
            // For production, semver sorting would be better
            return tags.find((t: string) => filter ? filter.test(t) : true) || tags[0];
        } catch (e) {
            return undefined;
        }
    };

    // Qdrant
    const latestQdrant = await fetchLatestTag('qdrant/qdrant', /^v1\./);
    updates.push({
        name: 'Qdrant',
        currentVersion: CURRENT_VERSIONS['qdrant'],
        latestVersion: latestQdrant,
        status: latestQdrant && latestQdrant !== CURRENT_VERSIONS['qdrant'] ? 'update_available' : 'up_to_date',
        releaseUrl: 'https://github.com/qdrant/qdrant/releases'
    });

    // Redis
    // "alpine" isn't a version number, so let's skip strict comparison or fetch 'latest'
    updates.push({
        name: 'Redis',
        currentVersion: '7.x (alpine)',
        latestVersion: 'Latest (alpine)',
        status: 'up_to_date', // Assume auto-pull
        releaseUrl: 'https://redis.io/docs/about/releases/'
    });

    // RabbitMQ
    const latestRabbit = await fetchLatestTag('library/rabbitmq', /^3.*-management$/);
    const currentRabbit = CURRENT_VERSIONS['rabbitmq']; // 3-management (floating tag)
    updates.push({
        name: 'RabbitMQ',
        currentVersion: currentRabbit,
        latestVersion: latestRabbit || '3-management',
        status: 'up_to_date', // Floating tag
        releaseUrl: 'https://www.rabbitmq.com/changelog.html'
    });

    // Postgres
    const latestPg = await fetchLatestTag('library/postgres', /^15.*-alpine$/);
    updates.push({
        name: 'PostgreSQL',
        currentVersion: '15-alpine',
        latestVersion: latestPg,
        status: latestPg && latestPg !== '15-alpine' ? 'update_available' : 'up_to_date', // 15-alpine is also floating
        releaseUrl: 'https://www.postgresql.org/docs/release/'
    });

    versionCache.set('software_updates', updates);
    res.json({ updates });
}));

router.get("/internal-kg", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const sessionUserId = (req.session as any)?.userId;
    console.log("[internal-kg] Request received - Session userId:", sessionUserId);
    console.log("[internal-kg] Calling systemKnowledgeService.getInternalKnowledgeGraph()");

    try {
        const { systemKnowledgeService } = await import("@domain/knowledge/core/system-knowledge-service.js");
        const graph = await systemKnowledgeService.getInternalKnowledgeGraph();
        console.log("[internal-kg] SUCCESS! Returning graph with", graph.nodes?.length, "nodes and", graph.edges?.length, "edges");
        res.json(graph);
    } catch (err: any) {
        console.error("[internal-kg] ERROR:", err.message);
        console.error("[internal-kg] Stack:", err.stack);
        throw err;
    }
}));

router.post("/internal-kg/sync", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { systemKnowledgeService } = await import("@domain/knowledge/core/system-knowledge-service.js");

    // Determine brain directory from app data or env
    // For local dev, we use the known path from the context
    // In a real app, this would be a config setting
    const brainDir = process.env.BRAIN_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", ".gemini/antigravity/brain");
    const projectRoot = process.cwd();

    await systemKnowledgeService.ingestSystemMemory(brainDir, projectRoot);
    res.json({ message: "Internal Knowledge Graph sync started" });
}));

/**
 * Incrementally AST-index the Oddjob repository into the system graph.
 *
 * Distinct from /internal-kg/sync: that clears and re-ingests everything via the
 * regex scanners, while this only re-parses files whose content hash moved.
 * Safe to call repeatedly — an unchanged tree is a no-op.
 */
router.post("/internal-kg/index-repo", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { codeGraphService } = await import("@domain/xray/core/code-graph.service.js");

    const result = await codeGraphService.indexRepo({ repoRoot: process.cwd() });
    res.json({
        message: result.changed === 0
            ? "Repository already up to date"
            : `Indexed ${result.changed} changed file(s)`,
        ...result,
    });
}));

/**
 * Real-time change impact assessment and blast-radius calculation.
 */
router.get("/impact", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const file = req.query.file as string;
    if (!file) {
        res.status(400).json({ error: "Missing required query parameter 'file'" });
        return;
    }
    const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth as string, 10) : 3;
    const { SystemGraphService } = await import("@domain/self-improvement/system-graph.service.js");
    const impact = await SystemGraphService.assessChangeImpact({ filePath: file }, { maxDepth });
    res.json(impact);
}));

/**
 * Real-time dependency graph topology export with node leverage categories.
 */
router.get("/topology", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const filterRoot = req.query.filterRoot as string | undefined;
    const maxNodes = req.query.maxNodes ? parseInt(req.query.maxNodes as string, 10) : undefined;
    const { SystemGraphService } = await import("@domain/self-improvement/system-graph.service.js");
    const topology = await SystemGraphService.getTopologyGraph({ filterRoot, maxNodes });
    res.json(topology);
}));

/**
 * Dependency index health and statistics.
 */
router.get("/stats", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SystemGraphService } = await import("@domain/self-improvement/system-graph.service.js");
    const stats = await SystemGraphService.getSystemStats();
    res.json(stats);
}));

/**
 * Invalidate cached dependency index.
 */
router.post("/invalidate", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { SystemGraphService } = await import("@domain/self-improvement/system-graph.service.js");
    SystemGraphService.invalidateCache();
    res.json({ message: "System graph dependency cache cleared" });
}));

export default router;

