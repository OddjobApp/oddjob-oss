import { execSync } from "node:child_process";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { redis } from "@server/domain/core/infrastructure/redis/redis-client.js";
import * as schema from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("ContainerBuilderService");

/**
 * Container specification interface
 */
export interface ContainerSpec {
  appId: number;
  instanceId: number;
  name: string;
  image: {
    registry?: string;
    name: string;
    tag: string;
    pullPolicy: "always" | "ifNotPresent" | "never";
    digest?: string;
  };
  ports: { containerPort: number; hostPort: number; protocol: "tcp" | "udp" }[];
  env: Record<string, string>;
  resources: {
    limits: { memory: string; cpu: string };
    requests: { memory: string; cpu: string };
  };
  volumes: {
    name: string;
    type: "emptyDir" | "hostPath" | "named";
    mountPath: string;
    hostPath?: string;
    volumeName?: string;
    readOnly?: boolean;
  }[];
  restartPolicy: { policy: "always" | "unless-stopped" | "on-failure" | "no"; maxRetries?: number };
  healthCheck: {
    enabled: boolean;
    endpoint: string;
    initialDelay: number;
    interval: number;
    timeout: number;
    unhealthyThreshold: number;
    healthyThreshold: number;
  };
  logging: {
    driver: "json-file" | "syslog" | "awslogs";
    options: Record<string, string>;
    maxSize?: string;
    maxFile?: number;
  };
  security: {
    privileged: boolean;
    capAdd?: string[];
    capDrop?: string[];
  };
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface ContainerCreateResult {
  success: boolean;
  containerId?: string;
  status?: string;
  duration?: number;
  error?: string;
}

class ContainerBuilderService {
  private imageCache = new Map<string, { digest: string; pulledAt: Date }>();

