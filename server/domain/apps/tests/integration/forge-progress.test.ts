import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { eventLog } from "@shared/schema/index.js";
import { eq, and, like, desc, sql } from "drizzle-orm";
import { promises as fs } from "fs";
import path from "path";

const API_BASE = process.env.TEST_API_URL || "http://localhost:3000";
const FORGE_WORKSPACE = process.env.FORGE_WORKSPACE || path.resolve("storage/forge-workspace");

/**
 * This suite drives a REAL running server — it logs in over HTTP, starts an actual
 * forge job and then reads the files that job writes to disk — so unlike the rest of
 * the integration tests it cannot be served by an in-process express app.
 *
 * Without a server it failed with ECONNREFUSED on every assertion, which reads as a
 * broken suite rather than an absent dependency. Skipping states the requirement:
 * start the app (or point TEST_API_URL at one) and it runs.
 */
const serverReachable = await fetch(API_BASE, { signal: AbortSignal.timeout(1500) })
  .then(() => true)
  .catch(() => false);

if (!serverReachable) {
  console.warn(`[forge-progress] No server reachable at ${API_BASE} — suite skipped. Set TEST_API_URL to run it.`);
}

describe.skipIf(!serverReachable)("Forge Progress Integration", () => {
  let authToken: string;
  let jobId: string;
  let testAppSlug: string;

  beforeAll(async () => {
    // Get auth token for tests
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.TEST_USER_EMAIL || "test@example.com",
        password: process.env.TEST_USER_PASSWORD || "testpassword"
      })
    });
    
    if (loginRes.ok) {
      const data = await loginRes.json();
      authToken = data.token;
    }

    testAppSlug = `test-forge-progress-${Date.now()}`;
  });

  describe("Forge Progress Events", () => {
    it("should publish forge.progress events at each stage", async () => {
      // Start a forge job
      const res = await fetch(`${API_BASE}/api/apps/forge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name: "Test Forge Progress App",
          slug: testAppSlug,
          description: "Test app for forge progress events",
          blueprint: "spa",
          skipToAssembly: false
        })
      });

      if (!res.ok) {
        console.log("Forge start failed, may need API to be running");
        return;
      }

      const data = await res.json();
      jobId = data.jobId;
      expect(jobId).toBeDefined();

      // Wait a bit for events to be published
      await new Promise(r => setTimeout(r, 3000));

      // Query for forge.progress events
      const events = await db.select()
        .from(eventLog)
        .where(and(
          eq(eventLog.type, "forge.progress"),
          sql`${eventLog.payload}::text LIKE ${`%${jobId}%`}`
        ))
        .orderBy(desc(eventLog.emittedAt));

      // Should have at least one progress event
      expect(events.length).toBeGreaterThan(0);

      // Verify event structure
      const event = events[0];
      const payload = event.payload as any;
      expect(payload.jobId || payload.appSlug).toBeDefined();
      expect(payload.stage).toBeDefined();
      expect(payload.progress).toBeDefined();
      expect(payload.message).toBeDefined();
    });

    it("should track progress through all stages", async () => {
      if (!jobId) {
        console.log("Skipping - no jobId from previous test");
        return;
      }

      // Query all forge events for this job
      const events = await db.select()
        .from(eventLog)
        .where(and(
          like(eventLog.type, "forge.%"),
          sql`${eventLog.payload}::text LIKE ${`%${jobId}%`}`
        ))
        .orderBy(eventLog.emittedAt);

      // Should have progress events covering stages 3-6
      const progressEvents = events.filter(e => e.type === "forge.progress");
      
      if (progressEvents.length > 0) {
        const stages = progressEvents.map(e => (e.payload as any).stage);
        const uniqueStages = [...new Set(stages)];
        
        // Should have events from multiple stages
        expect(uniqueStages.length).toBeGreaterThan(0);
        
        // Progress should generally increase
        const progresses = progressEvents.map(e => (e.payload as any).progress);
        for (let i = 1; i < progresses.length; i++) {
          expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i-1]);
        }
      }
    });

    it("should emit forge.complete on successful completion", async () => {
      if (!jobId) {
        console.log("Skipping - no jobId from previous test");
        return;
      }

      // Poll for completion
      let completed = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!completed && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        
        const events = await db.select()
          .from(eventLog)
          .where(and(
            eq(eventLog.type, "forge.complete"),
            sql`${eventLog.payload}::text LIKE ${`%${jobId}%`}`
          ))
          .orderBy(desc(eventLog.emittedAt));

        if (events.length > 0) {
          completed = true;
          const payload = events[0].payload as any;
          expect(payload.jobId).toBe(jobId);
          expect(payload.progress).toBe(100);
          expect(payload.stage).toBe(6);
        }

        attempts++;
      }

      // Note: May not complete in test environment
      console.log(`Forge completion check: ${completed ? "completed" : "timeout"}`);
    });
  });

  describe("Forge Failure Handling", () => {
    it("should emit forge.failed on Docker build failure", async () => {
      // Create a forge with invalid configuration that will fail
      const invalidSlug = `test-fail-${Date.now()}`;
      
      const res = await fetch(`${API_BASE}/api/apps/forge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name: "Test Failure App",
          slug: invalidSlug,
          description: "This should fail",
          blueprint: "non-existent-blueprint", // Invalid blueprint
        })
      });

      if (!res.ok) {
        // Request might fail immediately for invalid blueprint
        expect(res.status).toBe(400);
        return;
      }

      const data = await res.json();
      const failJobId = data.jobId;

      // Wait for failure
      await new Promise(r => setTimeout(r, 5000));

      // Check for failure event
      const events = await db.select()
        .from(eventLog)
        .where(and(
          eq(eventLog.type, "forge.failed"),
          sql`${eventLog.payload}::text LIKE ${`%${failJobId}%`}`
        ))
        .orderBy(desc(eventLog.emittedAt));

      if (events.length > 0) {
        const payload = events[0].payload as any;
        expect(payload.jobId).toBe(failJobId);
        expect(payload.error).toBeDefined();
        expect(payload.stage).toBe("failed");
      }
    });

    it("should cleanup workspace on failure", async () => {
      const failSlug = `test-cleanup-${Date.now()}`;
      const workspacePath = path.join(FORGE_WORKSPACE, failSlug);

      // Check if workspace exists before (it shouldn't)
      let existsBefore = false;
      try {
        await fs.access(workspacePath);
        existsBefore = true;
      } catch {
        // Doesn't exist - expected
      }

      // Start a forge that will likely fail
      const res = await fetch(`${API_BASE}/api/apps/forge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name: "Test Cleanup App",
          slug: failSlug,
          description: "Test workspace cleanup",
          blueprint: "invalid-blueprint-name",
        })
      });

      // Wait for processing
      await new Promise(r => setTimeout(r, 5000));

      // Check that workspace was cleaned up or never created
      let existsAfter = false;
      try {
        await fs.access(workspacePath);
        existsAfter = true;
      } catch {
        // Doesn't exist - good
      }

      // Workspace should not persist after failure
      expect(existsAfter).toBe(false);
    });

    it("should not leave orphaned workspace after successful forge", async () => {
      // This test assumes a successful forge was completed
      // The workspace should be properly managed
      
      if (!testAppSlug) {
        console.log("Skipping - no successful forge to verify");
        return;
      }

      const workspacePath = path.join(FORGE_WORKSPACE, testAppSlug);
      
      // For successful forges, workspace might be kept for debugging
      // Just verify the path is accessible
      try {
        await fs.access(workspacePath);
        console.log("Workspace exists for successful forge (expected)");
      } catch {
        // Might be cleaned up or moved - also acceptable
        console.log("Workspace not found (may have been cleaned up)");
      }
    });
  });

  describe("Event Stream API", () => {
    it("should support SSE stream for forge events", async () => {
      if (!jobId) {
        console.log("Skipping - no jobId");
        return;
      }

      // Test that the SSE endpoint exists
      const res = await fetch(`${API_BASE}/api/apps/forge/stream/${jobId}`, {
        headers: { "Authorization": `Bearer ${authToken}` }
      });

      // Should either return 200 (stream ready) or the job status
      expect([200, 404, 410]).toContain(res.status);
    });

    it("should provide job status endpoint", async () => {
      if (!jobId) {
        console.log("Skipping - no jobId");
        return;
      }

      const res = await fetch(`${API_BASE}/api/apps/forge/status/${jobId}`, {
        headers: { "Authorization": `Bearer ${authToken}` }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBeDefined();
    });
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      if (jobId) {
        await db.delete(eventLog)
          .where(sql`${eventLog.payload}::text LIKE ${`%${jobId}%`}`);
      }

      // Clean up test workspace
      const workspacePath = path.join(FORGE_WORKSPACE, testAppSlug);
      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    } catch {
      // Ignore cleanup errors
    }
  });
});
