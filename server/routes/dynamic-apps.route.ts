import { Router, Request, Response, NextFunction } from "express";
import { dynamicAssemblyService } from "../domain/scaffold/dynamic-assembly.service.js";
import { dynamicAppRegistry } from "../domain/scaffold/dynamic-app-registry.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("DynamicAppsRoute");
export const dynamicAppsRouter = Router();

/**
 * Assembling mounts a live express sub-router on this origin, serving whatever
 * `endpoints[]` the caller described. Unauthenticated, that is an open door to
 * publish JSON endpoints under our own domain — and the list, read and delete
 * below were equally open, so any caller could enumerate every tenant's apps
 * and unmount them. Everything here needs a session.
 */
dynamicAppsRouter.use(requireAuth);

/** Used in URLs and as the registry key, so it cannot be free text. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** The caller's organization, which scopes every read and write below. */
async function orgOf(req: Request): Promise<number | null> {
  const orgContext = await getUserOrgContext(req);
  return orgContext.organizationId ?? null;
}

/**
 * POST /api/apps/dynamic/assemble
 * Dynamically assembles and hot-mounts an application entirely in memory in sub-50ms
 */
dynamicAppsRouter.post("/assemble", async (req: Request, res: Response) => {
  try {
    const slug = String(req.body?.slug ?? "").toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      return res.status(400).json({
        success: false,
        error: "slug must be 2-64 characters of lowercase letters, digits and hyphens, starting with a letter or digit.",
      });
    }

    const result = await dynamicAssemblyService.assembleDynamicApp({
      ...req.body,
      slug,
      // From the session, never the body: otherwise a caller files its app
      // under someone else's organization.
      organizationId: await orgOf(req),
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (err: any) {
    logger.error(`[DynamicAppsRoute] Assembly error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/apps/dynamic
 * List all dynamically mounted in-memory applications
 */
dynamicAppsRouter.get("/", async (req: Request, res: Response) => {
  const apps = dynamicAppRegistry.listApps(await orgOf(req));
  res.json({ total: apps.length, apps });
});

/**
 * GET /api/apps/dynamic/:slug
 * Get spec and proof certificate for a dynamically mounted app
 */
dynamicAppsRouter.get("/:slug", async (req: Request, res: Response) => {
  const app = dynamicAppRegistry.getApp(req.params.slug, await orgOf(req));
  if (!app) {
    return res.status(404).json({ error: `App '${req.params.slug}' not found` });
  }
  const { router, ...spec } = app;
  res.json(spec);
});

/**
 * DELETE /api/apps/dynamic/:slug
 * Unmount and remove a dynamically assembled app
 */
dynamicAppsRouter.delete("/:slug", async (req: Request, res: Response) => {
  const removed = dynamicAppRegistry.removeApp(req.params.slug, await orgOf(req));
  if (!removed) {
    return res.status(404).json({ error: `App '${req.params.slug}' not found` });
  }
  res.json({ success: true, message: `App '${req.params.slug}' unmounted.` });
});

/**
 * Proxy dispatcher for live sub-router execution
 */
export function dynamicAppDispatcher(req: Request, res: Response, next: NextFunction) {
  const slug = req.params.slug?.toLowerCase();
  const subRouter = dynamicAppRegistry.getAppRouter(slug);

  if (!subRouter) {
    return res.status(404).json({ error: `Dynamic App '${slug}' is not mounted in memory.` });
  }

  // Strip prefix and dispatch to sub-router
  return subRouter(req, res, next);
}

export default dynamicAppsRouter;
