/**
 * Infra Health API — Integration Tests
 *
 * Tests DLQ and circuit breaker admin endpoints.
 * Requires a running server (await serverReady) and super-admin auth.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, serverReady } from "@server/index.js";
import { db } from "@server/database_service.js";
import { users, orgs, userOrgs, adminRoles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { passwordService } from "@server/domain/auth/core/password-service.js";
import {
    createCircuitBreaker,
    resetCircuit,
    withCircuitBreaker,
    CircuitOpenError,
    getAllCircuitStatuses,
    getCircuitState,
} from "@server/domain/admin/core/circuit-breaker.service.js";
import { dlqQueue } from "@server/domain/admin/core/dead-letter-queue.service.js";

let authCookie: string[];
let csrfToken: string;
let testUserId: string;
let testOrgId: number;

beforeAll(async () => {
    await serverReady;

    const username = `infra_test_${Date.now()}`;
    const email = `infra_test_${Date.now()}@example.com`;
    const password = "Password123!";

    const [org] = await db.insert(orgs).values({ name: "Infra Test Org" }).returning();
    testOrgId = org.id;

    const hashed = await passwordService.hashPassword(password);
    const [user] = await db.insert(users).values({
        email,
        password: hashed,
        username,
        defaultOrgId: testOrgId,
    }).returning();
    testUserId = user.id;

    await db.insert(userOrgs).values({ userId: testUserId, orgId: testOrgId });
    // Super admin required for these endpoints (userId is text/UUID)
    await db.insert(adminRoles).values({ userId: testUserId, role: "super_admin" });

    const loginRes = await request(app).post("/api/login").send({ username, password });
    authCookie = loginRes.header["set-cookie"] as unknown as string[];

    const csrfRes = await request(app).get("/api/csrf-token").set("Cookie", authCookie);
    csrfToken = csrfRes.body.csrfToken;
});

afterAll(async () => {
    if (testUserId) {
        await db.delete(adminRoles).where(eq(adminRoles.userId, testUserId)).catch(() => {});
        await db.delete(userOrgs).where(eq(userOrgs.userId, testUserId)).catch(() => {});
        await db.delete(users).where(eq(users.id, testUserId)).catch(() => {});
    }
    if (testOrgId) {
        await db.delete(orgs).where(eq(orgs.id, testOrgId)).catch(() => {});
    }
});

// ─── DLQ API ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/dlq", () => {
    it("returns jobs array and stats", async () => {
        const res = await request(app)
            .get("/api/admin/dlq")
            .set("Cookie", authCookie)
            .expect(200);

        expect(res.body).toHaveProperty("jobs");
        expect(res.body).toHaveProperty("stats");
        expect(Array.isArray(res.body.jobs)).toBe(true);
        expect(res.body.stats).toHaveProperty("total");
    });

    it("rejects unauthenticated requests", async () => {
        await request(app).get("/api/admin/dlq").expect(401);
    });
});

describe("POST /api/admin/dlq/:jobId/retry", () => {
    it("returns 404 for non-existent job", async () => {
        await request(app)
            .post("/api/admin/dlq/non-existent-job-id-123/retry")
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .expect(404);
    });
});

describe("DELETE /api/admin/dlq/:jobId", () => {
    it("returns 404 for non-existent job", async () => {
        await request(app)
            .delete("/api/admin/dlq/non-existent-job-id-123")
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .expect(404);
    });
});

describe("DELETE /api/admin/dlq (purge all)", () => {
    it("returns purged count", async () => {
        const res = await request(app)
            .delete("/api/admin/dlq")
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .expect(200);

        expect(res.body).toHaveProperty("purged");
        expect(typeof res.body.purged).toBe("number");
    });
});

// ─── Circuit Breaker API ──────────────────────────────────────────────────────

describe("GET /api/admin/circuit-breakers", () => {
    it("returns array of circuit breaker states", async () => {
        const res = await request(app)
            .get("/api/admin/circuit-breakers")
            .set("Cookie", authCookie)
            .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
        if (res.body.length > 0) {
            const cb = res.body[0];
            expect(cb).toHaveProperty("name");
            expect(cb).toHaveProperty("state");
            expect(["CLOSED", "OPEN", "HALF_OPEN"]).toContain(cb.state);
        }
    });

    it("includes pre-initialized circuits", async () => {
        const res = await request(app)
            .get("/api/admin/circuit-breakers")
            .set("Cookie", authCookie)
            .expect(200);

        // openai and qdrant are initialized at startup
        const names = res.body.map((cb: any) => cb.name);
        expect(names).toContain("openai");
        expect(names).toContain("qdrant");
    });
});

describe("POST /api/admin/circuit-breakers/:name/reset", () => {
    it("resets an open circuit to CLOSED", async () => {
        // Manually open a test circuit
        const testName = `test-circuit-${Date.now()}`;
        createCircuitBreaker({ name: testName, failureThreshold: 1, resetTimeoutMs: 999999, halfOpenMaxAttempts: 1 });

        // Force it open by triggering a failure
        try {
            await withCircuitBreaker(testName, async () => { throw new Error("forced failure"); });
        } catch {}

        expect(getCircuitState(testName)?.state).toBe("OPEN");

        const res = await request(app)
            .post(`/api/admin/circuit-breakers/${testName}/reset`)
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .expect(200);

        expect(res.body.state).toBe("CLOSED");
        expect(getCircuitState(testName)?.state).toBe("CLOSED");
    });

    it("returns 404 for unknown circuit", async () => {
        await request(app)
            .post("/api/admin/circuit-breakers/unknown-circuit-xyz/reset")
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .expect(404);
    });
});

// ─── Circuit Breaker Unit Tests ───────────────────────────────────────────────

describe("CircuitBreakerService unit", () => {
    it("starts in CLOSED state", () => {
        const name = `unit-test-${Date.now()}`;
        createCircuitBreaker({ name, failureThreshold: 3, resetTimeoutMs: 5000, halfOpenMaxAttempts: 2 });
        expect(getCircuitState(name)?.state).toBe("CLOSED");
    });

    it("transitions CLOSED → OPEN after threshold failures", async () => {
        const name = `unit-open-${Date.now()}`;
        createCircuitBreaker({ name, failureThreshold: 2, resetTimeoutMs: 999999, halfOpenMaxAttempts: 1 });

        for (let i = 0; i < 2; i++) {
            try {
                await withCircuitBreaker(name, async () => { throw new Error("fail"); });
            } catch {}
        }

        expect(getCircuitState(name)?.state).toBe("OPEN");
    });

    it("throws CircuitOpenError when OPEN and no fallback provided", async () => {
        const name = `unit-open-throw-${Date.now()}`;
        createCircuitBreaker({ name, failureThreshold: 1, resetTimeoutMs: 999999, halfOpenMaxAttempts: 1 });

        try { await withCircuitBreaker(name, async () => { throw new Error("fail"); }); } catch {}

        await expect(withCircuitBreaker(name, async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
    });

    it("uses fallback when circuit is OPEN", async () => {
        const name = `unit-fallback-${Date.now()}`;
        createCircuitBreaker({ name, failureThreshold: 1, resetTimeoutMs: 999999, halfOpenMaxAttempts: 1 });

        try { await withCircuitBreaker(name, async () => { throw new Error("fail"); }); } catch {}

        const result = await withCircuitBreaker(name, async () => "primary", async () => "fallback");
        expect(result).toBe("fallback");
    });

    it("transitions HALF_OPEN → CLOSED on success", async () => {
        const name = `unit-halfopen-${Date.now()}`;
        createCircuitBreaker({ name, failureThreshold: 1, resetTimeoutMs: 1, halfOpenMaxAttempts: 3 });

        try { await withCircuitBreaker(name, async () => { throw new Error("fail"); }); } catch {}
        await new Promise(r => setTimeout(r, 10)); // let resetTimeout pass

        // First call in HALF_OPEN succeeds → should close
        await withCircuitBreaker(name, async () => "ok");
        expect(getCircuitState(name)?.state).toBe("CLOSED");
    });

    it("resetCircuit forces CLOSED and zeros counters", async () => {
        const name = `unit-reset-${Date.now()}`;
        createCircuitBreaker({ name, failureThreshold: 1, resetTimeoutMs: 999999, halfOpenMaxAttempts: 1 });

        try { await withCircuitBreaker(name, async () => { throw new Error("fail"); }); } catch {}
        expect(getCircuitState(name)?.state).toBe("OPEN");

        resetCircuit(name);
        const stats = getCircuitState(name);
        expect(stats?.state).toBe("CLOSED");
        expect(stats?.failures).toBe(0);
        expect(stats?.lastFailure).toBeNull();
    });
});
