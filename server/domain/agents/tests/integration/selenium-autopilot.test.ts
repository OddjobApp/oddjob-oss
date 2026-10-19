import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { agentRunSteps } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

// The app serves on :5000; this defaulted to :3000, so even with a server running
// it could only ever fail.
const API_BASE = process.env.TEST_API_URL || "http://localhost:5000";
/**
 * Real-browser automation is opt-in. `SKIP_BROWSER=true` is still honoured for
 * anything that already sets it, but the default is now "don't drive a browser"
 * rather than "drive one and hope Selenium is installed".
 */
const RUN_BROWSER_TESTS =
    process.env.RUN_BROWSER_TESTS === "true" && process.env.SKIP_BROWSER !== "true";

/**
 * Whether this process and the server under test share a database.
 *
 * They do NOT by default, and that is deliberate on both sides:
 * tests/configure-test-environment.ts pins DATABASE_URL to oddjob_test so a test
 * run can never write into the development database, while the dev server runs
 * against the development database from .env. Any assertion that seeds a row
 * here and expects the server to read it therefore fails by construction — the
 * two are looking at different databases, and no amount of fixing the assertion
 * changes that.
 *
 * The HTTP-only tests in this file are unaffected. The DB-coupled ones are gated
 * on an explicit opt-in, for a deployment where the server is pointed at
 * TEST_DATABASE_URL (e.g. `DATABASE_URL=$TEST_DATABASE_URL npm run dev`).
 */
const SHARED_DB_WITH_SERVER = process.env.SELENIUM_TEST_SHARED_DB === "true";

/**
 * This suite drives a live HTTP server and a real browser session. Without one it
 * failed the whole file with ECONNREFUSED on every default `vitest run` — noise
 * that hides real regressions rather than reporting a missing dependency.
 *
 * Probe once, up front, and skip cleanly when nothing is listening. With a server
 * up (`npm run dev`) the suite runs exactly as before.
 */
const serverIsReachable = await fetch(`${API_BASE}/api/health`, {
    signal: AbortSignal.timeout(2000),
})
    .then((r) => r.ok)
    .catch(() => false);

if (!serverIsReachable) {
    console.warn(
        `[selenium-autopilot] Skipping: no server reachable at ${API_BASE}. ` +
        `Start one with \`npm run dev\`, or set TEST_API_URL, to run these tests.`,
    );
}

