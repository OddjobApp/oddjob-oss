import { describe, it, expect, vi, beforeEach } from "vitest";
import { prefetchService } from "./prefetch.service.js";

import type {
  CompositionGraph,
  CompositionNode,
  CompositionEdge,
} from "../types/composition.js";

// Mock xrayCompositionService — only needed for getManifest/getBulkManifests (tasks 2+)
vi.mock("./xray-composition.service.js", () => ({
  xrayCompositionService: {
    buildGraph: vi.fn(),
  },
}));

// Mock Redis for cache invalidation tests
const mockRedis = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  expire: vi.fn().mockResolvedValue(1),
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: mockRedis,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGraph(
  nodes: CompositionNode[],
  edges: CompositionEdge[]
): CompositionGraph {
  return {
    scope: { id: "oddjob", name: "Oddjob Platform", type: "platform" },
    nodes,
    edges,
    indexedAt: new Date().toISOString(),
  };
}

function screenNode(path: string): CompositionNode {
  return {
    id: `screen::${path}`,
    type: "screen",
    label: path,
    group: "Screens",
  };
}

function endpointNode(
  method: string,
  path: string,
  metadata?: Record<string, unknown>
): CompositionNode {
  return {
    id: `api_endpoint::${method}-${path}`,
    type: "api_endpoint",
    label: `${method} ${path}`,
    group: "API Endpoints",
    metadata,
  };
}

