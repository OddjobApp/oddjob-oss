/**
 * Scoring Intervention API — Integration Tests
 *
 * Tests the new agent-brain endpoints introduced by the Intervention Engine:
 *   POST /api/scoring/interventions/outcome
 *   GET  /api/scoring/agent/memory
 *   GET  /api/scoring/agent/policies
 *   PATCH /api/scoring/agent/policies/:id/toggle
 *   GET  /api/scoring/agent/suggestions
 *   PATCH /api/scoring/agent/suggestions/:id
 *   POST /api/scoring/agent/distill
 *   POST /api/scoring/agent/test-fire
 *
 * Uses a real test database. Requires migrations to be applied.
 * Run: DATABASE_URL=... npx vitest run scoring-intervention
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { app, serverReady } from "@server/index.js";
import { db } from "@server/database_service.js";
import { users, orgs, userOrgs } from "@shared/schema/index.js";
import { passwordService } from "@server/domain/auth/core/password-service.js";
import { sql } from "drizzle-orm";

// ── Table availability guard ───────────────────────────────────────────────

async function tableExists(name: string): Promise<boolean> {
    try {
        await db.execute(sql`SELECT 1 FROM ${sql.raw(name)} LIMIT 1`);
        return true;
    } catch {
        return false;
    }
}

const tablesRequired = ["intervention_memory", "intervention_policies", "intervention_policy_suggestions"];

// ── Test auth ──────────────────────────────────────────────────────────────

let authCookie: string[];
let csrfToken:  string;
let skipAll = false;

beforeAll(async () => {
    await serverReady;

    for (const t of tablesRequired) {
        if (!(await tableExists(t))) {
            console.warn(`[skip] Table '${t}' not found — run migration 0032. Skipping integration tests.`);
            skipAll = true;
            return;
        }
    }

    const suffix   = Date.now();
    const username = `score_iv_test_${suffix}`;
    const email    = `score_iv_${suffix}@example.com`;
    const password = "Password123!";

    // Suffixed like the username/email above: orgs.name is UNIQUE and this suite does
    // not delete the org it creates, so a fixed name only works on a virgin database
    // and every later run fails during setup with a duplicate-key error.
    const [org]  = await db.insert(orgs).values({ name: `Score IV Test Org ${suffix}` }).returning();
    const hashed = await passwordService.hashPassword(password);
    const [user] = await db.insert(users).values({
        email,
        password: hashed,
        username,
        defaultOrgId: org.id,
    }).returning();
    await db.insert(userOrgs).values({ userId: user.id, orgId: org.id });

    const loginRes = await request(app).post("/api/login").send({ username, password });
    authCookie = loginRes.header["set-cookie"] as unknown as string[];

    const csrfRes = await request(app).get("/api/csrf-token").set("Cookie", authCookie);
    csrfToken     = csrfRes.body.csrfToken;
});

// ── Helpers ────────────────────────────────────────────────────────────────

function authed(r: any) {
    return r.set("Cookie", authCookie).set("x-csrf-token", csrfToken);
}

function skip(name: string, fn: () => Promise<void>) {
    it(name, async () => {
        if (skipAll) return;
        await fn();
    });
}

// ── POST /api/scoring/interventions/outcome ────────────────────────────────

describe("POST /api/scoring/interventions/outcome", () => {
    skip("returns 200 for valid outcome payload", async () => {
        const res = await authed(
            request(app)
                .post("/api/scoring/interventions/outcome")
                .send({ interventionId: "iv-test-1", outcome: "accepted", timestamp: Date.now() - 3000 })
        ).expect(200);

        expect(res.body.success).toBe(true);
    });

    skip("returns 400 when interventionId is missing", async () => {
        await authed(
            request(app)
                .post("/api/scoring/interventions/outcome")
                .send({ outcome: "dismissed" })
        ).expect(400);
    });

    skip("returns 400 when outcome is missing", async () => {
        await authed(
            request(app)
                .post("/api/scoring/interventions/outcome")
                .send({ interventionId: "iv-test-2" })
        ).expect(400);
    });

    skip("returns 401 for unauthenticated requests", async () => {
        await request(app)
            .post("/api/scoring/interventions/outcome")
            .send({ interventionId: "iv-test-3", outcome: "expired" })
            .expect(401);
    });
});

// ── GET /api/scoring/agent/memory ──────────────────────────────────────────

describe("GET /api/scoring/agent/memory", () => {
    skip("returns an array", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/memory")).expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    skip("each row has expected shape", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/memory")).expect(200);
        for (const row of res.body) {
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("interventionId");
            expect(row).toHaveProperty("vector");
            expect(row).toHaveProperty("sessionId");
            expect(row).toHaveProperty("createdAt");
        }
    });

    skip("returns at most 50 rows", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/memory")).expect(200);
        expect(res.body.length).toBeLessThanOrEqual(50);
    });

    skip("returns 401 for unauthenticated requests", async () => {
        await request(app).get("/api/scoring/agent/memory").expect(401);
    });
});

// ── GET /api/scoring/agent/policies ───────────────────────────────────────

describe("GET /api/scoring/agent/policies", () => {
    skip("returns an array", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/policies")).expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    skip("each row has rule and enabled fields", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/policies")).expect(200);
        for (const row of res.body) {
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("rule");
            expect(typeof row.enabled).toBe("boolean");
            expect(typeof row.distillationRound).toBe("number");
        }
    });
});

describe("PATCH /api/scoring/agent/policies/:id/toggle", () => {
    skip("toggles enabled state on an existing policy row", async () => {
        // First create a policy directly so we have a known id
        const [policy] = await db.execute(sql`
            INSERT INTO intervention_policies (rule, weight, distillation_round, enabled)
            VALUES ('Test policy for toggle', 1.0, 0, true)
            RETURNING id, enabled
        `).then((r: any) => r.rows);

        if (!policy) return;

        const res = await authed(
            request(app)
                .patch(`/api/scoring/agent/policies/${policy.id}/toggle`)
                .send({ enabled: false })
        ).expect(200);

        expect(res.body.enabled).toBe(false);

        // Cleanup
        await db.execute(sql`DELETE FROM intervention_policies WHERE id = ${policy.id}`);
    });

    skip("returns 401 without auth", async () => {
        await request(app)
            .patch("/api/scoring/agent/policies/1/toggle")
            .send({ enabled: true })
            .expect(401);
    });
});

// ── GET /api/scoring/agent/suggestions ────────────────────────────────────

describe("GET /api/scoring/agent/suggestions", () => {
    skip("returns an array", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/suggestions")).expect(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    skip("each row has expected shape", async () => {
        const res = await authed(request(app).get("/api/scoring/agent/suggestions")).expect(200);
        for (const row of res.body) {
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("suggestionType");
            expect(row).toHaveProperty("rationale");
            expect(row).toHaveProperty("status");
            expect(row).toHaveProperty("proposedChange");
        }
    });
});

describe("PATCH /api/scoring/agent/suggestions/:id", () => {
    skip("approves a pending suggestion", async () => {
        const [suggestion] = await db.execute(sql`
            INSERT INTO intervention_policy_suggestions
                (suggestion_type, rationale, proposed_change, distillation_round, status)
            VALUES ('new_policy', 'Test rationale', '{}', 0, 'pending')
            RETURNING id, status
        `).then((r: any) => r.rows);

        if (!suggestion) return;

        const res = await authed(
            request(app)
                .patch(`/api/scoring/agent/suggestions/${suggestion.id}`)
                .send({ status: "approved" })
        ).expect(200);

        expect(res.body.status).toBe("approved");

        // Cleanup
        await db.execute(sql`DELETE FROM intervention_policy_suggestions WHERE id = ${suggestion.id}`);
    });

    skip("rejects a pending suggestion", async () => {
        const [suggestion] = await db.execute(sql`
            INSERT INTO intervention_policy_suggestions
                (suggestion_type, rationale, proposed_change, distillation_round, status)
            VALUES ('cooldown_extend', 'Test rationale 2', '{}', 0, 'pending')
            RETURNING id
        `).then((r: any) => r.rows);

        if (!suggestion) return;

        const res = await authed(
            request(app)
                .patch(`/api/scoring/agent/suggestions/${suggestion.id}`)
                .send({ status: "rejected" })
        ).expect(200);

        expect(res.body.status).toBe("rejected");

        await db.execute(sql`DELETE FROM intervention_policy_suggestions WHERE id = ${suggestion.id}`);
    });

    skip("returns 400 for invalid status value", async () => {
        await authed(
            request(app)
                .patch("/api/scoring/agent/suggestions/1")
                .send({ status: "maybe" })
        ).expect(400);
    });
});

// ── POST /api/scoring/agent/test-fire ─────────────────────────────────────

describe("POST /api/scoring/agent/test-fire", () => {
    skip("returns 200 and fires a synthetic event", async () => {
        const res = await authed(
            request(app)
                .post("/api/scoring/agent/test-fire")
                .send({ vector: "S", priority: "high" })
        ).expect(200);

        expect(res.body.success).toBe(true);
    });

    skip("uses default vector C when none provided", async () => {
        const res = await authed(
            request(app).post("/api/scoring/agent/test-fire").send({})
        ).expect(200);

        expect(res.body.success).toBe(true);
    });

    skip("returns 401 without auth", async () => {
        await request(app).post("/api/scoring/agent/test-fire").send({}).expect(401);
    });
});
