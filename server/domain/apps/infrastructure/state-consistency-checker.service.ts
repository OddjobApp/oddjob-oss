import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { redis } from "@server/domain/core/infrastructure/redis/redis-client.js";
import { appInstances, appDeployments, apps, orgs } from "@shared/schema/index.js";
import { stateConsistencyLog, consistencyRemediationConfig } from "@shared/schema/infrastructure/phase-1a.js";
import { eq, and, inArray } from "drizzle-orm";
import { localProcessService } from "./local-process.service.js";
import { appRegistryService } from "../app-registry.service.js";
import { alerts } from "@shared/schema/alerts.js";

const execAsync = promisify(exec);
const logger = createLogger("ConsistencyChecker");

export enum DivergenceType {
  NONE = 'none',
  CONTAINER_MISSING = 'container_missing',
  STATE_MISMATCH = 'state_mismatch',
  PORT_CONFLICT = 'port_conflict',
  ID_MISMATCH = 'id_mismatch',
  ZOMBIE_PROCESS = 'zombie_process',
}

export interface DbInstanceState {
  instanceId: number;
  appId: number;
  orgId: number;
  containerId: string;
  port: number;
  status: 'starting' | 'running' | 'unhealthy' | 'stopped';
  lastHeartbeat: Date;
}

export interface DockerContainerState {
  exists: boolean;
  containerId?: string;
  running: boolean;
  exitCode?: number;
  lastError?: string;
  uptime?: number;
}

export interface ConsistencyCheckResult {
  instanceId: number;
  dbState: DbInstanceState;
  dockerState: DockerContainerState;
  divergenceType: DivergenceType;
  divergenceDetails: Record<string, any>;
  
  remediationAttempted: boolean;
  remediationAction?: 'restart' | 'recreate' | 'force_stop' | 'cleanup';
  remediationSuccess?: boolean;
  remediationError?: string;
  
  outcome: 'healthy' | 'divergent' | 'unrecoverable';
  alertSent: boolean;
  checkTime: Date;
}

export interface RemediationConfig {
  orgId: number;
  autoRemediateEnabled: boolean;
  remediateMissingContainer: boolean;
  remediateStateMismatch: boolean;
  remediatePortConflict: boolean;
  restartStrategy: 'graceful' | 'force' | 'recreate';
  restartTimeoutSeconds: number;
  maxRestartAttempts: number;
  alertOnDivergence: boolean;
  alertChannels: string;
  alertSeverity: 'info' | 'warning' | 'critical';
}

class AlertService {
  async sendAlert(params: {
    severity: string;
    title: string;
    message: string;
    channels: string;
    metadata: any;
    orgId: number;
  }) {
    const severityMap: Record<string, string> = {
      info: "info",
      warning: "warning",
      critical: "critical",
    };
    const severity = severityMap[params.severity] || "warning";

    try {
      await db.insert(alerts).values({
        severity,
        category: "system",
        message: `${params.title}: ${params.message}`,
        details: params.metadata || {},
        organizationId: params.orgId,
      });
      logger.warn(`[AlertService] Alert logged: [${severity.toUpperCase()}] ${params.title} - ${params.message}`);
    } catch (err: any) {
      logger.error(`[AlertService] Failed to write alert: ${err.message}`);
    }
  }
}

export const alertService = new AlertService();

export class ConsistencyCheckerService {
  private isRunning = false;
  private checkInterval = 30000; // 30 seconds
  private lockKey = 'consistency:checker:lock';
  private lockTTL = 60; // seconds
  private timer: NodeJS.Timeout | null = null;

  constructor() {}

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Consistency checker already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting consistency checker background task');

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        const lockAcquired = await this.acquireLock();
        if (!lockAcquired) {
          logger.debug('Could not acquire lock, skipping this consistency check sweep');
          return;
        }