describe.skipIf(!serverIsReachable)("Selenium Autopilot Integration", () => {
  /**
   * Session cookie, sent as `Cookie:` on every request.
   *
   * This previously POSTed `{ email, password }` to `/api/auth/login` and read a
   * bearer token off the response. None of that matches the platform: the route
   * is `/api/login`, it takes `username`, and it authenticates with a session
   * cookie — there is no token in the body. So `authToken` was always undefined
   * and every request came back 401, which the assertions reported as the
   * endpoint being broken rather than the login being wrong.
   * Credentials match tests/e2e/auth.setup.ts.
   */
  let authCookie = "";
  let sessionId: string;
  /** Seeded recordings, removed in afterAll. */
  const recordedSessionIds: string[] = [];

  beforeAll(async () => {
    const loginRes = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: process.env.TEST_USER_EMAIL || "admin@example.com",
        password: process.env.TEST_USER_PASSWORD || "password123"
      })
    });

    if (!loginRes.ok) {
      throw new Error(
        `Login failed (${loginRes.status}) at ${API_BASE}/api/login — these tests cannot run unauthenticated. ` +
        `Seed the dev database (npm run db:seed) or set TEST_USER_EMAIL/TEST_USER_PASSWORD.`
      );
    }

    authCookie = (loginRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
  });

  describe("POST /api/agents/selenium/start", () => {
    it("should create a session and return sessionId", async () => {
      const res = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "https://example.com",
          goal: "Find the documentation section"
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessionId).toBeDefined();
      expect(data.status).toBe("started");
      expect(data.startUrl).toBe("https://example.com");
      expect(data.goal).toBe("Find the documentation section");
      
      sessionId = data.sessionId;
    });

    it("should reject invalid URLs", async () => {
      const res = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "not-a-valid-url",
          goal: "Test"
        })
      });

      expect(res.status).toBe(400);
    });

    it("should reject short goals", async () => {
      const res = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "https://example.com",
          goal: "Hi"
        })
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/agents/selenium/:sessionId/steps", () => {
    it("should return ordered steps for a session", async () => {
      // First create a session
      const startRes = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "https://example.com",
          goal: "Test navigation"
        })
      });
      
      const { sessionId: testSessionId } = await startRes.json();

      // Get steps (may be empty if not executed yet)
      const res = await fetch(`${API_BASE}/api/agents/selenium/${testSessionId}/steps`, {
        headers: { "Cookie": authCookie }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessionId).toBe(testSessionId);
      expect(Array.isArray(data.steps)).toBe(true);
    });

    it("should return 404 for non-existent session", async () => {
      const res = await fetch(`${API_BASE}/api/agents/selenium/non-existent-session/steps`, {
        headers: { "Cookie": authCookie }
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/agents/selenium/:sessionId/stop", () => {
    it("should save session and return step summary", async () => {
      // Create and execute a minimal session
      const startRes = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "https://example.com",
          goal: "Simple test"
        })
      });
      
      const { sessionId: testSessionId } = await startRes.json();

      // Stop the session
      const res = await fetch(`${API_BASE}/api/agents/selenium/${testSessionId}/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          excludedStepIndices: []
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessionId).toBe(testSessionId);
      expect(data.status).toBe("stopped");
      expect(Array.isArray(data.steps)).toBe(true);
      expect(typeof data.stepCount).toBe("number");
      expect(typeof data.durationMs).toBe("number");
    });

    it("should support excluding steps on stop", async () => {
      const startRes = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "https://example.com",
          goal: "Test with exclusions"
        })
      });
      
      const { sessionId: testSessionId } = await startRes.json();

      // Stop with exclusions
      const res = await fetch(`${API_BASE}/api/agents/selenium/${testSessionId}/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          excludedStepIndices: [0, 2, 4]
        })
      });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/agents/selenium/replay/:sessionId", () => {
    it.skipIf(!SHARED_DB_WITH_SERVER)("should create a replay session from recorded session", async () => {
      // Replay reads the RECORDING from agent_run_steps, so the original session
      // must actually have persisted steps. This previously started a fresh
      // session and immediately replayed it — nothing had been recorded, so the
      // endpoint correctly answered 404 ("No recording found") and the test read
      // that as a bug. Seed a recording directly rather than driving a browser,
      // which keeps this a test of the replay endpoint.
      const originalSessionId = `autopilot-replay-fixture-${Date.now()}`;
      recordedSessionIds.push(originalSessionId);

      await db.insert(agentRunSteps).values([
        {
          runId: originalSessionId,
          type: "action",
          content: "goto https://example.com",
          stepIndex: 0,
          action: "goto",
          value: "https://example.com",
          metadata: { value: "https://example.com" },
        },
        {
          runId: originalSessionId,
          type: "action",
          content: "click the documentation link",
          stepIndex: 1,
          action: "click",
          selector: "a[href='/docs']",
          metadata: {},
        },
      ] as any);

      const res = await fetch(`${API_BASE}/api/agents/selenium/replay/${originalSessionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.replaySessionId).toBeDefined();
      expect(data.originalSessionId).toBe(originalSessionId);
      expect(data.status).toBe("replay_started");
      expect(data.stepCount).toBe(2);
      expect(data.startUrl).toBe("https://example.com");
    });

    it("should return 404 for non-existent session to replay", async () => {
      const res = await fetch(`${API_BASE}/api/agents/selenium/replay/non-existent-session`, {
        method: "POST",
        headers: { "Cookie": authCookie }
      });

      expect(res.status).toBe(404);
    });
  });

  describe("Step Persistence", () => {
    // Opt-in: this drives real browser automation through /execute. It was
    // gated on SKIP_BROWSER, which defaults to false — so it ran by default,
    // found no browser, and burned the full 120s vitest timeout on every run.
    // Automation that needs a browser has to be asked for, not assumed.
    it.skipIf(!RUN_BROWSER_TESTS)("should persist steps to agentRunSteps table after execution", async () => {
      // Create session
      const startRes = await fetch(`${API_BASE}/api/agents/selenium/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        },
        body: JSON.stringify({
          url: "https://example.com",
          goal: "Simple navigation test"
        })
      });
      
      const { sessionId: testSessionId } = await startRes.json();

      // Execute (will run actual browser automation)
      // Note: This may take some time
      const executeRes = await fetch(`${API_BASE}/api/agents/selenium/${testSessionId}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": authCookie
        }
      });

      if (executeRes.ok) {
        // Verify steps were persisted to database
        const steps = await db.select()
          .from(agentRunSteps)
          .where(eq(agentRunSteps.runId, testSessionId))
          .orderBy(agentRunSteps.stepIndex);

        expect(steps.length).toBeGreaterThan(0);
        
        // Verify step structure
        const firstStep = steps[0];
        expect(firstStep.runId).toBe(testSessionId);
        expect(firstStep.stepIndex).toBeDefined();
        expect(firstStep.action).toBeDefined();
        expect(firstStep.metadata).toBeDefined();
      }
    });

    it("should maintain step order in database", async () => {
      // This drove the API and then read the result back, but the server writes
      // to the development database while this process is pinned to
      // oddjob_test — so the read always returned zero rows and the loop below
      // asserted nothing at all. Worse, it reported green.
      //
      // Ordered retrieval is a property of the query, not of the HTTP layer, so
      // it is now tested directly: insert deliberately out of order, and require
      // the orderBy to hand them back in stepIndex order.
      const testSessionId = `autopilot-order-fixture-${Date.now()}`;
      recordedSessionIds.push(testSessionId);

      const shuffledIndices = [3, 0, 4, 1, 2];
      await db.insert(agentRunSteps).values(
        shuffledIndices.map((idx) => ({
          runId: testSessionId,
          type: "action",
          content: `step ${idx}`,
          stepIndex: idx,
          action: idx === 0 ? "goto" : "click",
          value: idx === 0 ? "https://example.com" : null,
          metadata: {},
        })) as any
      );

      const steps = await db.select()
        .from(agentRunSteps)
        .where(eq(agentRunSteps.runId, testSessionId))
        .orderBy(agentRunSteps.stepIndex);

      expect(steps).toHaveLength(shuffledIndices.length);
      for (let i = 0; i < steps.length; i++) {
        expect(steps[i].stepIndex).toBe(i);
      }
    });
  });

  afterAll(async () => {
    // Cleanup test data — both the session under test and any seeded recordings,
    // which would otherwise accumulate in agent_run_steps on every run.
    const idsToClean = [sessionId, ...recordedSessionIds].filter(Boolean);
    for (const id of idsToClean) {
      try {
        await db.delete(agentRunSteps).where(eq(agentRunSteps.runId, id));
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
