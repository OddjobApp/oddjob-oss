import { Router } from "express";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { prefetchService } from "../core/prefetch.service.js";
import { xrayScopeAccessService } from "../core/scope-access.service.js";

const logger = createLogger("PrefetchManifestRoute");
export const prefetchManifestRouter = Router();

/**
 * Resolve a scope slug and verify the requesting user's org has access.
 * For "oddjob" (platform scope), access is always granted to authenticated users.
 * For app scopes, verifies the Published_App belongs to the user's organization.
 * Returns true if access is allowed, false otherwise.
 */

/**
 * GET /api/xray/prefetch-manifest
 * Returns the prefetch manifest for a single screen within a scope.
 *
 * Query params:
 *   - screen (required): The screen route path (e.g., "/dashboard")
 *   - scope (optional): The scope slug, defaults to "oddjob"
 */
prefetchManifestRouter.get("/xray/prefetch-manifest", requireAuth, async (req, res) => {
  try {
    const screen = req.query.screen as string | undefined;
    if (!screen) {
      return res.status(400).json({ error: "Missing required query parameter: screen" });
    }

    const scope = (req.query.scope as string) || "oddjob";
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: "Organization context required" });
    }

    const hasAccess = await xrayScopeAccessService.verifyScopeAccess(scope, organizationId, isSuperAdmin);
    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const manifest = await prefetchService.getManifest(screen, scope, organizationId);
    return res.json(manifest);
  } catch (err: any) {
    logger.error(`[PrefetchManifest] single-screen error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/xray/prefetch-manifest/bulk
 * Returns prefetch manifests for all screens within a scope.
 *
 * Query params:
 *   - scope (required): The scope slug (Published_App slug or "oddjob")
 */
prefetchManifestRouter.get("/xray/prefetch-manifest/bulk", requireAuth, async (req, res) => {
  try {
    const scope = req.query.scope as string | undefined;
    if (!scope) {
      return res.status(400).json({ error: "Missing required query parameter: scope" });
    }

    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: "Organization context required" });
    }

    const hasAccess = await xrayScopeAccessService.verifyScopeAccess(scope, organizationId, isSuperAdmin);
    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const manifests = await prefetchService.getBulkManifests(scope, organizationId);
    return res.json(manifests);
  } catch (err: any) {
    logger.error(`[PrefetchManifest] bulk error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});
