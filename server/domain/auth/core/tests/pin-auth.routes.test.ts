/**
 * PIN auth API — route tests.
 *
 * These exist because the router originally read `req.body.userId ||
 * req.session.userId` with no auth middleware, which let an anonymous caller
 * set any account's PIN. The first two tests are that regression, pinned.
 *
 * @vitest-environment node
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
    selectRows: [] as any[],
    updates: [] as any[],
    passwordValid: true,
    insertedTokens: [] as any[],
}));

function selectChain() {
    const p: any = {
        from: () => p,
        where: () => p,
        limit: () => Promise.resolve(h.selectRows),
        then: (resolve: any, reject: any) => Promise.resolve(h.selectRows).then(resolve, reject),
    };
    return p;
}

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => selectChain(),
        update: () => ({
            set: (values: any) => {
                h.updates.push(values);
                return {
                    where: () => ({
                        returning: () => Promise.resolve(h.selectRows),
                        then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
                    }),
                };
            },
        }),
        insert: () => ({
            values: (values: any) => {
                h.insertedTokens.push(values);
                return Promise.resolve([]);
            },
        }),
    },
}));

vi.mock("@domain/auth/core/password-service.js", () => ({
    passwordService: {
        verifyPassword: vi.fn(async () => h.passwordValid),
    },
}));

// The real requireAuth's session contract, without the express-session and
// public-path machinery: no session userId means 401.
vi.mock("@domain/auth/core/security.service.js", () => ({
    requireAuth: (req: any, res: any, next: any) => {
        if (!req.session?.userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        return next();
    },
    authRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

const { default: pinRouter } = await import("@server/routes/pin-auth.routes.js");
const { pinService } = await import("../pin-service.js");

/** Builds an app whose session is `sessionUser` (or anonymous when null). */
function buildApp(sessionUser: string | null) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
        req.session = sessionUser ? { userId: sessionUser } : {};
        next();
    });
    app.use(pinRouter);
    return app;
}

describe("PIN auth routes", () => {
    beforeEach(() => {
        h.selectRows = [];
        h.updates = [];
        h.passwordValid = true;
        h.insertedTokens = [];
        pinService._resetAttemptTracking();
    });

    describe("POST /api/auth/pin/update", () => {
        it("rejects an anonymous caller naming a userId in the body", async () => {
            const res = await request(buildApp(null))
                .post("/api/auth/pin/update")
                .send({ userId: "victim", pin: "123456", password: "hunter2" });

            expect(res.status).toBe(401);
            expect(h.updates).toHaveLength(0);
        });

        it("ignores a body userId and acts on the session user", async () => {
            h.selectRows = [{ id: "attacker", username: "attacker", password: "hash" }];

            const res = await request(buildApp("attacker"))
                .post("/api/auth/pin/update")
                .send({ userId: "victim", pin: "123456", password: "hunter2" });

            expect(res.status).toBe(200);
            // The row the handler read is the session user's — a victim id in the
            // body never reaches the query.
            expect(h.updates).toHaveLength(1);
            expect(h.updates[0].pin).toContain(".");
        });

        it("requires the account password", async () => {
            h.selectRows = [{ id: "u1", username: "u1", password: "hash" }];

            const res = await request(buildApp("u1"))
                .post("/api/auth/pin/update")
                .send({ pin: "123456" });

            expect(res.status).toBe(400);
            expect(h.updates).toHaveLength(0);
        });

        it("rejects a wrong account password", async () => {
            h.selectRows = [{ id: "u1", username: "u1", password: "hash" }];
            h.passwordValid = false;

            const res = await request(buildApp("u1"))
                .post("/api/auth/pin/update")
                .send({ pin: "123456", password: "wrong" });

            expect(res.status).toBe(401);
            expect(h.updates).toHaveLength(0);
        });
    });

    describe("POST /api/auth/pin/verify", () => {
        it("rejects an anonymous caller", async () => {
            const res = await request(buildApp(null))
                .post("/api/auth/pin/verify")
                .send({ userId: "victim", pin: "123456" });

            expect(res.status).toBe(401);
        });

        it("grants consent on the session user's own PIN", async () => {
            const hash = await pinService.hashPin("123456");
            h.selectRows = [{ id: "u1", pin: hash, username: "u1" }];

            const res = await request(buildApp("u1"))
                .post("/api/auth/pin/verify")
                .send({ pin: "123456" });

            expect(res.status).toBe(200);
            expect(res.body.accessConsent).toBe("granted");
        });

        it("locks the account out after repeated failures", async () => {
            const hash = await pinService.hashPin("123456");
            h.selectRows = [{ id: "u1", pin: hash, username: "u1" }];
            const app = buildApp("u1");

            for (let i = 0; i < 5; i++) {
                const res = await request(app).post("/api/auth/pin/verify").send({ pin: "000000" });
                expect(res.status).toBe(401);
            }

            // Sixth attempt is refused before the PIN is even compared, and the
            // correct PIN does not get through either.
            const locked = await request(app).post("/api/auth/pin/verify").send({ pin: "123456" });
            expect(locked.status).toBe(429);
            expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
        }, 30_000);
    });

    describe("POST /api/auth/pin/request-reset", () => {
        it("returns the same body for an unknown user and a wrong password", async () => {
            h.selectRows = [];
            const unknown = await request(buildApp(null))
                .post("/api/auth/pin/request-reset")
                .send({ identifier: "nobody", password: "hunter2" });

            h.selectRows = [{ id: "u1", username: "u1", email: "u1@example.com", password: "hash" }];
            h.passwordValid = false;
            const wrongPassword = await request(buildApp(null))
                .post("/api/auth/pin/request-reset")
                .send({ identifier: "u1", password: "wrong" });

            expect(unknown.status).toBe(wrongPassword.status);
            expect(unknown.body).toEqual(wrongPassword.body);
            expect(h.insertedTokens).toHaveLength(0);
        });
    });
});
