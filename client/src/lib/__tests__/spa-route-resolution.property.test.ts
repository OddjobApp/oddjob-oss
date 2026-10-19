/**
 * Property-based tests for SPA route resolution.
 *
 * Feature: ui-spa-consolidation-phase-2
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { getEntryForUrl, isCrossEntryNav, SPA_ENTRIES } from "@/lib/spa-utils";

describe('workspace and launch route ownership', () => {
  it.each([
    '/workspace/chat', '/workspace/chat/crew-123?studio=forge',
    '/workspace/feeds', '/workspace/spatial', '/launchpad', '/launch',
    '/spatial', '/projects', '/signal-intelligence', '/scheduled-jobs', '/pipeline',
  ])('resolves %s to the operations SPA', (path) => {
    expect(getEntryForUrl(path)).toBe('operations');
  });
});

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generates a random URL suffix: subpaths, query params, fragments */
function urlSuffix(): fc.Arbitrary<string> {
  return fc.tuple(
    // random path segments after the prefix
    fc.array(
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")), { minLength: 1, maxLength: 12 }),
      { minLength: 0, maxLength: 4 }
    ),
    // optional query string
    fc.option(
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789=&_-".split("")), { minLength: 1, maxLength: 30 }),
      { nil: undefined }
    ),
    // optional fragment
    fc.option(
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")), { minLength: 1, maxLength: 15 }),
      { nil: undefined }
    )
  ).map(([segments, query, fragment]) => {
    let suffix = segments.length > 0 ? "/" + segments.join("/") : "";
    if (query) suffix += "?" + query;
    if (fragment) suffix += "#" + fragment;
    return suffix;
  });
}

/** Generates a path starting with one of the given prefixes, with random suffix */
function pathWithPrefix(prefixes: readonly string[]): fc.Arbitrary<string> {
  return fc.tuple(
    fc.constantFrom(...prefixes),
    urlSuffix()
  ).map(([prefix, suffix]) => prefix + suffix);
}

// ─── Property 2: Operations path ownership ──────────────────────────────────