  /**
   * Create a container from specification
   */
  async createContainer(spec: ContainerSpec, orgId: number): Promise<ContainerCreateResult> {
    const startTime = Date.now();
    const operationId = `create-${spec.instanceId}-${Date.now()}`;

    try {
      logger.info(`[${operationId}] Starting container creation for app ${spec.appId}`);

      // 1. Validate specification
      await this.validateSpec(spec);
      logger.debug(`[${operationId}] Spec validation passed`);

      // 2. Prepare image
      const imageRef = await this.prepareImage(spec.image);
      logger.debug(`[${operationId}] Image prepared: ${imageRef}`);

      // 3. Create volumes
      const volumes = await this.createVolumes(spec, orgId);
      logger.debug(`[${operationId}] Created ${volumes.length} volumes`);

      // 4. Build Docker config
      const dockerConfig = this.buildDockerConfig(spec, imageRef, volumes);

      // 5. Create and start container using Docker CLI
      const containerId = await this.createAndStartContainer(spec.name, dockerConfig);
      logger.info(`[${operationId}] Container created and started: ${containerId}`);

      // 6. Verify startup
      await this.verifyStartup(spec, containerId);
      logger.info(`[${operationId}] Container verified healthy: ${containerId}`);

      // 7. Register in database
      await db.update(schema.appInstances)
        .set({
          containerId,
          status: "running",
          lastHeartbeatAt: new Date()
        })
        .where(eq(schema.appInstances.id, spec.instanceId));

      const duration = Date.now() - startTime;

      // Log operation
      await this.logOperation({
        operationId,
        instanceId: spec.instanceId,
        appId: spec.appId,
        orgId,
        operation: "create",
        containerId,
        status: "success",
        duration,
        imageName: spec.image.name,
        imageTag: spec.image.tag,
      });

      return {
        success: true,
        containerId,
        status: "running",
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error(`[${operationId}] Container creation failed: ${error.message}`);

      // Attempt cleanup
      try {
        await this.cleanupFailedCreation(spec);
      } catch (cleanupError: any) {
        logger.warn(`[${operationId}] Cleanup failed: ${cleanupError.message}`);
      }

      // Log failed operation
      await this.logOperation({
        operationId,
        instanceId: spec.instanceId,
        appId: spec.appId,
        orgId,
        operation: "create",
        status: "failed",
        duration,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        duration,
      };
    }
  }

  /**
   * Validate container specification
   */
  private async validateSpec(spec: ContainerSpec): Promise<void> {
    const errors: string[] = [];

    if (!spec.name) errors.push("name is required");
    if (!spec.image?.name) errors.push("image.name is required");
    if (!spec.image?.tag) errors.push("image.tag is required");
    if (!spec.ports || spec.ports.length === 0) errors.push("ports is required");

    // Resource limits validation
    if (spec.resources?.limits) {
      const memory = this.parseMemory(spec.resources.limits.memory);
      const cpu = this.parseCpu(spec.resources.limits.cpu);

      if (memory === null) errors.push(`Invalid memory limit: ${spec.resources.limits.memory}`);
      if (cpu === null) errors.push(`Invalid CPU limit: ${spec.resources.limits.cpu}`);

      if (memory && memory > 32768) errors.push("Memory limit exceeds 32GB");
      if (cpu && cpu > 16000) errors.push("CPU limit exceeds 16 cores");
    }

    // Port validation
    for (const port of spec.ports) {
      if (port.hostPort < 1024 || port.hostPort > 65535) {
        errors.push(`Invalid host port: ${port.hostPort}`);
      }
      if (port.containerPort < 1 || port.containerPort > 65535) {
        errors.push(`Invalid container port: ${port.containerPort}`);
      }
    }

    // Volume validation
    for (const volume of spec.volumes || []) {
      if (!volume.name) errors.push("Volume name is required");
      if (!volume.mountPath) errors.push("Volume mountPath is required");
      if (!volume.mountPath.startsWith("/")) {
        errors.push(`Invalid mountPath: ${volume.mountPath} (must be absolute)`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Spec validation failed:\n${errors.join("\n")}`);
    }
  }

  /**
   * Prepare image (pull if needed, validate digest)
   */
  private async prepareImage(imageConfig: ContainerSpec["image"]): Promise<string> {
    const imageRef = imageConfig.digest
      ? `${imageConfig.name}@${imageConfig.digest}`
      : `${imageConfig.name}:${imageConfig.tag}`;

    // Check cache first
    if (this.imageCache.has(imageRef)) {
      logger.debug(`Image found in cache: ${imageRef}`);
      return imageRef;
    }

    // Check if image exists locally
    const exists = await this.imageExists(imageRef);
    if (exists && imageConfig.pullPolicy === "ifNotPresent") {
      logger.debug(`Image exists locally: ${imageRef}`);
      this.imageCache.set(imageRef, { digest: imageConfig.digest || "", pulledAt: new Date() });
      return imageRef;
    }

    // Pull image
    if (imageConfig.pullPolicy !== "never") {
      logger.info(`Pulling image: ${imageRef}`);
      await this.pullImage(imageRef);
      logger.info(`Image pulled successfully: ${imageRef}`);
      this.imageCache.set(imageRef, { digest: imageConfig.digest || "", pulledAt: new Date() });
    }

    return imageRef;
  }

  /**
   * Create volumes as specified
   */
  private async createVolumes(spec: ContainerSpec, orgId: number): Promise<string[]> {
    const createdVolumes: string[] = [];

    for (const volumeSpec of spec.volumes || []) {
      try {
        if (volumeSpec.type === "named") {
          // Create named volume
          await this.createVolume(volumeSpec.name);
          createdVolumes.push(volumeSpec.name);

          // Register in database
          await db.insert(schema.containerVolumes).values({
            instanceId: spec.instanceId,
            volumeName: volumeSpec.name,
            volumeType: "named",
            mountPath: volumeSpec.mountPath,
            orgId,
            appId: spec.appId,
          });
        }
      } catch (error: any) {
        logger.error(`Failed to create volume ${volumeSpec.name}: ${error.message}`);
        throw error;
      }
    }

    return createdVolumes;
  }

  /**
   * Build Docker API config from ContainerSpec
   */
  private buildDockerConfig(spec: ContainerSpec, imageRef: string, _createdVolumes: string[]): Record<string, any> {
    const env = Object.entries(spec.env).map(([key, value]) => `${key}=${value}`);
    const restartPolicy =
      spec.restartPolicy.policy === "no" ? "no" : spec.restartPolicy.policy || "unless-stopped";

    const config: Record<string, any> = {
      name: spec.name,
      image: imageRef,
      env,
      labels: spec.labels || {},
      hostConfig: {
        restartPolicy: {
          name: restartPolicy,
          maxRetries: spec.restartPolicy.maxRetries || 0,
        },
        portBindings: {},
        binds: [],
      },
    };

    // Configure ports
    for (const port of spec.ports) {
      const containerPort = `${port.containerPort}/${port.protocol || "tcp"}`;
      config.hostConfig.portBindings[containerPort] = [
        { hostIp: "0.0.0.0", hostPort: String(port.hostPort) },
      ];
    }

    // Configure volumes
    for (const volume of spec.volumes || []) {
      if (volume.type === "hostPath" && volume.hostPath) {
        config.hostConfig.binds.push(
          `${volume.hostPath}:${volume.mountPath}${volume.readOnly ? ":ro" : ""}`
        );
      }
    }

    return config;
  }

  /**
   * Create and start container using Docker CLI
   */
  private async createAndStartContainer(
    name: string,
    config: Record<string, any>
  ): Promise<string> {
    // Simplified: use docker CLI (in production would use Docker API client)
    const envStr = config.env.map((e: string) => `-e '${e}'`).join(" ");
    const portStr = Object.entries(config.hostConfig.portBindings)
      .map(([containerPort, bindings]: any) => {
        const binding = bindings[0];
        const containerPortNum = containerPort.split("/")[0];
        return `-p ${binding.hostPort}:${containerPortNum}`;
      })
      .join(" ");

    const bindsStr = config.hostConfig.binds.map((b: string) => `-v '${b}'`).join(" ");

    const restartPolicy = `--restart=${config.hostConfig.restartPolicy.name}`;

    const cmd = `docker run -d --name '${name}' ${envStr} ${portStr} ${bindsStr} ${restartPolicy} '${config.image}'`;

    logger.debug(`Executing: ${cmd}`);

    try {
      const output = execSync(cmd, { encoding: "utf-8" });
      return output.trim(); // Returns container ID
    } catch (error: any) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  /**
   * Verify container started successfully
   */
  private async verifyStartup(_spec: ContainerSpec, containerId: string): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check if container is running
        const output = execSync(`docker inspect -f '{{.State.Running}}' '${containerId}'`, {
          encoding: "utf-8",
        });
        if (output.trim() === "true") {
          logger.debug(`Container verified running on attempt ${attempt + 1}`);
          return;
        }
      } catch (error: any) {
        if (attempt < maxAttempts - 1) {
          await this.sleep(delayMs);
        } else {
          throw new Error(
            `Container failed to start after ${maxAttempts} attempts: ${error.message}`
          );
        }
      }
    }
  }

  /**
   * Gracefully shutdown container
   */
  async shutdownContainer(instanceId: number, timeoutSeconds: number = 30): Promise<void> {
    const instances = await db
      .select()
      .from(schema.appInstances)
      .where(eq(schema.appInstances.id, instanceId));

    if (instances.length === 0) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const containerId = instances[0].containerId;
    if (!containerId) {
      logger.warn(`Instance ${instanceId} has no container ID`);
      return;
    }

    try {
      logger.info(`Sending SIGTERM to container ${containerId}`);
      execSync(`docker stop --time ${timeoutSeconds} '${containerId}'`, { encoding: "utf-8" });

      // Remove container
      execSync(`docker rm '${containerId}'`, { encoding: "utf-8" });
      logger.info(`Container ${containerId} removed`);

      // Update database
      await db
        .update(schema.appInstances)
        .set({ status: "stopped", containerId: "" })
        .where(eq(schema.appInstances.id, instanceId));
    } catch (error: any) {
      logger.error(`Failed to shutdown container ${containerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper: Check if image exists locally
   */
  private async imageExists(imageRef: string): Promise<boolean> {
    try {
      execSync(`docker inspect --type=image '${imageRef}'`, { encoding: "utf-8" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Pull image
   */
  private async pullImage(imageRef: string): Promise<void> {
    try {
      execSync(`docker pull '${imageRef}'`, { encoding: "utf-8" });
    } catch (error: any) {
      throw new Error(`Failed to pull image ${imageRef}: ${error.message}`);
    }
  }

  /**
   * Helper: Create volume
   */
  private async createVolume(volumeName: string): Promise<void> {
    try {
      execSync(`docker volume create '${volumeName}'`, { encoding: "utf-8" });
    } catch (error: any) {
      // Volume might already exist - that's ok
      if (!error.message.includes("already exists")) {
        throw error;
      }
    }
  }

  /**
   * Parse memory string to MB
   */
  private parseMemory(str: string): number | null {
    const units: Record<string, number> = {
      Ki: 1 / 1024,
      K: 1 / 1024,
      Mi: 1,
      M: 1,
      Gi: 1024,
      G: 1024,
      Ti: 1024 * 1024,
      T: 1024 * 1024,
    };

    for (const [unit, multiplier] of Object.entries(units)) {
      if (str.endsWith(unit)) {
        const value = parseFloat(str.slice(0, -unit.length));
        return value * multiplier;
      }
    }

    return null;
  }

  /**
   * Parse CPU string to millicores
   */
  private parseCpu(str: string): number | null {
    if (str.endsWith("m")) {
      return parseFloat(str.slice(0, -1));
    }
    return parseFloat(str) * 1000;
  }

  /**
   * Log operation to database
   */
  private async logOperation(operation: {
    operationId: string;
    instanceId: number;
    appId: number;
    orgId: number;
    operation: string;
    containerId?: string;
    status: string;
    duration: number;
    imageName?: string;
    imageTag?: string;
    error?: string;
  }): Promise<void> {
    try {
      await db.insert(schema.containerLifecycleLog).values({
        instanceId: operation.instanceId,
        operation: operation.operation,
        containerId: operation.containerId,
        status: operation.status,
        durationMs: operation.duration,
        imageName: operation.imageName,
        imageTag: operation.imageTag,
        orgId: operation.orgId,
        appId: operation.appId,
        errorMessage: operation.error,
      });
    } catch (error: any) {
      logger.error(`Failed to log operation: ${error.message}`);
    }
  }

  /**
   * Cleanup failed creation
   */
  private async cleanupFailedCreation(spec: ContainerSpec): Promise<void> {
    // Delete created volumes
    for (const volume of spec.volumes || []) {
      if (volume.type === "named") {
        try {
          execSync(`docker volume rm '${volume.name}'`, { encoding: "utf-8" });
        } catch (error: any) {
          logger.warn(`Failed to cleanup volume ${volume.name}: ${error.message}`);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const containerBuilderService = new ContainerBuilderService();
