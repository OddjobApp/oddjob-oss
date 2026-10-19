/**
 * Property-based tests for PrefetchService.
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: prefetch-manifest-from-composition-graph
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { prefetchService } from "./prefetch.service.js";

import type {
  CompositionGraph,
  CompositionNode,
  CompositionEdge,
  CompositionScope,
} from "../types/composition.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("./xray-composition.service.js", () => ({
  xrayCompositionService: {
    buildGraph: vi.fn(),
  },
}));

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

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a scope string: non-empty, no colons (to avoid key delimiter collision) */
const scopeArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && !s.includes(":"));

/** Generate a screen path starting with "/" */
const screenPathArb = fc
  .array(
    fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
    { minLength: 1, maxLength: 4 }
  )
  .map((segments) => "/" + segments.join("/"));

/** Generate a positive integer orgId */
const orgIdArb = fc.integer({ min: 1, max: 100000 });

/** HTTP method */
const methodArb = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH");

/** Generate an API path */
const apiPathArb = fc
  .array(
    fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-zA-Z0-9_:-]+$/.test(s)),
    { minLength: 1, maxLength: 4 }
  )
  .map((segments) => "/api/" + segments.join("/"));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGraph(
  nodes: CompositionNode[],
  edges: CompositionEdge[],
  scopeId = "oddjob"
): CompositionGraph {
  return {
    scope: { id: scopeId, name: "Test Scope", type: "platform" } as CompositionScope,
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

function endpointNode(method: string, path: string): CompositionNode {
  return {
    id: `api_endpoint::${method}-${path}`,
    type: "api_endpoint",
    label: `${method} ${path}`,
    group: "API Endpoints",
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

// ─── Property 8: Cache key scope namespacing ─────────────────────────────────

describe("Feature: prefetch-manifest-from-composition-graph, Property 8: Cache key scope namespacing", () => {
  /**
   * **Validates: Requirements 8.4, 4.1**
   *
   * For any (scope1, scope2, screenPath, orgId) where scope1 !== scope2,
   * _cacheKey(scope1, screenPath, orgId) !== _cacheKey(scope2, screenPath, orgId)
   */
  it("cache keys for different scopes never collide even when screen paths and orgIds are identical", () => {
    fc.assert(
      fc.property(scopeArb, scopeArb, screenPathArb, orgIdArb, (scope1, scope2, path, orgId) => {
        fc.pre(scope1 !== scope2);

        const key1 = prefetchService._cacheKey(scope1, path, orgId);
        const key2 = prefetchService._cacheKey(scope2, path, orgId);

        expect(key1).not.toBe(key2);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.4, 4.1**
   *
   * The scope string is always a distinguishable segment in the cache key.
   */
  it("the cache key always contains the scope as a distinguishable segment", () => {
    fc.assert(
      fc.property(scopeArb, screenPathArb, orgIdArb, (scope, path, orgId) => {
        const key = prefetchService._cacheKey(scope, path, orgId);

        // The key must contain the scope string
        expect(key).toContain(scope);
        // The key must follow the format xray:prefetch:{scope}:{screenPath}:org:{orgId}
        expect(key).toBe(`xray:prefetch:${scope}:${path}:org:${orgId}`);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.4, 4.1**
   *
   * Cache keys for different orgIds never collide even when scope and path are identical.
   */
  it("cache keys for different orgIds never collide with same scope and path", () => {
    fc.assert(
      fc.property(scopeArb, screenPathArb, orgIdArb, orgIdArb, (scope, path, orgId1, orgId2) => {
        fc.pre(orgId1 !== orgId2);

        const key1 = prefetchService._cacheKey(scope, path, orgId1);
        const key2 = prefetchService._cacheKey(scope, path, orgId2);

        expect(key1).not.toBe(key2);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 5: Bulk manifest completeness ──────────────────────────────────

describe("Feature: prefetch-manifest-from-composition-graph, Property 5: Bulk manifest completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure Redis always returns cache miss so manifests are generated fresh
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
  });

  /**
   * Generator for a multi-screen CompositionGraph with N screen nodes (N ≥ 0).
   * Each screen optionally has CALLS_API edges to endpoint nodes.
   */
  const multiScreenGraphArb = fc
    .integer({ min: 0, max: 10 })
    .chain((numScreens) => {
      // Generate N unique screen paths
      return fc
        .uniqueArray(screenPathArb, { minLength: numScreens, maxLength: numScreens })
        .chain((screenPaths) => {
          // For each screen, optionally generate 0-3 endpoint targets
          return fc
            .tuple(
              ...screenPaths.map(() =>
                fc.array(
                  fc.tuple(methodArb, apiPathArb),
                  { minLength: 0, maxLength: 3 }
                )
              )
            )
            .map((endpointsPerScreen) => {
              const nodes: CompositionNode[] = [];
              const edges: CompositionEdge[] = [];
              const endpointSet = new Set<string>();

              screenPaths.forEach((path, i) => {
                nodes.push(screenNode(path));

                for (const [method, apiPath] of endpointsPerScreen[i]) {
                  const nodeKey = `${method}-${apiPath}`;
                  if (!endpointSet.has(nodeKey)) {
                    endpointSet.add(nodeKey);
                    nodes.push(endpointNode(method, apiPath));
                  }
                  edges.push(callsApiEdge(path, method, apiPath));
                }
              });

              return { graph: makeGraph(nodes, edges), screenPaths };
            });
        });
    });

  /**
   * **Validates: Requirements 3.2, 3.3, 3.4**
   *
   * For any CompositionGraph containing N Screen_Nodes (N ≥ 0), calling
   * getBulkManifests(scope, orgId) produces an object with exactly N keys,
   * each matching a screen's path, each value a valid PrefetchManifest.
   */
  it("getBulkManifests produces exactly N keys matching N screen paths with valid manifests", async () => {
    const { xrayCompositionService } = await import("./xray-composition.service.js");

    await fc.assert(
      fc.asyncProperty(multiScreenGraphArb, async ({ graph, screenPaths }) => {
        // Mock buildGraph to return our generated graph
        vi.mocked(xrayCompositionService.buildGraph).mockResolvedValue(graph);
        // Reset Redis mock for each iteration
        mockRedis.get.mockResolvedValue(null);

        const result = await prefetchService.getBulkManifests("test-scope", 1);

        // Must have exactly N keys
        const resultKeys = Object.keys(result);
        expect(resultKeys).toHaveLength(screenPaths.length);

        // Each key must match a screen path
        for (const sp of screenPaths) {
          expect(result).toHaveProperty(sp);

          const manifest = result[sp];

          // Each value must be a valid PrefetchManifest
          expect(manifest.screenPath).toBe(sp);
          expect(typeof manifest.scope).toBe("string");
          expect(typeof manifest.generatedAt).toBe("string");
          // generatedAt must be a valid ISO 8601 timestamp
          expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt);
          expect(Array.isArray(manifest.endpoints)).toBe(true);

          // Each endpoint must have method, path, staticParams
          for (const ep of manifest.endpoints) {
            expect(typeof ep.method).toBe("string");
            expect(typeof ep.path).toBe("string");
            expect(typeof ep.staticParams).toBe("object");
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.3, 3.4**
   *
   * Each manifest's endpoints match the CALLS_API edges from that screen in the graph.
   */
  it("each bulk manifest's endpoints match exactly the CALLS_API edges for that screen", async () => {
    const { xrayCompositionService } = await import("./xray-composition.service.js");

    await fc.assert(
      fc.asyncProperty(multiScreenGraphArb, async ({ graph, screenPaths }) => {
        vi.mocked(xrayCompositionService.buildGraph).mockResolvedValue(graph);
        mockRedis.get.mockResolvedValue(null);

        const result = await prefetchService.getBulkManifests("test-scope", 1);

        for (const sp of screenPaths) {
          const manifest = result[sp];

          // Compute expected endpoints from graph edges
          const screenNodeId = `screen::${sp}`;
          const callEdges = graph.edges.filter(
            (e) => e.source === screenNodeId && e.relation === "CALLS_API"
          );

          // Build expected unique method+path set
          const expectedSet = new Set<string>();
          for (const edge of callEdges) {
            const targetNode = graph.nodes.find((n) => n.id === edge.target);
            if (targetNode && targetNode.type === "api_endpoint") {
              const spaceIdx = targetNode.label.indexOf(" ");
              const method = spaceIdx > 0 ? targetNode.label.slice(0, spaceIdx) : "GET";
              const path = spaceIdx > 0 ? targetNode.label.slice(spaceIdx + 1) : targetNode.label;
              expectedSet.add(`${method}:${path}`);
            }
          }

          // Manifest endpoints must match
          const actualSet = new Set(manifest.endpoints.map((ep) => `${ep.method}:${ep.path}`));
          expect(actualSet).toEqual(expectedSet);
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ─── Property 2: Endpoint label parsing round-trip ────────────────────────────

describe("Feature: prefetch-manifest-from-composition-graph, Property 2: Endpoint label parsing round-trip", () => {
  /**
   * **Validates: Requirements 9.3, 9.4**
   *
   * For any valid endpoint label of form "<METHOD> <path>" where METHOD ∈ {GET, POST, PUT, DELETE, PATCH}
   * and path starts with "/", calling _parseEndpointLabel(label) produces { method, path } such that
   * `${method} ${path}` equals the original label.
   */
  it("_parseEndpointLabel round-trips: reconstructing method + path equals the original label", () => {
    const endpointLabelArb = fc
      .tuple(methodArb, apiPathArb)
      .map(([method, path]) => ({ label: `${method} ${path}`, method, path }));

    fc.assert(
      fc.property(endpointLabelArb, ({ label, method, path }) => {
        const result = prefetchService._parseEndpointLabel(label);
        const reconstructed = `${result.method} ${result.path}`;

        expect(reconstructed).toBe(label);
        expect(result.method).toBe(method);
        expect(result.path).toBe(path);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.3, 9.4**
   *
   * The method is always the first space-delimited token and the path is everything after the first space.
   */
  it("method is the first token and path is the remainder after the first space", () => {
    // Generate paths that may contain spaces (edge case)
    const pathWithSpacesArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^\/[a-zA-Z0-9_/-]+$/.test(s)),
        fc.constantFrom("", " extra-segment", " /more/path")
      )
      .map(([base, suffix]) => base + suffix);

    fc.assert(
      fc.property(methodArb, pathWithSpacesArb, (method, path) => {
        const label = `${method} ${path}`;
        const result = prefetchService._parseEndpointLabel(label);

        // Method should be the text before the first space
        expect(result.method).toBe(method);
        // Path should be everything after the first space
        expect(result.path).toBe(path);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 1: Manifest extraction correctness ──────────────────────────────

describe("Feature: prefetch-manifest-from-composition-graph, Property 1: Manifest extraction produces exactly the CALLS_API targets", () => {
  /**
   * Generator: A composition graph with a specific screen and N CALLS_API edges
   * pointing to unique API endpoint nodes.
   */
  const graphWithScreenArb = fc
    .tuple(
      screenPathArb,
      scopeArb,
      fc.array(fc.tuple(methodArb, apiPathArb), { minLength: 0, maxLength: 8 })
    )
    .map(([path, scope, endpoints]) => {
      const nodes: CompositionNode[] = [screenNode(path)];
      const edges: CompositionEdge[] = [];
      const endpointNodeSet = new Set<string>();

      for (const [method, apiPath] of endpoints) {
        const key = `${method}-${apiPath}`;
        if (!endpointNodeSet.has(key)) {
          endpointNodeSet.add(key);
          nodes.push(endpointNode(method, apiPath));
        }
        edges.push(callsApiEdge(path, method, apiPath));
      }

      // Add some distractor nodes/edges that should NOT appear in manifest
      nodes.push(screenNode("/distractor-screen"));
      nodes.push(endpointNode("GET", "/api/distractor"));
      edges.push(callsApiEdge("/distractor-screen", "GET", "/api/distractor"));

      return { graph: makeGraph(nodes, edges, scope), screenPath: path, scope, endpoints };
    });

  /**
   * **Validates: Requirements 1.1, 1.3, 1.4**
   *
   * The manifest's endpoints array contains exactly one entry per unique CALLS_API edge target
   * from the requested screen, with no extras and no omissions.
   */
  it("manifest endpoints match exactly the unique CALLS_API edge targets for the requested screen", () => {
    fc.assert(
      fc.property(graphWithScreenArb, ({ graph, screenPath, scope, endpoints }) => {
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        // Compute expected unique endpoints by method+path
        const seen = new Set<string>();
        const expectedUnique: Array<{ method: string; path: string }> = [];
        for (const [method, path] of endpoints) {
          const key = `${method}:${path}`;
          if (!seen.has(key)) {
            seen.add(key);
            expectedUnique.push({ method, path });
          }
        }

        // Manifest should have exactly one entry per unique method+path
        expect(manifest.endpoints).toHaveLength(expectedUnique.length);

        // Each expected endpoint should appear in the manifest
        for (const expected of expectedUnique) {
          const found = manifest.endpoints.find(
            (e) => e.method === expected.method && e.path === expected.path
          );
          expect(found).toBeDefined();
        }

        // No extras: manifest should not include the distractor endpoint
        const distractorFound = manifest.endpoints.find(
          (e) => e.method === "GET" && e.path === "/api/distractor"
        );
        // Only absent if the test screenPath's edges don't point to /api/distractor
        if (!endpoints.some(([m, p]) => m === "GET" && p === "/api/distractor")) {
          expect(distractorFound).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * Returns empty manifest when screen node is not found in the graph.
   */
  it("returns empty endpoints when screen node is not found in graph", () => {
    fc.assert(
      fc.property(screenPathArb, scopeArb, (screenPath, scope) => {
        // Build graph without the requested screen
        const graph = makeGraph(
          [screenNode("/some-other-path"), endpointNode("GET", "/api/data")],
          [callsApiEdge("/some-other-path", "GET", "/api/data")],
          scope
        );

        fc.pre(screenPath !== "/some-other-path");

        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);
        expect(manifest.endpoints).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.4**
   *
   * Deduplication: multiple CALLS_API edges targeting the same method+path produce only one manifest entry.
   */
  it("deduplicates endpoints with identical method+path from multiple CALLS_API edges", () => {
    fc.assert(
      fc.property(
        screenPathArb,
        scopeArb,
        methodArb,
        apiPathArb,
        fc.integer({ min: 2, max: 5 }),
        (screenPath, scope, method, apiPath, dupeCount) => {
          const nodes: CompositionNode[] = [screenNode(screenPath), endpointNode(method, apiPath)];
          const edges: CompositionEdge[] = [];

          // Create multiple edges to the same endpoint (simulating calls from multiple components)
          for (let i = 0; i < dupeCount; i++) {
            edges.push({
              id: `edge-${i}`,
              source: `screen::${screenPath}`,
              target: `api_endpoint::${method}-${apiPath}`,
              relation: "CALLS_API",
              label: `calls ${apiPath}`,
            });
          }

          const graph = makeGraph(nodes, edges, scope);
          const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

          // Should deduplicate to exactly 1 entry
          expect(manifest.endpoints).toHaveLength(1);
          expect(manifest.endpoints[0].method).toBe(method);
          expect(manifest.endpoints[0].path).toBe(apiPath);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3: Endpoint entry completeness ──────────────────────────────────

describe("Feature: prefetch-manifest-from-composition-graph, Property 3: Endpoint entry completeness", () => {
  /** Generate random staticParams metadata (exclude __proto__ which is not a valid own property key) */
  const staticParamsArb = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s !== "__proto__"),
    fc.string({ minLength: 1, maxLength: 20 }),
    { minKeys: 0, maxKeys: 4 }
  );

  /** Generate an API_Endpoint_Node with metadata including staticParams */
  const endpointWithMetadataArb = fc.tuple(methodArb, apiPathArb, staticParamsArb).map(
    ([method, path, staticParams]) => {
      const node: CompositionNode = {
        id: `api_endpoint::${method}-${path}`,
        type: "api_endpoint",
        label: `${method} ${path}`,
        group: "API Endpoints",
        metadata:
          Object.keys(staticParams).length > 0
            ? { staticParams }
            : undefined,
      };
      return { node, method, path, staticParams };
    }
  );

  /**
   * **Validates: Requirements 1.2, 9.2, 9.5**
   *
   * Each endpoint entry contains the correct method, path, and staticParams
   * derived from the API_Endpoint_Node metadata.
   */
  it("endpoint entries contain correct method, path, and staticParams from node metadata", () => {
    fc.assert(
      fc.property(screenPathArb, scopeArb, endpointWithMetadataArb, (screenPath, scope, { node, method, path, staticParams }) => {
        const nodes: CompositionNode[] = [screenNode(screenPath), node];
        const edges: CompositionEdge[] = [
          {
            id: `edge-0`,
            source: `screen::${screenPath}`,
            target: node.id,
            relation: "CALLS_API",
            label: `calls ${path}`,
          },
        ];

        const graph = makeGraph(nodes, edges, scope);
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        expect(manifest.endpoints).toHaveLength(1);

        const entry = manifest.endpoints[0];
        expect(entry.method).toBe(method);
        expect(entry.path).toBe(path);

        // Static params should be preserved correctly
        for (const [key, value] of Object.entries(staticParams)) {
          expect(entry.staticParams[key]).toBe(value);
        }
        // No extra keys beyond what was in metadata
        expect(Object.keys(entry.staticParams).sort()).toEqual(
          Object.keys(staticParams).sort()
        );
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.2, 9.5**
   *
   * When an endpoint node has no metadata, staticParams is an empty object.
   */
  it("staticParams is empty object when node has no metadata", () => {
    fc.assert(
      fc.property(screenPathArb, scopeArb, methodArb, apiPathArb, (screenPath, scope, method, path) => {
        const node: CompositionNode = {
          id: `api_endpoint::${method}-${path}`,
          type: "api_endpoint",
          label: `${method} ${path}`,
          group: "API Endpoints",
          // No metadata
        };

        const nodes: CompositionNode[] = [screenNode(screenPath), node];
        const edges: CompositionEdge[] = [
          {
            id: `edge-0`,
            source: `screen::${screenPath}`,
            target: node.id,
            relation: "CALLS_API",
            label: `calls ${path}`,
          },
        ];

        const graph = makeGraph(nodes, edges, scope);
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        expect(manifest.endpoints).toHaveLength(1);
        expect(manifest.endpoints[0].staticParams).toEqual({});
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 9.2**
   *
   * Multiple distinct endpoints each get their own correct entry with correct staticParams.
   */
  it("multiple distinct endpoints each have correct entries with their own staticParams", () => {
    const multiEndpointArb = fc.array(endpointWithMetadataArb, { minLength: 1, maxLength: 5 });

    fc.assert(
      fc.property(screenPathArb, scopeArb, multiEndpointArb, (screenPath, scope, endpointData) => {
        // Deduplicate by method+path to avoid test ambiguity
        const uniqueEndpoints: typeof endpointData = [];
        const seen = new Set<string>();
        for (const ep of endpointData) {
          const key = `${ep.method}:${ep.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueEndpoints.push(ep);
          }
        }

        const nodes: CompositionNode[] = [screenNode(screenPath)];
        const edges: CompositionEdge[] = [];

        for (const { node, path } of uniqueEndpoints) {
          nodes.push(node);
          edges.push({
            id: `edge-${node.id}`,
            source: `screen::${screenPath}`,
            target: node.id,
            relation: "CALLS_API",
            label: `calls ${path}`,
          });
        }

        const graph = makeGraph(nodes, edges, scope);
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        expect(manifest.endpoints).toHaveLength(uniqueEndpoints.length);

        for (const { method, path, staticParams } of uniqueEndpoints) {
          const entry = manifest.endpoints.find(
            (e) => e.method === method && e.path === path
          );
          expect(entry).toBeDefined();
          expect(entry!.staticParams).toEqual(staticParams);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4: Manifest metadata invariant ──────────────────────────────────

describe("Feature: prefetch-manifest-from-composition-graph, Property 4: Manifest metadata invariant", () => {
  /**
   * **Validates: Requirements 1.5, 9.1**
   *
   * The returned manifest has screenPath equal to the requested screen path,
   * scope equal to the requested scope, and generatedAt is a valid ISO 8601
   * timestamp not in the future.
   */
  it("manifest metadata: screenPath and scope match requested values, generatedAt is valid and not in the future", () => {
    fc.assert(
      fc.property(screenPathArb, scopeArb, (screenPath, scope) => {
        // Build a graph with the screen present (with or without endpoints)
        const graph = makeGraph([screenNode(screenPath)], [], scope);
        const now = Date.now();
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        // screenPath must equal requested
        expect(manifest.screenPath).toBe(screenPath);

        // scope must equal requested
        expect(manifest.scope).toBe(scope);

        // generatedAt must be a valid ISO 8601 timestamp
        const parsed = Date.parse(manifest.generatedAt);
        expect(Number.isNaN(parsed)).toBe(false);

        // generatedAt must not be in the future (with small tolerance for execution time)
        expect(parsed).toBeLessThanOrEqual(now + 1000);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5, 9.1**
   *
   * Metadata invariants hold even for empty manifests (screen not found).
   */
  it("metadata invariants hold when screen is not found (empty manifest)", () => {
    fc.assert(
      fc.property(screenPathArb, scopeArb, (screenPath, scope) => {
        // Empty graph — no screen node matches
        const graph = makeGraph([], [], scope);
        const now = Date.now();
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        expect(manifest.screenPath).toBe(screenPath);
        expect(manifest.scope).toBe(scope);

        const parsed = Date.parse(manifest.generatedAt);
        expect(Number.isNaN(parsed)).toBe(false);
        expect(parsed).toBeLessThanOrEqual(now + 1000);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * generatedAt conforms to ISO 8601 format (Date.toISOString() format ending with 'Z').
   */
  it("generatedAt is a well-formed ISO 8601 string ending with Z", () => {
    fc.assert(
      fc.property(screenPathArb, scopeArb, (screenPath, scope) => {
        const graph = makeGraph([screenNode(screenPath)], [], scope);
        const manifest = prefetchService._extractManifestFromGraph(graph, screenPath, scope);

        // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
        expect(manifest.generatedAt).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        );
      }),
      { numRuns: 100 }
    );
  });
});