        try {
          const startTime = Date.now();
          const results = await this.performChecks();
          const duration = Date.now() - startTime;

          await this.recordMetrics(results, duration);

          const summary = this.summarizeResults(results);
          if (summary.divergent > 0 || summary.unrecoverable > 0) {
            logger.warn(`Consistency check completed: ${summary.healthy} healthy, ${summary.divergent} divergent, ${summary.unrecoverable} unrecoverable (${duration}ms)`);
          } else {
            logger.info(`Consistency check completed: all ${summary.healthy} active instances healthy (${duration}ms)`);
          }
        } finally {
          await this.releaseLock();
        }
      } catch (error: any) {
        logger.error(`Consistency check sweep failed: ${error.message}`, error);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(loop, this.checkInterval);
        }
      }
    };

    this.timer = setTimeout(loop, 1000); // Initial start
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Stopped consistency checker background task');
  }

  private async acquireLock(): Promise<boolean> {
    try {
      const result = await redis.set(this.lockKey, '1', 'EX', this.lockTTL, 'NX');
      return result === 'OK';
    } catch (err: any) {
      logger.warn(`Redis lock acquire failed: ${err.message}`);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await redis.del(this.lockKey);
    } catch (err: any) {
      logger.warn(`Redis lock release failed: ${err.message}`);
    }
  }

  // ── Flap protection ──────────────────────────────────────────────────────
  // Tracks how many times we've restarted an instance within a rolling window so a
  // crash-looping instance isn't restarted every sweep forever. All Redis calls
  // fail OPEN (treat as 0 / no-op) — a Redis outage must never disable self-healing.

  private restartAttemptsKey(instanceId: number): string {
    return `consistency:restart-attempts:${instanceId}`;
  }

  private async getRestartAttempts(instanceId: number): Promise<number> {
    try {
      const v = await redis.get(this.restartAttemptsKey(instanceId));
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (err: any) {
      logger.warn(`Failed to read restart attempts for instance ${instanceId}: ${err.message}`);
      return 0;
    }
  }

  private async incrementRestartAttempts(instanceId: number, windowSeconds: number): Promise<number> {
    try {
      const key = this.restartAttemptsKey(instanceId);
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      return count;
    } catch (err: any) {
      logger.warn(`Failed to record restart attempt for instance ${instanceId}: ${err.message}`);
      return 0;
    }
  }

  private async resetRestartAttempts(instanceId: number): Promise<void> {
    try {
      await redis.del(this.restartAttemptsKey(instanceId));
    } catch {
      // best-effort — a stale counter simply expires via its TTL
    }
  }

  async performChecks(): Promise<ConsistencyCheckResult[]> {
    const results: ConsistencyCheckResult[] = [];
    const instances = await this.getActiveInstances();

    for (const instance of instances) {
      try {
        const result = await this.checkInstance(instance);
        results.push(result);
      } catch (error: any) {
        logger.error(`Error checking instance ${instance.instanceId}: ${error.message}`);
      }
    }
    return results;
  }

  private async getActiveInstances(): Promise<DbInstanceState[]> {
    const rows = await db
      .select({
        instanceId: appInstances.id,
        appId: apps.id,
        orgId: apps.organizationId,
        containerId: appInstances.containerId,
        port: appInstances.port,
        status: appInstances.status,
        lastHeartbeat: appInstances.lastHeartbeatAt,
      })
      .from(appInstances)
      .innerJoin(appDeployments, eq(appInstances.deploymentId, appDeployments.id))
      .innerJoin(apps, eq(appDeployments.appId, apps.id))
      .where(
        and(
          eq(apps.status, "active"),
          inArray(appInstances.status, ["running", "starting", "unhealthy"])
        )
      );

    return rows
      .filter((r): r is typeof r & { orgId: number } => r.orgId !== null)
      .map(r => ({
        instanceId: r.instanceId,
        appId: r.appId,
        orgId: r.orgId,
        containerId: r.containerId,
        port: r.port,
        status: r.status as any,
        lastHeartbeat: r.lastHeartbeat,
      }));
  }

  private async getDockerContainerState(containerId: string): Promise<DockerContainerState> {
    try {
      const { stdout } = await execAsync(`docker inspect --format="{{.State.Running}},{{.State.ExitCode}}" ${containerId}`, { timeout: 10000 });
      const [runningStr, exitCodeStr] = stdout.trim().split(",");
      const running = runningStr === "true";
      const exitCode = exitCodeStr ? parseInt(exitCodeStr, 10) : undefined;
      return {
        exists: true,
        containerId: containerId.substring(0, 12),
        running,
        exitCode,
      };
    } catch (error: any) {
      return {
        exists: false,
        running: false,
        lastError: error.message,
      };
    }
  }

  private async getProcessState(containerId: string): Promise<DockerContainerState> {
    const running = await localProcessService.isProcessRunning(containerId);
    return {
      exists: running,
      running,
    };
  }

  detectDivergence(
    dbState: DbInstanceState,
    dockerState: DockerContainerState
  ): { type: DivergenceType; details: Record<string, any> } {
    const shouldBeRunning = ["running", "starting"].includes(dbState.status);

    if (!dockerState.exists) {
      if (shouldBeRunning) {
        return {
          type: DivergenceType.CONTAINER_MISSING,
          details: {
            expected: dbState.status,
            actual: 'missing',
            lastHeartbeat: dbState.lastHeartbeat,
          },
        };
      }
      return { type: DivergenceType.NONE, details: {} };
    }

    if (shouldBeRunning && !dockerState.running) {
      return {
        type: DivergenceType.STATE_MISMATCH,
        details: {
          dbStatus: dbState.status,
          actual: 'stopped',
          exitCode: dockerState.exitCode,
        },
      };
    }

    if (dbState.status === "stopped" && dockerState.running) {
      return {
        type: DivergenceType.STATE_MISMATCH,
        details: {
          dbStatus: 'stopped',
          actual: 'running',
        },
      };
    }

    if (dockerState.running && dockerState.exitCode !== undefined && dockerState.exitCode !== 0) {
      return {
        type: DivergenceType.ZOMBIE_PROCESS,
        details: {
          exitCode: dockerState.exitCode,
        },
      };
    }

    return { type: DivergenceType.NONE, details: {} };
  }

  async checkInstance(dbInstance: DbInstanceState): Promise<ConsistencyCheckResult> {
    const checkTime = new Date();

    let state: DockerContainerState;
    // Local Forge processes and Docker containers intentionally share the
    // `oddjob-app-*` naming convention. Check the in-process registry first;
    // otherwise healthy local Next.js apps are mistaken for missing Docker
    // containers and forced into an endless unhealthy/restart loop.
    const isLocalProcess = await localProcessService.isProcessRunning(dbInstance.containerId);
    if (isLocalProcess) {
      state = await this.getProcessState(dbInstance.containerId);
    } else {
      state = await this.getDockerContainerState(dbInstance.containerId);
    }

    const divergence = this.detectDivergence(dbInstance, state);

    let result: ConsistencyCheckResult = {
      instanceId: dbInstance.instanceId,
      dbState: dbInstance,
      dockerState: state,
      divergenceType: divergence.type,
      divergenceDetails: divergence.details,
      remediationAttempted: false,
      outcome: divergence.type === DivergenceType.NONE ? 'healthy' : 'divergent',
      alertSent: false,
      checkTime,
    };

    if (divergence.type !== DivergenceType.NONE) {
      const config = await this.getRemediationConfig(dbInstance.orgId);
      if (config.autoRemediateEnabled && this.isRemediable(divergence.type, config)) {
        const windowSeconds = Math.max(300, config.restartTimeoutSeconds * config.maxRestartAttempts * 2);
        const priorAttempts = await this.getRestartAttempts(dbInstance.instanceId);

        if (priorAttempts >= config.maxRestartAttempts) {
          // Flap protection: an instance that keeps diverging after repeated restarts is
          // NOT restarted again until the window expires. Restarting a crash-looping
          // instance every 30s masks the real fault, churns ports/resources, and never
          // converges. Surface it as unrecoverable so it alerts and a human looks.
          result.remediationAttempted = false;
          result.remediationSuccess = false;
          result.remediationError = `Flap protection: ${priorAttempts} restart attempts within ${windowSeconds}s (max ${config.maxRestartAttempts}); paused until cooldown`;
          result.outcome = 'unrecoverable';
          result.divergenceDetails = { ...result.divergenceDetails, flapping: true, restartAttempts: priorAttempts };
          logger.error(`[Remediation] Flap protection engaged for instance ${dbInstance.instanceId}: ${priorAttempts} attempts >= max ${config.maxRestartAttempts}. Not restarting.`);
        } else {
          result.remediationAttempted = true;
          result.remediationAction = divergence.type === DivergenceType.CONTAINER_MISSING ? 'recreate' : 'restart';

          try {
            logger.info(`[Remediation] Attempting auto-remediation (${result.remediationAction}) for instance ${dbInstance.instanceId} (attempt ${priorAttempts + 1}/${config.maxRestartAttempts})`);

            if (result.remediationAction === 'recreate') {
              await appRegistryService.startApp(dbInstance.appId, dbInstance.orgId);
            } else {
              await appRegistryService.decommissionInstance(dbInstance.instanceId);
              await appRegistryService.startApp(dbInstance.appId, dbInstance.orgId);
            }
            result.remediationSuccess = true;
            result.outcome = 'healthy';
          } catch (err: any) {
            result.remediationSuccess = false;
            result.remediationError = err.message;
            result.outcome = 'unrecoverable';
            logger.error(`[Remediation] Auto-remediation failed for instance ${dbInstance.instanceId}: ${err.message}`);
          }

          // Count the attempt regardless of apparent success — a "successful" restart that
          // diverges again next sweep is exactly the flapping we want to catch. The counter
          // is cleared only when a sweep observes the instance actually healthy (else branch).
          const attemptCount = await this.incrementRestartAttempts(dbInstance.instanceId, windowSeconds);
          result.divergenceDetails = { ...result.divergenceDetails, restartAttempts: attemptCount };
        }
      }
    } else {
      // Healthy sweep — clear the flap counter so transient blips don't accumulate.
      await this.resetRestartAttempts(dbInstance.instanceId);
    }

    await this.logAuditEvent(result);

    if (result.outcome !== 'healthy') {
      const config = await this.getRemediationConfig(dbInstance.orgId);
      if (config.alertOnDivergence) {
        await alertService.sendAlert({
          severity: config.alertSeverity,
          title: `State Divergence [${divergence.type}]`,
          message: `App instance ${dbInstance.instanceId} status is divergent: ${JSON.stringify(divergence.details)}`,
          channels: config.alertChannels,
          metadata: {
            divergenceType: result.divergenceType,
            divergenceDetails: result.divergenceDetails,
            remediationAttempted: result.remediationAttempted,
            remediationSuccess: result.remediationSuccess,
            remediationError: result.remediationError,
          },
          orgId: dbInstance.orgId,
        });
        result.alertSent = true;
      }
    }

    return result;
  }

  private isRemediable(type: DivergenceType, config: RemediationConfig): boolean {
    if (type === DivergenceType.CONTAINER_MISSING) return config.remediateMissingContainer;
    if (type === DivergenceType.STATE_MISMATCH) return config.remediateStateMismatch;
    if (type === DivergenceType.PORT_CONFLICT) return config.remediatePortConflict;
    return false;
  }

  private async logAuditEvent(result: ConsistencyCheckResult): Promise<void> {
    try {
      await db.insert(stateConsistencyLog).values({
        instanceId: result.instanceId,
        checkTimestamp: result.checkTime,
        dbStatus: result.dbState.status,
        dbContainerId: result.dbState.containerId,
        dbPort: result.dbState.port,
        dockerExists: result.dockerState.exists,
        dockerRunning: result.dockerState.running,
        dockerContainerId: result.dockerState.containerId,
        dockerExitCode: result.dockerState.exitCode,
        dockerLastError: result.dockerState.lastError,
        divergenceType: result.divergenceType,
        divergenceDetails: result.divergenceDetails,
        remediationAttempted: result.remediationAttempted,
        remediationAction: result.remediationAction,
        remediationSuccess: result.remediationSuccess,
        remediationError: result.remediationError,
        outcome: result.outcome,
        alertSent: result.alertSent,
        orgId: result.dbState.orgId,
        appId: result.dbState.appId,
      });
    } catch (err: any) {
      logger.error(`Failed to write state consistency log row: ${err.message}`);
    }
  }

  private async recordMetrics(results: ConsistencyCheckResult[], duration: number): Promise<void> {
    try {
      const summary = this.summarizeResults(results);
      await redis.setex(
        'consistency:latest-check',
        300,
        JSON.stringify({
          timestamp: new Date(),
          duration,
          healthy: summary.healthy,
          divergent: summary.divergent,
          unrecoverable: summary.unrecoverable,
          total: summary.total,
        })
      );
      await redis.incr('consistency:total-checks');
      if (summary.divergent > 0) {
        await redis.incr('consistency:divergences-detected');
      }
    } catch (err: any) {
      logger.warn(`Failed to record Redis metrics: ${err.message}`);
    }
  }

  private summarizeResults(results: ConsistencyCheckResult[]): {
    healthy: number;
    divergent: number;
    unrecoverable: number;
    total: number;
  } {
    return {
      healthy: results.filter(r => r.outcome === 'healthy').length,
      divergent: results.filter(r => r.outcome === 'divergent').length,
      unrecoverable: results.filter(r => r.outcome === 'unrecoverable').length,
      total: results.length,
    };
  }

  private async getRemediationConfig(orgId: number): Promise<RemediationConfig> {
    try {
      const [config] = await db
        .select()
        .from(consistencyRemediationConfig)
        .where(eq(consistencyRemediationConfig.orgId, orgId))
        .limit(1);

      if (config) {
        return {
          orgId: config.orgId,
          autoRemediateEnabled: config.autoRemediateEnabled,
          remediateMissingContainer: config.remediateMissingContainer,
          remediateStateMismatch: config.remediateStateMismatch,
          remediatePortConflict: config.remediatePortConflict,
          restartStrategy: config.restartStrategy as any,
          restartTimeoutSeconds: config.restartTimeoutSeconds,
          maxRestartAttempts: config.maxRestartAttempts,
          alertOnDivergence: config.alertOnDivergence,
          alertChannels: config.alertChannels,
          alertSeverity: config.alertSeverity as any,
        };
      }
    } catch (err: any) {
      logger.error(`Failed to fetch remediation config for org ${orgId}: ${err.message}`);
    }

    return {
      orgId,
      autoRemediateEnabled: true,
      remediateMissingContainer: true,
      remediateStateMismatch: true,
      remediatePortConflict: false,
      restartStrategy: 'graceful',
      restartTimeoutSeconds: 30,
      maxRestartAttempts: 3,
      alertOnDivergence: true,
      alertChannels: 'slack',
      alertSeverity: 'warning',
    };
  }
}

export const consistencyCheckerService = new ConsistencyCheckerService();
