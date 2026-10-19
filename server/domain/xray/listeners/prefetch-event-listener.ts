/**
 * Prefetch Event Listener
 *
 * Subscribes to composition graph rebuild events and triggers prefetch
 * manifest invalidation + warm-up so cached manifests stay fresh.
 *
 * Events handled:
 *  - REINDEX_COMPLETE (XrayEventBus): full reindex finished → invalidate + warm all scopes
 *  - POD_EVENTS.APP.DEPLOYED (EventStream): app deployed → invalidate + warm app scope
 *  - POD_EVENTS.APP.DELETED (EventStream): app deleted → invalidate prefetch cache for app scope
 *  - WORKSPACE_INVALIDATED (XrayEventBus): file watcher invalidation → invalidate prefetch for slug
 */

import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "@domain/core/infrastructure/pod-events.contract.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PrefetchEventListener");

let prefetchListenersInitialized = false;

export async function initializePrefetchEventListeners(): Promise<void> {
  if (prefetchListenersInitialized) return;
  prefetchListenersInitialized = true;
  logger.info("[PrefetchListener] Registering prefetch manifest invalidation listeners");

  const { xrayEventBus, XrayEventType } = await import("../core/xray-event-bus.js");

  // ─── On fullReindex completion: invalidate + warm all scopes for the org ────
  xrayEventBus.on(XrayEventType.REINDEX_COMPLETE, async (event) => {
    const { orgId } = event;
    if (!orgId || typeof orgId !== "number") return;

    logger.info(`[PrefetchListener] REINDEX_COMPLETE for org ${orgId} — invalidating + warming all scopes`);

    try {
      const { prefetchService } = await import("../core/prefetch.service.js");
      const { db } = await import("@server/database_service.js");
      const { apps } = await import("@shared/schema/index.js");
      const { eq, or, isNull } = await import("drizzle-orm");

      // Invalidate + warm platform scope
      await prefetchService.invalidateScope("oddjob", orgId);
      await prefetchService.warmManifests("oddjob", orgId);

      // Invalidate + warm all Published_App scopes for this org
      const orgApps = await db.select({ slug: apps.slug })
        .from(apps)
        .where(or(eq(apps.organizationId, orgId), isNull(apps.organizationId)));

      for (const app of orgApps) {
        if (!app.slug) continue;
        try {
          await prefetchService.invalidateScope(app.slug, orgId);
          await prefetchService.warmManifests(app.slug, orgId);
        } catch (err: any) {
          logger.warn(`[PrefetchListener] Failed to warm prefetch for app "${app.slug}": ${err.message}`);
        }
      }

      logger.info(`[PrefetchListener] Post-reindex warm-up complete for org ${orgId}: ${orgApps.length + 1} scopes`);
    } catch (err: any) {
      logger.warn(`[PrefetchListener] REINDEX_COMPLETE handler failed for org ${orgId}: ${err.message}`);
    }
  });

  // ─── On APP.DEPLOYED: invalidate + warm prefetch manifests for deployed app ──
  eventStream.on(POD_EVENTS.APP.DEPLOYED, async (event) => {
    const { appSlug, organizationId } = event.payload ?? {};
    if (!appSlug || !organizationId) return;

    logger.info(`[PrefetchListener] APP.DEPLOYED: "${appSlug}" org ${organizationId} — invalidating + warming prefetch`);

    try {
      const { prefetchService } = await import("../core/prefetch.service.js");
      await prefetchService.invalidateScope(appSlug, organizationId);
      await prefetchService.warmManifests(appSlug, organizationId);
    } catch (err: any) {
      logger.warn(`[PrefetchListener] APP.DEPLOYED handler failed for "${appSlug}": ${err.message}`);
    }
  });

  // ─── On APP.DELETED: invalidate prefetch manifests for deleted app ───────────
  eventStream.on(POD_EVENTS.APP.DELETED, async (event) => {
    const { appSlug, organizationId } = event.payload ?? {};
    if (!appSlug || !organizationId) return;

    logger.info(`[PrefetchListener] APP.DELETED: "${appSlug}" org ${organizationId} — invalidating prefetch cache`);

    try {
      const { prefetchService } = await import("../core/prefetch.service.js");
      await prefetchService.invalidateScope(appSlug, organizationId);
    } catch (err: any) {
      logger.warn(`[PrefetchListener] APP.DELETED handler failed for "${appSlug}": ${err.message}`);
    }
  });

  // ─── On workspace watcher invalidation: invalidate prefetch for that slug ───
  xrayEventBus.on(XrayEventType.WORKSPACE_INVALIDATED, async (event) => {
    const slug = event.metadata?.slug;
    if (!slug || typeof slug !== "string") return;

    logger.info(`[PrefetchListener] WORKSPACE_INVALIDATED: "${slug}" — invalidating prefetch manifests`);

    try {
      const { prefetchService } = await import("../core/prefetch.service.js");
      const { db } = await import("@server/database_service.js");
      const { apps } = await import("@shared/schema/index.js");
      const { eq } = await import("drizzle-orm");

      // Look up the org for this slug to invalidate the correct cache keys
      const appRows = await db.select({ organizationId: apps.organizationId })
        .from(apps)
        .where(eq(apps.slug, slug));

      for (const app of appRows) {
        if (app.organizationId == null) continue;
        try {
          await prefetchService.invalidateScope(slug, app.organizationId);
        } catch (err: any) {
          logger.warn(`[PrefetchListener] Failed to invalidate prefetch for slug "${slug}" org ${app.organizationId}: ${err.message}`);
        }
      }
    } catch (err: any) {
      logger.warn(`[PrefetchListener] WORKSPACE_INVALIDATED handler failed for "${slug}": ${err.message}`);
    }
  });
}
