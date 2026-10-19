/**
 * Event Stream — Integration Tests
 *
 * Tests the SSE endpoint, buffer replay on connect, type/org filtering,
 * and recent event retrieval.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import http from "node:http";
import { app, serverReady } from "@server/index.js";
import { db } from "@server/database_service.js";
import { users, orgs, userOrgs } from "@shared/schema/index.js";
import { passwordService } from "@server/domain/auth/core/password-service.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";

let authCookie: string[];
let orgId: number;
let csrfToken: string;

beforeAll(async () => {
    await serverReady;

    const username = `sse_test_${Date.now()}`;
    const email = `sse_test_${Date.now()}@example.com`;
    const password = "Password123!";

    const [org] = await db.insert(orgs).values({ name: `SSE Test Org ${Date.now()}` }).returning();
    const hashedPassword = await passwordService.hashPassword(password);
    const [user] = await db.insert(users).values({
        email,
        password: hashedPassword,
        username,
        defaultOrgId: org.id,
    }).returning();
    await db.insert(userOrgs).values({ userId: user.id, orgId: org.id });
    orgId = org.id;

    const loginRes = await request(app).post("/api/login").send({ username, password });
    authCookie = loginRes.header["set-cookie"] as unknown as string[];

    const csrfRes = await request(app).get("/api/csrf-token").set("Cookie", authCookie);
    csrfToken = csrfRes.body.csrfToken;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/events/live", () => {
    it("returns recent event buffer as JSON array", async () => {
        const res = await request(app)
            .get("/api/events/live")
            .set("Cookie", authCookie)
            .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
    });

    it("respects limit query param", async () => {
        const res = await request(app)
            .get("/api/events/live?limit=5")
            .set("Cookie", authCookie)
            .expect(200);

        expect(res.body.length).toBeLessThanOrEqual(5);
    });

    it("filters by type query param", async () => {
        // Publish a distinctly-typed test event into the buffer
        await eventStream.publish("test.sse_filter_marker", { hello: "world" }, {}, "test");

        // Give buffer a moment to update
        await new Promise(r => setTimeout(r, 50));

        const res = await request(app)
            .get("/api/events/live?type=test.sse_filter_marker")
            .set("Cookie", authCookie)
            .expect(200);

        const found = res.body.find((e: any) => e.eventType === "test.sse_filter_marker");
        expect(found).toBeDefined();
        expect(found.payload).toMatchObject({ hello: "world" });
    });
});

describe("GET /api/events/stats", () => {
    it("returns stats object with expected shape", async () => {
        const res = await request(app)
            .get("/api/events/stats")
            .set("Cookie", authCookie)
            .expect(200);

        expect(res.body).toHaveProperty("total");
        expect(res.body).toHaveProperty("byType");
        expect(res.body).toHaveProperty("bySource");
        expect(res.body).toHaveProperty("daily");
    });
});

describe("POST /api/events/emit", () => {
    it("emits a custom event and returns eventId", async () => {
        const res = await request(app)
            .post("/api/events/emit")
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .send({ type: "test.custom_emit", payload: { value: 42 }, source: "test" })
            .expect(201);

        expect(res.body).toHaveProperty("eventId");
        expect(typeof res.body.eventId).toBe("string");
    });

    it("rejects emit without type or payload", async () => {
        await request(app)
            .post("/api/events/emit")
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .send({ source: "test" })
            .expect(400);
    });
});

// The stream and /live share one recent buffer across every tenant. These used
// to test a copy of the handler's regex, which stayed green while the handler
// sent every tenant's events to every client. Pattern rules are unit-tested in
// infrastructure/__tests__/event-visibility.unit.test.ts.
describe("GET /api/events/live tenant scoping", () => {
    it("returns the viewer's own org events and system events, never another org's", async () => {
        const marker = `test.scope_${Date.now()}`;
        await eventStream.publish(marker, { whose: "mine" }, { organizationId: orgId }, "test");
        await eventStream.publish(marker, { whose: "theirs" }, { organizationId: orgId + 100000 }, "test");
        await eventStream.publish(marker, { whose: "system" }, {}, "test");
        await new Promise(r => setTimeout(r, 50));

        const res = await request(app)
            .get(`/api/events/live?type=${marker}`)
            .set("Cookie", authCookie)
            .expect(200);

        const whose = res.body.map((e: any) => e.payload.whose).sort();
        expect(whose).toEqual(["mine", "system"]);
    });

    it("refuses an org the viewer does not belong to", async () => {
        await request(app)
            .get(`/api/events/live?organizationId=${orgId + 100000}`)
            .set("Cookie", authCookie)
            .expect(403);
    });
});

describe("GET /api/events/stream", () => {
    it("refuses to open a stream for an org the viewer does not belong to", async () => {
        await request(app)
            .get(`/api/events/stream?organizationId=${orgId + 100000}`)
            .set("Cookie", authCookie)
            .expect(403);
    });
});

describe("GET /api/events/stream delivery to a browser", () => {
    // Browsers always send Accept-Encoding. The compression middleware used to
    // brotli-encode the stream, and the encoder held every small event: this
    // delivered 0 bytes to a browser while a client without Accept-Encoding
    // (supertest, curl) saw everything.
    it("delivers a live event when the client accepts compressed responses", async () => {
        const server = http.createServer(app).listen(0);
        const port = (server.address() as any).port;
        const cookie = authCookie.map(c => c.split(";")[0]).join("; ");
        let received = "";
        let contentEncoding: string | undefined;
        const req = http.get({
            port,
            path: `/api/events/stream?organizationId=${orgId}`,
            headers: { cookie, accept: "text/event-stream", "accept-encoding": "gzip, deflate, br" },
        }, (res) => {
            contentEncoding = res.headers["content-encoding"] as string | undefined;
            res.setEncoding("utf8");
            res.on("data", (d: string) => { received += d; });
        });
        try {
            await new Promise(r => setTimeout(r, 1000));
            const marker = `test.delivery_${Date.now()}`;
            await eventStream.publish(marker, { n: 1 }, { organizationId: orgId }, "test");
            await new Promise(r => setTimeout(r, 1500));

            expect(contentEncoding).toBeUndefined();
            expect(received).toContain(marker);
        } finally {
            req.destroy();
            server.close();
        }
    }, 20000);
});
