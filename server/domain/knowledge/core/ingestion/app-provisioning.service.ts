/**
 * App Provisioning Service
 *
 * Ensures dependent Research Workbench app instances are running during
 * autonomous research ingestion. Integrates with `appRegistryService.startApp`
 * to provision apps on demand, with a 30-second timeout and graceful
 * failure handling (non-blocking).
 *
 * Stage-specific provisioning:
 * - "extracting" stage: ensures Memory Library module is active
 * - "synthesizing" stage: ensures Draft Sandbox module is active
 *
 * Both modules live within the same research-workbench shared-server app,
 * so provisioning ensures the app itself is running.
 *
 * @see Requirements 10.1, 10.2, 10.3, 10.4
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import type { OrgContext } from "@server/utils/auth-context.js";
import type { IngestionStage } from "./types.js";

const logger = createLogger("AppProvisioning");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Timeout for app start attempts in milliseconds */
const APP_START_TIMEOUT_MS = 30_000;

/**
 * Slug pattern for the research workbench app.
 * The actual slug is `research-workbench-org{orgId}`.
 */
const RESEARCH_WORKBENCH_SLUG_PREFIX = "research-workbench-org";

/**
 * Maps pipeline stages to the workbench modules they depend on.
 * Both modules are routes within the research-workbench shared-server app.
 */
const STAGE_MODULE_MAP: Partial<Record<IngestionStage, string>> = {
  extracting: "memory-library",
  synthesizing: "draft-sandbox",
};

// ─── Public Types ──────────────────────────────────────────────────────────────

/** A single provisioning attempt log entry */
export interface AppProvisioningLogEntry {
  /** The app instance ID that was provisioned */
  appId: number;
  /** The pipeline stage when provisioning was triggered */
  stage: IngestionStage;
  /** Whether the app started successfully */
  success: boolean;
  /** Error message if provisioning failed */
  error?: string;
  /** ISO 8601 timestamp of the provisioning attempt */
  timestamp: string;
}

/** Result of an app provisioning check */
export interface AppProvisioningResult {
  /** Log of all provisioning attempts made */
  log: AppProvisioningLogEntry[];
  /** Whether all required apps started successfully */
  allSuccessful: boolean;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const appProvisioningService = {
  /**
   * Ensure required Research Workbench apps are running for the given stage.
   *
   * Checks if the research-workbench app has a running instance for the org.
   * If not, attempts to start it via `appRegistryService.startApp` with a
   * 30-second timeout. On failure, logs a warning and continues without blocking.
   *
   * @param stage - The current ingestion pipeline stage
   * @param orgContext - Organization context for scoping app lookups
   * @returns Provisioning result with log entries and success status
   */
  async ensureAppsRunning(
    stage: IngestionStage,
    orgContext: OrgContext
  ): Promise<AppProvisioningResult> {
    const log: AppProvisioningLogEntry[] = [];
    const orgId = orgContext.organizationId;

    // Only provision for stages that have module dependencies
    const requiredModule = STAGE_MODULE_MAP[stage];
    if (!requiredModule) {
      logger.debug("No app provisioning required for stage", { stage });
      return { log, allSuccessful: true };
    }

    if (!orgId) {
      logger.warn("Cannot provision apps without organization context");
      return { log, allSuccessful: false };
    }

    logger.info("Checking app provisioning", {
      stage,
      requiredModule,
      orgId,
    });

    // Find the research-workbench app for this org
    const workbenchSlug = `${RESEARCH_WORKBENCH_SLUG_PREFIX}${orgId}`;
    const appInfo = await findWorkbenchApp(workbenchSlug, orgId);

    if (!appInfo) {
      const entry: AppProvisioningLogEntry = {
        appId: 0,
        stage,
        success: false,
        error: `Research workbench app not found for org ${orgId} (slug: ${workbenchSlug})`,
        timestamp: new Date().toISOString(),
      };
      log.push(entry);
      logger.warn("Research workbench app not found", { workbenchSlug, orgId });
      return { log, allSuccessful: false };
    }

    // Check if a running instance already exists
    const isRunning = await hasRunningInstance(appInfo.deploymentId);
    if (isRunning) {
      logger.info("Research workbench already running", {
        appId: appInfo.appId,
        stage,
        module: requiredModule,
      });
      const entry: AppProvisioningLogEntry = {
        appId: appInfo.appId,
        stage,
        success: true,
        timestamp: new Date().toISOString(),
      };
      log.push(entry);
      return { log, allSuccessful: true };
    }

    // Attempt to start the app with a 30-second timeout
    const entry = await startAppWithTimeout(appInfo.appId, orgId, stage);
    log.push(entry);

    return {
      log,
      allSuccessful: entry.success,
    };
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

interface WorkbenchAppInfo {
  appId: number;
  deploymentId: number;
  slug: string;
}

/**
 * Find the research-workbench app and its deployment for the given org.
 */
async function findWorkbenchApp(
  slug: string,
  orgId: number
): Promise<WorkbenchAppInfo | null> {
  try {
    const [result] = await db
      .select({
        appId: apps.id,
        deploymentId: appDeployments.id,
        slug: apps.slug,
      })
      .from(apps)
      .innerJoin(appDeployments, eq(appDeployments.appId, apps.id))
      .where(
        and(
          eq(apps.slug, slug),
          eq(appDeployments.organizationId, orgId)
        )
      )
      .limit(1);

    return result || null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to lookup workbench app", { slug, orgId, error: message });
    return null;
  }
}

/**
 * Check if a deployment has at least one running instance.
 */
async function hasRunningInstance(deploymentId: number): Promise<boolean> {
  const [instance] = await db
    .select({ id: appInstances.id })
    .from(appInstances)
    .where(
      and(
        eq(appInstances.deploymentId, deploymentId),
        eq(appInstances.status, "running")
      )
    )
    .limit(1);

  return !!instance;
}

/**
 * Attempt to start an app with a 30-second timeout.
 * Returns a log entry indicating success or failure.
 */
async function startAppWithTimeout(
  appId: number,
  orgId: number,
  stage: IngestionStage
): Promise<AppProvisioningLogEntry> {
  const timestamp = new Date().toISOString();

  logger.info("Starting app provisioning", { appId, orgId, stage });

  try {
    const { appRegistryService } = await import("../../../apps/app-registry.service.js");

    // Race startApp against the timeout
    const startPromise = appRegistryService.startApp(appId, orgId);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          Object.assign(
            new Error(`App start timed out after ${APP_START_TIMEOUT_MS}ms`),
            { name: "TimeoutError" }
          )
        );
      }, APP_START_TIMEOUT_MS);
    });

    await Promise.race([startPromise, timeoutPromise]);

    logger.info("App provisioning successful", { appId, orgId, stage });

    return {
      appId,
      stage,
      success: true,
      timestamp,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    logger.warn("App provisioning failed", {
      appId,
      orgId,
      stage,
      error: message,
    });

    return {
      appId,
      stage,
      success: false,
      error: message,
      timestamp,
    };
  }
}
