/**
 * App Versioning API Routes
 * 
 * Endpoints for git-like version control of forged apps.
 */
import { Router } from "express";
import { appVersioningService } from "./core/app-versioning.service.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("VersioningRoutes");

/**
 * GET /api/versions
 * Get version history for an app
 */
router.get("/", async (req, res) => {
  try {
    const { appId, appSlug, branch, limit = "20" } = req.query;
    
    if (!appId && !appSlug) {
      return res.status(400).json({ error: "appId or appSlug required" });
    }

    const targetAppId = await appVersioningService.resolveAppId(
      appId ? Number(appId) : null, 
      appSlug as string | null
    );

    if (!targetAppId) {
      return res.status(404).json({ error: "App not found" });
    }

    const versions = await appVersioningService.getHistory(targetAppId, branch as string | undefined);
    const limited = versions.slice(0, Number(limit));

    res.json({
      versions: limited,
      total: versions.length,
      appId: targetAppId
    });
    
  } catch (error) {
    logger.error("[VersioningAPI] Error fetching versions:", error);
    res.status(500).json({
      error: "Failed to fetch versions",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/versions/:versionId
 * Get a specific version
 */
router.get("/:versionId", async (req, res) => {
  try {
    const { versionId } = req.params;
    const version = await appVersioningService.getVersion(versionId);
    
    if (!version) {
      return res.status(404).json({ error: "Version not found" });
    }

    res.json(version);
  } catch (error) {
    logger.error("[VersioningAPI] Error fetching version:", error);
    res.status(500).json({
      error: "Failed to fetch version",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/versions
 * Create a new version commit
 */
router.post("/", async (req, res) => {
  try {
    const { appId, appSlug, sourcePath, message, author, branch, tags } = req.body;
    
    if (!appId && !appSlug) {
      return res.status(400).json({ error: "appId or appSlug required" });
    }
    if (!sourcePath) {
      return res.status(400).json({ error: "sourcePath required" });
    }
    if (!message) {
      return res.status(400).json({ error: "commit message required" });
    }
    if (!author) {
      return res.status(400).json({ error: "author required" });
    }

    const targetAppId = await appVersioningService.resolveAppId(
      appId ? Number(appId) : null, 
      appSlug as string | null
    );

    if (!targetAppId) {
      return res.status(404).json({ error: "App not found" });
    }

    const version = await appVersioningService.commit(targetAppId, sourcePath, {
      message,
      author,
      branch: branch || "main",
      tags: tags || []
    });

    res.status(201).json(version);
    
  } catch (error) {
    logger.error("[VersioningAPI] Error creating version:", error);
    res.status(500).json({
      error: "Failed to create version",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/versions/rollback
 * Rollback to a specific version
 */
router.post("/rollback", async (req, res) => {
  try {
    const { appId, appSlug, targetVersionId, targetPath } = req.body;
    
    if (!appId && !appSlug) {
      return res.status(400).json({ error: "appId or appSlug required" });
    }
    if (!targetVersionId) {
      return res.status(400).json({ error: "targetVersionId required" });
    }
    if (!targetPath) {
      return res.status(400).json({ error: "targetPath required" });
    }

    const targetAppId = await appVersioningService.resolveAppId(
      appId ? Number(appId) : null, 
      appSlug as string | null
    );

    if (!targetAppId) {
      return res.status(404).json({ error: "App not found" });
    }

    await appVersioningService.rollback(targetAppId, targetVersionId, targetPath);

    res.json({
      success: true,
      message: `Rolled back to version ${targetVersionId}`
    });
    
  } catch (error) {
    logger.error("[VersioningAPI] Error rolling back:", error);
    res.status(500).json({
      error: "Rollback failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/versions/diff
 * Compare two versions or a version against current files
 */
router.get("/diff/compare", async (req, res) => {
  try {
    const { fromVersionId, toVersionId, currentPath } = req.query;
    
    if (!fromVersionId) {
      return res.status(400).json({ error: "fromVersionId required" });
    }

    let diff;
    if (toVersionId) {
      diff = await appVersioningService.diff(fromVersionId as string, toVersionId as string);
    } else if (currentPath) {
      diff = await appVersioningService.diffWorkingDir(fromVersionId as string, currentPath as string);
    } else {
      return res.status(400).json({ error: "toVersionId or currentPath required" });
    }

    res.json(diff);
    
  } catch (error) {
    logger.error("[VersioningAPI] Error computing diff:", error);
    res.status(500).json({
      error: "Failed to compute diff",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
