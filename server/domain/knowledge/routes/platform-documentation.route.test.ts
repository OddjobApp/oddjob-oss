/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("@domain/core/auth/security.service.js", () => ({
  requireAuth: (req: any, res: any, next: any) => req.headers["x-test-user"] ? next() : res.status(401).end(),
}));
vi.mock("@server/utils/auth-context.js", () => ({
  getUserOrgContext: async (req: any) => ({ organizationId: Number(req.headers["x-test-org"]) || null }),
  requireOrgId: (context: any) => { if (!context.organizationId) throw Object.assign(new Error("Organization required"), { status: 400 }); return context.organizationId; },
}));
import router from "./platform-documentation.route.js";
const app = express();
app.use("/api/knowledge/platform-docs", router);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || err.statusCode || 500).json({ message: err.message }));
const headers = (org: number) => ({ "x-test-user": "member", "x-test-org": String(org) });
describe("mounted read-only platform documentation API", () => {
  it("requires authentication and resolved org membership", async () => {
    expect((await request(app).get("/api/knowledge/platform-docs")).status).toBe(401);
    expect((await request(app).get("/api/knowledge/platform-docs").set({ "x-test-user": "member" })).status).toBe(400);
  });
  it("lists and reads the same published corpus from two org contexts", async () => {
    const first = await request(app).get("/api/knowledge/platform-docs").set(headers(1));
    const second = await request(app).get("/api/knowledge/platform-docs").set(headers(2));
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(first.body.documents.length).toBeGreaterThan(0);
    const doc = await request(app).get("/api/knowledge/platform-docs/platform:keys-and-credentials").set(headers(2));
    expect(doc.status).toBe(200);
    expect(doc.body.textContent).toContain("BYOK");
    expect((await request(app).get("/api/knowledge/platform-docs/42").set(headers(1))).status).toBe(404);
  });
  it("searches without vectors and rejects malformed queries", async () => {
    const response = await request(app).get("/api/knowledge/platform-docs?q=BYOK%20credentials").set(headers(2));
    expect(response.body.documents.some((doc: any) => doc.id === "platform:keys-and-credentials")).toBe(true);
    expect((await request(app).get("/api/knowledge/platform-docs?q[a]=b").set(headers(1))).status).toBe(400);
  });
  it.each(["post", "put", "patch", "delete"])("does not expose a %s publication route", async method => {
    const response = await (request(app) as any)[method]("/api/knowledge/platform-docs/platform:first-mission").set(headers(1)).send({ scope: "platform", textContent: "tenant edit" });
    expect(response.status).toBe(404);
  });
});
