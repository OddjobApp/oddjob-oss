import { describe, it, expect, vi } from "vitest";
import { requireAuth } from "./security.service.js";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

/** An anonymous request: no user, no API key, no internal token. */
function run(method: string, originalUrl: string) {
  const path = originalUrl.split("?")[0];
  const req: any = { method, originalUrl, path, headers: {}, session: {} };
  const res = mockRes();
  const next = vi.fn();
  requireAuth(req, res, next);
  return { passed: next.mock.calls.length === 1, status: res.statusCode };
}

describe("requireAuth public routes match whole path segments", () => {
  it("keeps the auth entry points public", () => {
    expect(run("GET", "/api/user").passed).toBe(true);
    expect(run("GET", "/api/user?probe=1").passed).toBe(true);
    expect(run("GET", "/api/csrf-token").passed).toBe(true);
    expect(run("POST", "/api/auth/reset-password").passed).toBe(true);
    expect(run("POST", "/api/auth/reset-password/abc123").passed).toBe(true);
  });

  // GET /api/users served every user on the platform, with emails, to
  // anonymous callers because '/api/users'.startsWith('/api/user').
  it("does not open routes that merely share a prefix with a public one", () => {
    for (const url of ["/api/users", "/api/users/current", "/api/user/persona", "/api/user-settings", "/api/users?x=1"]) {
      const result = run("GET", url);
      expect({ url, ...result }).toEqual({ url, passed: false, status: 401 });
    }
  });

  it("only GET /api/user is public, not other methods", () => {
    expect(run("POST", "/api/user").status).toBe(401);
  });
});