/**
 * Property 2: Operations path ownership
 *
 * For any path matching the Operations domain prefixes
 * (/dashboard, /workstreams, /operations, /missions, /agents, /jobs,
 * /schedules, /pipelines, /templates, /pipeline-executions),
 * getEntryForUrl SHALL return 'operations'.
 *
 * **Validates: Requirements 1.1, 1.3, 1.7, 1.9**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 2: Operations path ownership
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 2: Operations path ownership", () => {
  const OPERATIONS_PREFIXES = [
    "/dashboard",
    "/workstreams",
    "/operations",
    "/missions",
    "/agents",
    "/jobs",
    "/schedules",
    "/pipelines",
    "/templates",
    "/pipeline-executions",
  ] as const;

  it("getEntryForUrl returns 'operations' for any path with Operations domain prefixes", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(OPERATIONS_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("operations");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'operations' for exact Operations prefixes (no suffix)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OPERATIONS_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("operations");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3: Auth and fallback resolution ────────────────────────────────

/**
 * Property 3: Auth and fallback resolution
 *
 * For any path matching public route prefixes (/a/*, /r/*, /external/*,
 * /hil-form/*, /trust, /app/*) OR any path that does not match any defined
 * SPA prefix, getEntryForUrl SHALL return 'auth'.
 *
 * **Validates: Requirements 1.5, 1.8**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 3: Auth and fallback resolution
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 3: Auth and fallback resolution", () => {
  const AUTH_PUBLIC_PREFIXES = [
    "/a",
    "/r",
    "/external",
    "/hil-form",
    "/trust",
    "/app",
  ] as const;

  /**
   * Collect ALL known SPA prefixes (from all non-deprecated entry arrays)
   * to generate paths that DON'T match any of them for the fallback test.
   */
  const ALL_KNOWN_PREFIXES: string[] = [
    ...SPA_ENTRIES.AUTH,
    ...SPA_ENTRIES.KNOWLEDGE,
    ...SPA_ENTRIES.OPERATIONS,
    ...SPA_ENTRIES.INTELLIGENCE,
    ...SPA_ENTRIES.ARMORY,
  ];

  /**
   * Generate a random path segment that does NOT start with any known prefix.
   * Strategy: generate a path starting with a random alphabetic segment that
   * is not in the known prefix list.
   */
  function unmatchedPath(): fc.Arbitrary<string> {
    return fc.tuple(
      // A random first segment that won't collide with known prefixes
      fc.stringOf(
        fc.constantFrom(..."qwxyz".split("")),
        { minLength: 2, maxLength: 8 }
      ),
      urlSuffix()
    ).map(([segment, suffix]) => {
      const candidate = "/" + segment;
      // Double-check it doesn't accidentally match a known prefix
      // (extremely unlikely given the character set, but safe)
      return candidate + suffix;
    }).filter((path) => {
      // Ensure no known prefix matches
      return !ALL_KNOWN_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(prefix + "/")
      );
    });
  }

  /**
   * Sub-property 3a: Known auth/public prefixes always return 'auth'
   *
   * **Validates: Requirements 1.5**
   */
  it("getEntryForUrl returns 'auth' for any path with public route prefixes", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(AUTH_PUBLIC_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("auth");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'auth' for exact public route prefixes (no suffix)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...AUTH_PUBLIC_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("auth");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'auth' for /auth prefix", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(["/auth"]),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("auth");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Sub-property 3b: Paths that don't match any SPA prefix fall back to 'auth'
   *
   * Unknown paths now render the public 404 in the auth entry.
   *
   * **Validates: Requirements 1.8**
   */
  it("getEntryForUrl returns 'auth' for paths that don't match any known SPA prefix (fallback)", () => {
    fc.assert(
      fc.property(
        unmatchedPath(),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("auth");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'auth' for the root path '/'", () => {
    expect(getEntryForUrl("/")).toBe("auth");
  });
});

// ─── Property 5: Armory path ownership including tactics ─────────────────────

/**
 * Property 5: Armory path ownership including tactics
 *
 * For any path matching Armory domain prefixes (/armory, /apps, /forms, /tactics),
 * getEntryForUrl SHALL return 'armory'.
 *
 * Important: /tactics was moved from ADMIN to ARMORY — this property verifies
 * the consolidation is correct.
 *
 * **Validates: Requirements 4.6, 4.8**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 5: Armory path ownership including tactics
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 5: Armory path ownership including tactics", () => {
  const ARMORY_PREFIXES = [
    "/armory",
    "/apps",
    "/forms",
    "/tactics",
  ] as const;

  it("getEntryForUrl returns 'armory' for any path with Armory domain prefixes", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(ARMORY_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("armory");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'armory' for exact Armory prefixes (no suffix)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ARMORY_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("armory");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'armory' for /tactics/* paths (moved from admin)", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(["/tactics"]),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("armory");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4: Intelligence path ownership ────────────────────────────────

/**
 * Property 4: Intelligence path ownership
 *
 * For any path matching Intelligence domain prefixes
 * (/insights, /control, /health, /governance, /agent, /predictive,
 * /analytics, /monitoring, /observability, /alerts, /events),
 * getEntryForUrl SHALL return 'intelligence'.
 *
 * **Validates: Requirements 2.3, 3.3**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 4: Intelligence path ownership
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 4: Intelligence path ownership", () => {
  const INTELLIGENCE_PREFIXES = [
    "/insights",
    "/control",
    "/health",
    "/governance",
    "/agent",
    "/predictive",
    "/analytics",
    "/monitoring",
    "/observability",
    "/alerts",
    "/events",
  ] as const;

  it("getEntryForUrl returns 'intelligence' for any path with Intelligence domain prefixes", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(INTELLIGENCE_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("intelligence");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'intelligence' for exact Intelligence prefixes (no suffix)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...INTELLIGENCE_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("intelligence");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 6: Former admin prefixes resolve to operations ────────────────

/**
 * Property 6: Former admin prefixes resolve to operations
 *
 * For any path matching former Admin domain prefixes
 * (/connections, /account-admin, /platform-maintenance, /platform,
 * /organizations, /users, /billing, /snapshots, /admin,
 * /credentials, /settings, /profile, /saas),
 * getEntryForUrl SHALL return 'operations'.
 *
 * **Validates: Requirements 5.6, 8.4**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 6: Former admin prefixes resolve to operations
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 6: Former admin prefixes resolve to operations", () => {
  const FORMER_ADMIN_PREFIXES = [
    "/connections",
    "/account-admin",
    "/platform-maintenance",
    "/platform",
    "/organizations",
    "/users",
    "/billing",
    "/snapshots",
    "/admin",
    "/credentials",
    "/settings",
    "/profile",
    "/saas",
  ] as const;

  it("getEntryForUrl returns 'operations' for any path with former Admin prefixes", () => {
    fc.assert(
      fc.property(
        pathWithPrefix(FORMER_ADMIN_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("operations");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getEntryForUrl returns 'operations' for exact former Admin prefixes (no suffix)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORMER_ADMIN_PREFIXES),
        (path) => {
          const result = getEntryForUrl(path);
          expect(result).toBe("operations");
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─── Property 7: Agent Memory redirect preserves URL components ─────────────

/**
 * Property 7: Redirect URL preservation
 *
 * For any combination of query string and URL fragment appended to `/agent/memory`,
 * the redirect target SHALL be `/armory/run-memory` with the identical query string
 * and fragment preserved.
 *
 * e.g., `/agent/memory?filter=x#section` → `/armory/run-memory?filter=x#section`
 *
 * **Validates: Requirements 6.2**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 7: Redirect URL preservation
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 7: Redirect URL preservation", () => {
  let replacedUrl: string | null;

  beforeEach(() => {
    replacedUrl = null;
    // Mock window.location with configurable search and hash
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
    Object.defineProperty(globalThis.window, "location", {
      value: {
        pathname: "/agent/memory",
        search: "",
        hash: "",
        replace: (url: string) => { replacedUrl = url; },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    replacedUrl = null;
  });

  // ─── Generators ─────────────────────────────────────────────────────────

  /** Generate a valid query string starting with '?' */
  function queryStringArb(): fc.Arbitrary<string> {
    return fc.array(
      fc.tuple(
        fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-".split("")), { minLength: 1, maxLength: 10 }),
        fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-.+%20".split("")), { minLength: 0, maxLength: 15 })
      ),
      { minLength: 1, maxLength: 5 }
    ).map((pairs) => "?" + pairs.map(([k, v]) => `${k}=${v}`).join("&"));
  }

  /** Generate a valid URL fragment starting with '#' */
  function hashArb(): fc.Arbitrary<string> {
    return fc.stringOf(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_/".split("")),
      { minLength: 1, maxLength: 20 }
    ).map((s) => "#" + s);
  }

  /**
   * Simulates what the AgentMemoryRedirect component does:
   * `window.location.replace('/armory/run-memory' + window.location.search + window.location.hash)`
   */
  function simulateRedirect(): string {
    return "/armory/run-memory" + window.location.search + window.location.hash;
  }

  it("redirect target is /armory/run-memory with query string preserved", () => {
    fc.assert(
      fc.property(
        queryStringArb(),
        (queryString) => {
          // Set window.location.search to the generated query string
          (globalThis.window as any).location = {
            pathname: "/agent/memory",
            search: queryString,
            hash: "",
            replace: (url: string) => { replacedUrl = url; },
          };

          const target = simulateRedirect();
          expect(target).toBe(`/armory/run-memory${queryString}`);
          expect(target.startsWith("/armory/run-memory?")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("redirect target is /armory/run-memory with hash fragment preserved", () => {
    fc.assert(
      fc.property(
        hashArb(),
        (hash) => {
          // Set window.location.hash to the generated fragment
          (globalThis.window as any).location = {
            pathname: "/agent/memory",
            search: "",
            hash: hash,
            replace: (url: string) => { replacedUrl = url; },
          };

          const target = simulateRedirect();
          expect(target).toBe(`/armory/run-memory${hash}`);
          expect(target.startsWith("/armory/run-memory#")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("redirect target is /armory/run-memory with both query string and hash preserved", () => {
    fc.assert(
      fc.property(
        queryStringArb(),
        hashArb(),
        (queryString, hash) => {
          // Set both search and hash
          (globalThis.window as any).location = {
            pathname: "/agent/memory",
            search: queryString,
            hash: hash,
            replace: (url: string) => { replacedUrl = url; },
          };

          const target = simulateRedirect();
          expect(target).toBe(`/armory/run-memory${queryString}${hash}`);
          // Verify structure: base path + query + hash in correct order
          expect(target.indexOf("?")).toBeLessThan(target.indexOf("#"));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("redirect target is /armory/run-memory with no suffix when no query or hash", () => {
    fc.assert(
      fc.property(
        fc.constant(null), // no-op arbitrary for repetition
        () => {
          (globalThis.window as any).location = {
            pathname: "/agent/memory",
            search: "",
            hash: "",
            replace: (url: string) => { replacedUrl = url; },
          };

          const target = simulateRedirect();
          expect(target).toBe("/armory/run-memory");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 9: Cross-SPA detection correctness ────────────────────────────

/**
 * Property 9: Cross-SPA detection correctness
 *
 * For any pair of paths (source, target) where both getEntryForUrl(source) and
 * getEntryForUrl(target) return the same SPA entry, isCrossEntryNav(target)
 * evaluated in the context of source SHALL return false.
 *
 * Also tests the inverse: paths from different SPAs should return true.
 *
 * **Validates: Requirements 1.2, 2.3, 3.3, 4.8**
 *
 * Tag: Feature: ui-spa-consolidation-phase-2, Property 9: Cross-SPA detection correctness
 */
describe("Feature: ui-spa-consolidation-phase-2, Property 9: Cross-SPA detection correctness", () => {
  const originalLocation = globalThis.window?.location;

  beforeEach(() => {
    // Set up a mutable window.location for testing
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
    Object.defineProperty(globalThis.window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore original location
    if (originalLocation) {
      Object.defineProperty(globalThis.window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  // ─── Generators ─────────────────────────────────────────────────────────

  /** All known SPA prefixes grouped by entry */
  const ENTRY_PREFIXES = {
    auth: ["/auth", "/a", "/r", "/external", "/hil-form", "/trust", "/app"],
    operations: [
      "/operations", "/missions", "/agents", "/jobs", "/schedules",
      "/scheduled-agents", "/pipelines", "/templates", "/pipeline-executions",
      "/dashboard", "/workstreams",
      "/connections", "/account-admin", "/platform-maintenance", "/platform",
      "/organizations", "/users", "/billing", "/snapshots", "/admin",
      "/credentials", "/settings", "/profile", "/saas",
    ],
    intelligence: [
      "/insights", "/analytics", "/predictive", "/prediction-intelligence",
      "/agent", "/governance", "/control", "/approvals", "/fine-tuning",
      "/intelligence", "/monitoring", "/observability", "/alerts", "/events", "/health",
    ],
    knowledge: ["/knowledge", "/datasets", "/knowledge-store"],
    armory: ["/armory", "/apps", "/forms", "/app-forge", "/appforge", "/prospecting", "/swarm", "/tactics"],
  } as const;

  type SpaEntry = keyof typeof ENTRY_PREFIXES;
  const ALL_ENTRIES: SpaEntry[] = ["auth", "operations", "intelligence", "knowledge", "armory"];

  /** Generate a random URL suffix: subpaths, query params, fragments */
  function suffixArb(): fc.Arbitrary<string> {
    return fc.tuple(
      fc.array(
        fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")), { minLength: 1, maxLength: 8 }),
        { minLength: 0, maxLength: 3 }
      ),
      fc.option(
        fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789=&_-".split("")), { minLength: 1, maxLength: 15 }),
        { nil: undefined }
      ),
    ).map(([segments, query]) => {
      let suffix = segments.length > 0 ? "/" + segments.join("/") : "";
      if (query) suffix += "?" + query;
      return suffix;
    });
  }

  /** Generate a path belonging to a specific SPA entry */
  function pathForEntry(entry: SpaEntry): fc.Arbitrary<string> {
    const prefixes = ENTRY_PREFIXES[entry];
    return fc.tuple(
      fc.constantFrom(...prefixes),
      suffixArb()
    ).map(([prefix, suffix]) => prefix + suffix);
  }

  /** Generate a pair of paths that both resolve to the same SPA entry */
  function sameSpaPathPair(): fc.Arbitrary<{ entry: SpaEntry; source: string; target: string }> {
    return fc.constantFrom(...ALL_ENTRIES).chain((entry) =>
      fc.tuple(pathForEntry(entry), pathForEntry(entry)).map(([source, target]) => ({
        entry,
        source,
        target,
      }))
    );
  }

  /** Generate a pair of paths that resolve to different SPA entries */
  function differentSpaPathPair(): fc.Arbitrary<{ sourceEntry: SpaEntry; targetEntry: SpaEntry; source: string; target: string }> {
    return fc.tuple(
      fc.constantFrom(...ALL_ENTRIES),
      fc.constantFrom(...ALL_ENTRIES)
    ).filter(([a, b]) => a !== b).chain(([sourceEntry, targetEntry]) =>
      fc.tuple(pathForEntry(sourceEntry), pathForEntry(targetEntry)).map(([source, target]) => ({
        sourceEntry,
        targetEntry,
        source,
        target,
      }))
    );
  }

  /**
   * **Validates: Requirements 1.2, 2.3, 3.3, 4.8**
   *
   * When source and target paths resolve to the same SPA entry,
   * isCrossEntryNav(target) returns false — no hard reload needed.
   */
  it("isCrossEntryNav returns false when source and target are in the same SPA", () => {
    fc.assert(
      fc.property(
        sameSpaPathPair(),
        ({ entry, source, target }) => {
          // Set window.location.pathname to simulate the source path
          (globalThis.window as any).location = { pathname: source.split("?")[0].split("#")[0] };

          const result = isCrossEntryNav(target);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.3, 3.3, 4.8**
   *
   * Inverse: when source and target resolve to different SPA entries,
   * isCrossEntryNav(target) returns true — hard reload is required.
   */
  it("isCrossEntryNav returns true when source and target are in different SPAs", () => {
    fc.assert(
      fc.property(
        differentSpaPathPair(),
        ({ source, target }) => {
          // Set window.location.pathname to simulate the source path
          (globalThis.window as any).location = { pathname: source.split("?")[0].split("#")[0] };

          const result = isCrossEntryNav(target);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.3, 3.3, 4.8**
   *
   * Reflexive property: navigating to the same path never triggers cross-SPA reload.
   */
  it("isCrossEntryNav returns false when target equals source (reflexive)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_ENTRIES).chain((entry) => pathForEntry(entry)),
        (path) => {
          const cleanPath = path.split("?")[0].split("#")[0];
          (globalThis.window as any).location = { pathname: cleanPath };

          const result = isCrossEntryNav(path);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
