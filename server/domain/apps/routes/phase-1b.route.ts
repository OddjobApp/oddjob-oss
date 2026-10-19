import { Router, Request, Response } from "express";
import { containerBuilderService, ContainerSpec } from "../infrastructure/container-builder.service.js";
import { portManagerService, PortAllocationRequest } from "../infrastructure/port-manager.service.js";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@server/domain/auth/core/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("Phase1BRouter");
const router = Router();

/**
 * POST /api/phase-1b/containers/allocate-and-launch
 * Allocate a port and launch a container
 */
router.post("/containers/allocate-and-launch", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId, instanceId, image, ports, env, resources, volumes, restartPolicy, healthCheck, labels, annotations } = req.body;
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    if (!appId || !instanceId) {
      return res.status(400).json({ error: "appId and instanceId are required" });
    }

    logger.info(`Allocating port and launching container for app ${appId}, instance ${instanceId}`);

    // 1. Allocate port
    const portAllocation = await portManagerService.allocatePort({
      appId,
      instanceId,
      orgId,
      allocationType: "dynamic",
      reason: "launch_request",
      allocatedBy: req.user?.email || "system",
    });

    logger.info(`Allocated port ${portAllocation.port} for instance ${instanceId}`);

    // 2. Create container spec with allocated port
    const containerSpec: ContainerSpec = {
      appId,
      instanceId,
      name: `oddjob-app-${appId}-${instanceId}-${portAllocation.port}`,
      image: image || {
        name: "nginx",
        tag: "latest",
        pullPolicy: "ifNotPresent",
      },
      ports: ports || [{ containerPort: 3000, hostPort: portAllocation.port, protocol: "tcp" }],
      env: env || {},
      resources: resources || {
        limits: { memory: "512Mi", cpu: "500m" },
        requests: { memory: "256Mi", cpu: "100m" },
      },
      volumes: volumes || [],
      restartPolicy: restartPolicy || { policy: "unless-stopped" },
      healthCheck: healthCheck || {
        enabled: true,
        endpoint: "/api/health",
        initialDelay: 10,
        interval: 30,
        timeout: 5,
        unhealthyThreshold: 3,
        healthyThreshold: 1,
      },
      logging: {
        driver: "json-file",
        options: {},
      },
      security: {
        privileged: false,
      },
      labels: labels || { app: `app-${appId}` },
      annotations: annotations || {},
    };

    // 3. Launch container
    const createResult = await containerBuilderService.createContainer(containerSpec, orgId);

    if (!createResult.success) {
      // Release port on failure
      await portManagerService.releasePort(instanceId);
      return res.status(500).json({ error: createResult.error });
    }

    logger.info(`Container ${createResult.containerId} launched successfully on port ${portAllocation.port}`);

    return res.status(201).json({
      success: true,
      containerId: createResult.containerId,
      port: portAllocation.port,
      status: createResult.status,
      duration: createResult.duration,
    });
  } catch (error: any) {
    logger.error(`Failed to allocate and launch: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/phase-1b/ports/allocate
 * Allocate a port for an instance
 */
router.post("/ports/allocate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId, instanceId, allocationType, reason } = req.body;
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;

    if (!orgId || !appId || !instanceId) {
      return res.status(400).json({ error: "orgId, appId, and instanceId are required" });
    }

    logger.info(`Allocating port for app ${appId}, instance ${instanceId}`);

    const result = await portManagerService.allocatePort({
      appId,
      instanceId,
      orgId,
      allocationType: allocationType || "dynamic",
      reason: reason || "manual_request",
      allocatedBy: req.user?.email || "system",
    });

    return res.status(201).json(result);
  } catch (error: any) {
    logger.error(`Failed to allocate port: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/phase-1b/ports/release
 * Release a port allocation
 */
router.post("/ports/release", requireAuth, async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.body;

    if (!instanceId) {
      return res.status(400).json({ error: "instanceId is required" });
    }

    logger.info(`Releasing port for instance ${instanceId}`);

    await portManagerService.releasePort(instanceId);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error(`Failed to release port: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/phase-1b/ports/status
 * Get port pool status for organization
 */
router.get("/ports/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const status = await portManagerService.getPoolStatus(orgId);

    return res.status(200).json(status);
  } catch (error: any) {
    logger.error(`Failed to get port status: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/phase-1b/ports/history/:appId
 * Get port allocation history for an app
 */
router.get("/ports/history/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = parseInt(req.params.appId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 10;

    if (!appId || isNaN(appId)) {
      return res.status(400).json({ error: "Invalid appId" });
    }

    const history = await portManagerService.getAllocationHistory(appId, limit);

    return res.status(200).json(history);
  } catch (error: any) {
    logger.error(`Failed to get port history: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/phase-1b/containers/shutdown
 * Gracefully shutdown a container
 */
router.post("/containers/shutdown", requireAuth, async (req: Request, res: Response) => {
  try {
    const { instanceId, timeoutSeconds } = req.body;

    if (!instanceId) {
      return res.status(400).json({ error: "instanceId is required" });
    }

    logger.info(`Shutting down container for instance ${instanceId}`);

    await containerBuilderService.shutdownContainer(instanceId, timeoutSeconds || 30);

    // Release associated port
    await portManagerService.releasePort(instanceId);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error(`Failed to shutdown container: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/phase-1b/containers/create
 * Create a container from specification
 */
router.post("/containers/create", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId, instanceId, containerSpec } = req.body;
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;

    if (!orgId || !appId || !instanceId || !containerSpec) {
      return res.status(400).json({ error: "orgId, appId, instanceId, and containerSpec are required" });
    }

    logger.info(`Creating container for app ${appId}, instance ${instanceId}`);

    const result = await containerBuilderService.createContainer(
      { ...containerSpec, appId, instanceId },
      orgId
    );

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    return res.status(201).json(result);
  } catch (error: any) {
    logger.error(`Failed to create container: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/phase-1b/diagnostics/conflicts
 * Detect and report port conflicts
 */
router.get("/diagnostics/conflicts", requireAuth, async (req: Request, res: Response) => {
  try {
    const conflictCount = await portManagerService.detectConflicts();

    return res.status(200).json({
      conflictCount,
      timestamp: new Date(),
    });
  } catch (error: any) {
    logger.error(`Failed to detect conflicts: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
