import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the api-key service that apiKeyAuth lazy-imports.
const verifyKey = vi.fn();
vi.mock("./api-key.service.js", () => ({ apiKeyService: { verifyKey: (k: string) => verifyKey(k) } }));

import { apiKeyAuth, requireAuth } from "./security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

describe("apiKeyAuth middleware", () => {
  beforeEach(() => verifyKey.mockReset());

  it("no x-api-key header → passes through untouched", async () => {
    const req: any = { headers: {} };
    const next = vi.fn();
    await apiKeyAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.apiKeyAuth).toBeUndefined();
  });

  it("valid key → stashes org-scoped principal and calls next", async () => {
    verifyKey.mockResolvedValue({ id: 7, name: "copilot", organizationId: 291, revoked: false, expiresAt: null });
    const req: any = { headers: { "x-api-key": "rk_live_abc" } };
    const next = vi.fn();
    await apiKeyAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.apiKeyAuth.organizationId).toBe(291);
    expect(req.user.adminRole).toMatchObject({ isOrgAdmin: true, isSuperAdmin: false, organizationId: 291 });
  });

  it("invalid key → 401, does not call next", async () => {
    verifyKey.mockResolvedValue(null);
    const req: any = { headers: { "x-api-key": "bad" } };
    const res = mockRes();
    const next = vi.fn();
    await apiKeyAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("expired key → 401", async () => {
    verifyKey.mockResolvedValue({ id: 1, name: "old", organizationId: 1, revoked: false, expiresAt: new Date(Date.now() - 1000) });
    const req: any = { headers: { "x-api-key": "rk_live_old" } };
    const res = mockRes();
    const next = vi.fn();
    await apiKeyAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireAuth honours apiKeyAuth", () => {
  it("grants access when req.apiKeyAuth is present (even without req.user)", () => {
    const req: any = { method: "POST", path: "/api/missions", originalUrl: "/api/missions", headers: {}, apiKeyAuth: { id: 7, organizationId: 291 } };
    const next = vi.fn();
    requireAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("denies (401) when neither session user nor apiKeyAuth is present", () => {
    const req: any = { method: "POST", path: "/api/missions", originalUrl: "/api/missions", headers: {} };
    const res = mockRes();
    requireAuth(req, res, vi.fn());
    expect(res.statusCode).toBe(401);
  });
});

describe("getUserOrgContext resolves the key's org", () => {
  it("returns the api key's org, org-admin, never super-admin", async () => {
    const req: any = { headers: {}, query: {}, body: {}, apiKeyAuth: { id: 7, organizationId: 291 } };
    const ctx = await getUserOrgContext(req);
    expect(ctx).toMatchObject({ organizationId: 291, isOrgAdmin: true, isSuperAdmin: false });
  });
});
