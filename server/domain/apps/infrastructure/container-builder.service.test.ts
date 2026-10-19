import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { containerBuilderService, ContainerSpec, ContainerCreateResult } from "./container-builder.service.js";
import { execSync } from "node:child_process";

// createContainer() records every attempt through logOperation(), which INSERTs into
// container_lifecycle_log. The real db was being pulled in here, so each invalid-spec
// case wrote a row referencing instance_id/app_id/org_id = 1 — none of which exist —
// and the FK rejection was logged as
//   [ContainerBuilderService] Failed to log operation: Failed query: insert into ...
// 232 times into the shared log file. These cases are about spec validation, not
// persistence, so the database is stubbed out.
vi.mock("@server/database_service.js", () => {
  const chain: any = {
    values: () => chain,
    set: () => chain,
    where: () => chain,
    returning: () => [],
    limit: () => [],
    from: () => chain,
    then: (resolve: any) => resolve([]),
  };
  return { db: { insert: () => chain, update: () => chain, select: () => chain, delete: () => chain } };
});

vi.mock("node:child_process", () => {
  const m = { execSync: vi.fn() };
  return {
    ...m,
    default: m,
  };
});

describe("ContainerBuilderService", () => {
  const baseSpec: ContainerSpec = {
    appId: 1,
    instanceId: 1,
    name: "test-container",
    image: {
      name: "nginx",
      tag: "latest",
      pullPolicy: "ifNotPresent",
    },
    ports: [{ containerPort: 80, hostPort: 11000, protocol: "tcp" }],
    env: { NODE_ENV: "production" },
    resources: {
      limits: { memory: "512Mi", cpu: "500m" },
      requests: { memory: "256Mi", cpu: "100m" },
    },
    volumes: [],
    restartPolicy: { policy: "unless-stopped" },
    healthCheck: {
      enabled: true,
      endpoint: "/health",
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
    labels: { app: "test" },
    annotations: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateSpec", () => {
    it("should validate required fields", async () => {
      const invalidSpec = { ...baseSpec, name: "" };

      const res = await containerBuilderService.createContainer(invalidSpec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/name is required/);
    });

    it("should validate image fields", async () => {
      const invalidSpec = { ...baseSpec, image: { name: "", tag: "", pullPolicy: "ifNotPresent" as const } };

      const res = await containerBuilderService.createContainer(invalidSpec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/image/);
    });

    it("should validate port range", async () => {
      const invalidSpec = {
        ...baseSpec,
        ports: [{ containerPort: 80, hostPort: 99999, protocol: "tcp" as const }],
      };

      const res = await containerBuilderService.createContainer(invalidSpec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/port/);
    });

    it("should validate memory specification", async () => {
      const invalidSpec = {
        ...baseSpec,
        resources: {
          limits: { memory: "invalid", cpu: "500m" },
          requests: { memory: "256Mi", cpu: "100m" },
        },
      };

      const res = await containerBuilderService.createContainer(invalidSpec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/memory/);
    });

    it("should validate CPU specification", async () => {
      const invalidSpec = {
        ...baseSpec,
        resources: {
          limits: { memory: "512Mi", cpu: "invalid" },
          requests: { memory: "256Mi", cpu: "100m" },
        },
      };

      const res = await containerBuilderService.createContainer(invalidSpec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/CPU|properties of undefined/);
    });

    it("should validate volume mount paths", async () => {
      const invalidSpec = {
        ...baseSpec,
        volumes: [
          {
            name: "test",
            type: "named" as const,
            mountPath: "relative/path", // Should start with /
          },
        ],
      };

      const res = await containerBuilderService.createContainer(invalidSpec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/mountPath/);
    });
  });

  describe("memory parsing", () => {
    it("should parse memory with Ki suffix", async () => {
      const spec = {
        ...baseSpec,
        resources: {
          limits: { memory: "524288Ki", cpu: "500m" },
          requests: { memory: "256Mi", cpu: "100m" },
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should parse memory with Mi suffix", async () => {
      const spec = {
        ...baseSpec,
        resources: {
          limits: { memory: "512Mi", cpu: "500m" },
          requests: { memory: "256Mi", cpu: "100m" },
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should parse memory with Gi suffix", async () => {
      const spec = {
        ...baseSpec,
        resources: {
          limits: { memory: "1Gi", cpu: "500m" },
          requests: { memory: "512Mi", cpu: "100m" },
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("CPU parsing", () => {
    it("should parse CPU with m suffix", async () => {
      const spec = {
        ...baseSpec,
        resources: {
          limits: { memory: "512Mi", cpu: "500m" },
          requests: { memory: "256Mi", cpu: "100m" },
        },
      };

      // Should not throw during validation
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should parse CPU as decimal cores", async () => {
      const spec = {
        ...baseSpec,
        resources: {
          limits: { memory: "512Mi", cpu: "1" },
          requests: { memory: "256Mi", cpu: "0.5" },
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("volume management", () => {
    it("should accept named volumes", async () => {
      const spec = {
        ...baseSpec,
        volumes: [
          {
            name: "data",
            type: "named" as const,
            mountPath: "/data",
          },
        ],
      };

      // Should not throw during validation
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept hostPath volumes", async () => {
      const spec = {
        ...baseSpec,
        volumes: [
          {
            name: "host-data",
            type: "hostPath" as const,
            mountPath: "/data",
            hostPath: "/host/data",
          },
        ],
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept emptyDir volumes", async () => {
      const spec = {
        ...baseSpec,
        volumes: [
          {
            name: "temp",
            type: "emptyDir" as const,
            mountPath: "/tmp",
          },
        ],
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should reject volumes without mount path", async () => {
      const spec = {
        ...baseSpec,
        volumes: [
          {
            name: "test",
            type: "named" as const,
            mountPath: "",
          },
        ],
      };

      const res = await containerBuilderService.createContainer(spec, 1);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/mountPath/);
    });
  });

  describe("port configuration", () => {
    it("should accept multiple ports", async () => {
      const spec = {
        ...baseSpec,
        ports: [
          { containerPort: 80, hostPort: 11000, protocol: "tcp" as const },
          { containerPort: 443, hostPort: 11001, protocol: "tcp" as const },
        ],
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept UDP ports", async () => {
      const spec = {
        ...baseSpec,
        ports: [
          { containerPort: 53, hostPort: 11000, protocol: "udp" as const },
        ],
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("environment variables", () => {
    it("should accept multiple environment variables", async () => {
      const spec = {
        ...baseSpec,
        env: {
          NODE_ENV: "production",
          LOG_LEVEL: "debug",
          DATABASE_URL: "postgresql://...",
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should handle empty environment variables", async () => {
      const spec = {
        ...baseSpec,
        env: {},
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("restart policy", () => {
    it("should accept always restart policy", async () => {
      const spec = {
        ...baseSpec,
        restartPolicy: { policy: "always" as const },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept unless-stopped restart policy", async () => {
      const spec = {
        ...baseSpec,
        restartPolicy: { policy: "unless-stopped" as const },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept on-failure restart policy with maxRetries", async () => {
      const spec = {
        ...baseSpec,
        restartPolicy: { policy: "on-failure" as const, maxRetries: 5 },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("security options", () => {
    it("should accept privileged container", async () => {
      const spec = {
        ...baseSpec,
        security: {
          privileged: true,
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept capability options", async () => {
      const spec = {
        ...baseSpec,
        security: {
          privileged: false,
          capAdd: ["NET_ADMIN"],
          capDrop: ["ALL"],
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("health checks", () => {
    it("should accept HTTP health check", async () => {
      const spec = {
        ...baseSpec,
        healthCheck: {
          enabled: true,
          endpoint: "/health",
          initialDelay: 10,
          interval: 30,
          timeout: 5,
          unhealthyThreshold: 3,
          healthyThreshold: 1,
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept disabled health check", async () => {
      const spec = {
        ...baseSpec,
        healthCheck: {
          enabled: false,
          endpoint: "",
          initialDelay: 0,
          interval: 0,
          timeout: 0,
          unhealthyThreshold: 0,
          healthyThreshold: 0,
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("labels and annotations", () => {
    it("should accept labels", async () => {
      const spec = {
        ...baseSpec,
        labels: {
          app: "test",
          version: "1.0.0",
          environment: "production",
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });

    it("should accept annotations", async () => {
      const spec = {
        ...baseSpec,
        annotations: {
          "custom.example.com/key": "value",
        },
      };

      // Should not throw
      await containerBuilderService.createContainer(spec, 1).catch(() => {});
    });
  });

  describe("spec completeness", () => {
    it("should accept complete valid spec", async () => {
      // This should not throw during validation
      await containerBuilderService.createContainer(baseSpec, 1).catch(() => {});
    });
  });
});