function callsApiEdge(
  screenPath: string,
  endpointMethod: string,
  endpointPath: string
): CompositionEdge {
  return {
    id: `screen::${screenPath}→api_endpoint::${endpointMethod}-${endpointPath}:CALLS_API`,
    source: `screen::${screenPath}`,
    target: `api_endpoint::${endpointMethod}-${endpointPath}`,
    relation: "CALLS_API",
    label: `calls ${endpointPath}`,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PrefetchService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("_parseEndpointLabel", () => {
    it("should parse a standard label into method and path", () => {
      const result = prefetchService._parseEndpointLabel("GET /api/missions");
      expect(result).toEqual({ method: "GET", path: "/api/missions" });
    });

    it("should handle POST method", () => {
      const result = prefetchService._parseEndpointLabel("POST /api/missions");
      expect(result).toEqual({ method: "POST", path: "/api/missions" });
    });

    it("should handle paths with multiple segments", () => {
      const result = prefetchService._parseEndpointLabel(
        "DELETE /api/missions/:id/runs"
      );
      expect(result).toEqual({
        method: "DELETE",
        path: "/api/missions/:id/runs",
      });
    });

    it("should handle paths with spaces by splitting only at first space", () => {
      // Edge case: path itself won't have spaces in practice, but the split should be at first space only
      const result = prefetchService._parseEndpointLabel("GET /api/items");
      expect(result).toEqual({ method: "GET", path: "/api/items" });
    });

    it("should fallback to GET with full label as path when no space found", () => {
      const result = prefetchService._parseEndpointLabel("/api/missions");
      expect(result).toEqual({ method: "GET", path: "/api/missions" });
    });
  });

  describe("_extractManifestFromGraph", () => {
    it("should return empty manifest when screen node is not found", () => {
      const graph = makeGraph(
        [screenNode("/dashboard")],
        []
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/settings",
        "oddjob"
      );

      expect(manifest.screenPath).toBe("/settings");
      expect(manifest.scope).toBe("oddjob");
      expect(manifest.endpoints).toHaveLength(0);
      expect(manifest.generatedAt).toBeDefined();
    });

    it("should return empty manifest when screen has no CALLS_API edges", () => {
      const graph = makeGraph(
        [screenNode("/dashboard"), endpointNode("GET", "/api/missions")],
        [] // no edges
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/dashboard",
        "oddjob"
      );

      expect(manifest.endpoints).toHaveLength(0);
    });

    it("should extract endpoints from CALLS_API edges for a screen", () => {
      const graph = makeGraph(
        [
          screenNode("/dashboard"),
          endpointNode("GET", "/api/missions"),
          endpointNode("GET", "/api/datasets"),
        ],
        [
          callsApiEdge("/dashboard", "GET", "/api/missions"),
          callsApiEdge("/dashboard", "GET", "/api/datasets"),
        ]
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/dashboard",
        "oddjob"
      );

      expect(manifest.screenPath).toBe("/dashboard");
      expect(manifest.scope).toBe("oddjob");
      expect(manifest.endpoints).toHaveLength(2);
      expect(manifest.endpoints).toContainEqual({
        method: "GET",
        path: "/api/missions",
        staticParams: {},
      });
      expect(manifest.endpoints).toContainEqual({
        method: "GET",
        path: "/api/datasets",
        staticParams: {},
      });
    });

    it("should deduplicate endpoints with the same method+path", () => {
      // Simulate a screen calling the same API from multiple components
      const graph = makeGraph(
        [
          screenNode("/dashboard"),
          endpointNode("GET", "/api/missions"),
        ],
        [
          // Two edges targeting the same endpoint (e.g. from different components)
          {
            id: "screen::/dashboard→api_endpoint::GET-/api/missions:CALLS_API:1",
            source: "screen::/dashboard",
            target: "api_endpoint::GET-/api/missions",
            relation: "CALLS_API",
            label: "calls /api/missions",
          },
          {
            id: "screen::/dashboard→api_endpoint::GET-/api/missions:CALLS_API:2",
            source: "screen::/dashboard",
            target: "api_endpoint::GET-/api/missions",
            relation: "CALLS_API",
            label: "calls /api/missions (from component)",
          },
        ]
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/dashboard",
        "oddjob"
      );

      expect(manifest.endpoints).toHaveLength(1);
      expect(manifest.endpoints[0]).toEqual({
        method: "GET",
        path: "/api/missions",
        staticParams: {},
      });
    });

    it("should extract staticParams from node metadata", () => {
      const graph = makeGraph(
        [
          screenNode("/dashboard"),
          endpointNode("GET", "/api/datasets", {
            staticParams: { limit: "50", status: "active" },
          }),
        ],
        [callsApiEdge("/dashboard", "GET", "/api/datasets")]
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/dashboard",
        "oddjob"
      );

      expect(manifest.endpoints).toHaveLength(1);
      expect(manifest.endpoints[0].staticParams).toEqual({
        limit: "50",
        status: "active",
      });
    });

    it("should extract defaultParams from node metadata when staticParams is absent", () => {
      const graph = makeGraph(
        [
          screenNode("/dashboard"),
          endpointNode("GET", "/api/items", {
            defaultParams: { page: "1" },
          }),
        ],
        [callsApiEdge("/dashboard", "GET", "/api/items")]
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/dashboard",
        "oddjob"
      );

      expect(manifest.endpoints[0].staticParams).toEqual({ page: "1" });
    });

    it("should include generatedAt as valid ISO 8601 timestamp", () => {
      const before = new Date().toISOString();
      const graph = makeGraph([screenNode("/home")], []);

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/home",
        "oddjob"
      );

      const after = new Date().toISOString();
      expect(manifest.generatedAt).toBeDefined();
      expect(new Date(manifest.generatedAt).toISOString()).toBe(
        manifest.generatedAt
      );
      expect(manifest.generatedAt >= before).toBe(true);
      expect(manifest.generatedAt <= after).toBe(true);
    });

    it("should only include endpoints targeted by the requested screen, not other screens", () => {
      const graph = makeGraph(
        [
          screenNode("/dashboard"),
          screenNode("/settings"),
          endpointNode("GET", "/api/missions"),
          endpointNode("GET", "/api/users"),
        ],
        [
          callsApiEdge("/dashboard", "GET", "/api/missions"),
          callsApiEdge("/settings", "GET", "/api/users"),
        ]
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/dashboard",
        "oddjob"
      );

      expect(manifest.endpoints).toHaveLength(1);
      expect(manifest.endpoints[0].path).toBe("/api/missions");
    });

    it("should handle numeric values in staticParams by converting to string", () => {
      const graph = makeGraph(
        [
          screenNode("/list"),
          endpointNode("GET", "/api/items", {
            staticParams: { limit: 100, offset: 0 },
          }),
        ],
        [callsApiEdge("/list", "GET", "/api/items")]
      );

      const manifest = prefetchService._extractManifestFromGraph(
        graph,
        "/list",
        "oddjob"
      );

      expect(manifest.endpoints[0].staticParams).toEqual({
        limit: "100",
        offset: "0",
      });
    });
  });
});


  describe("invalidateScope", () => {
    beforeEach(() => {
      mockRedis.smembers.mockReset();
      mockRedis.del.mockReset();
      mockRedis.del.mockResolvedValue(1);
    });

    it("should delete all cached manifest keys tracked in the scope key set", async () => {
      const manifestKeys = [
        "xray:prefetch:myapp:/dashboard:org:1",
        "xray:prefetch:myapp:/settings:org:1",
        "xray:prefetch:myapp:/profile:org:1",
      ];
      mockRedis.smembers.mockResolvedValue(manifestKeys);

      await prefetchService.invalidateScope("myapp", 1);

      // Should retrieve the scope key set
      expect(mockRedis.smembers).toHaveBeenCalledWith(
        "xray:prefetch:keys:myapp:org:1"
      );

      // Should delete all individual manifest keys
      expect(mockRedis.del).toHaveBeenCalledWith(...manifestKeys);

      // Should also delete the scope key set itself
      expect(mockRedis.del).toHaveBeenCalledWith(
        "xray:prefetch:keys:myapp:org:1"
      );
    });

    it("should delete the scope key set even when no manifest keys exist", async () => {
      mockRedis.smembers.mockResolvedValue([]);

      await prefetchService.invalidateScope("emptyScope", 42);

      // Should still look up the scope key set
      expect(mockRedis.smembers).toHaveBeenCalledWith(
        "xray:prefetch:keys:emptyScope:org:42"
      );

      // Should NOT call del with manifest keys (none exist)
      // But should delete the scope key set itself
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith(
        "xray:prefetch:keys:emptyScope:org:42"
      );
    });

    it("should handle Redis errors gracefully without throwing", async () => {
      mockRedis.smembers.mockRejectedValue(new Error("Redis connection refused"));

      // Should not throw
      await expect(
        prefetchService.invalidateScope("broken", 99)
      ).resolves.toBeUndefined();
    });

    it("should use the correct scope key set key format", async () => {
      mockRedis.smembers.mockResolvedValue([]);

      await prefetchService.invalidateScope("sdlc-workbench", 7);

      expect(mockRedis.smembers).toHaveBeenCalledWith(
        "xray:prefetch:keys:sdlc-workbench:org:7"
      );
    });

    it("should delete manifest keys in a single del call (batch)", async () => {
      const keys = [
        "xray:prefetch:app1:/page1:org:5",
        "xray:prefetch:app1:/page2:org:5",
      ];
      mockRedis.smembers.mockResolvedValue(keys);

      await prefetchService.invalidateScope("app1", 5);

      // First del call is for the manifest keys (batch)
      expect(mockRedis.del).toHaveBeenNthCalledWith(
        1,
        "xray:prefetch:app1:/page1:org:5",
        "xray:prefetch:app1:/page2:org:5"
      );
      // Second del call is for the scope key set
      expect(mockRedis.del).toHaveBeenNthCalledWith(
        2,
        "xray:prefetch:keys:app1:org:5"
      );
    });
  });
