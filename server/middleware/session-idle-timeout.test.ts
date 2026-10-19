import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sessionIdleTimeout, getIdleTimeoutMs } from "./session-idle-timeout.js";

function run(session: any, sessionID = "sid-1") {
  const req: any = { session, sessionID };
  const res: any = {};
  const next = vi.fn();
  sessionIdleTimeout(req, res, next);
  return { req, next };
}

const MINUTE = 60 * 1000;

describe("getIdleTimeoutMs", () => {
  beforeEach(() => {
    delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  });

  it("defaults to 20 minutes", () => {
    expect(getIdleTimeoutMs()).toBe(20 * MINUTE);
  });

  it("honours a configured value", () => {
    process.env.SESSION_IDLE_TIMEOUT_MINUTES = "5";
    expect(getIdleTimeoutMs()).toBe(5 * MINUTE);
  });

  it("falls back to the default rather than disabling on a bad value", () => {
    // A typo must not silently turn the control off.
    for (const bad of ["", "abc", "0", "-10"]) {
      process.env.SESSION_IDLE_TIMEOUT_MINUTES = bad;
      expect(getIdleTimeoutMs()).toBe(20 * MINUTE);
    }
  });
});

describe("sessionIdleTimeout", () => {
  beforeEach(() => {
    delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
    delete process.env.SESSION_IDLE_TIMEOUT_ENABLED;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through when there is no session", () => {
    const { next } = run(undefined);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves an anonymous session alone", () => {
    // Anonymous sessions hold the pre-auth CSRF token the login POST needs.
    const session: any = { csrfToken: "tok" };
    const { next } = run(session);

    expect(session.lastSeenAt).toBeUndefined();
    expect(session.csrfToken).toBe("tok");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("stamps lastSeenAt on the first authenticated request", () => {
    const session: any = { userId: "u1" };
    run(session);

    expect(session.lastSeenAt).toBe(Date.now());
    expect(session.userId).toBe("u1");
  });

  it("does not rewrite lastSeenAt for rapid successive requests", () => {
    // Every write costs a session store round-trip.
    const stamp = Date.now() - 5 * 1000;
    const session: any = { userId: "u1", lastSeenAt: stamp };
    run(session);

    expect(session.lastSeenAt).toBe(stamp);
  });

  it("refreshes lastSeenAt once past the touch interval", () => {
    const session: any = { userId: "u1", lastSeenAt: Date.now() - 2 * MINUTE };
    run(session);

    expect(session.lastSeenAt).toBe(Date.now());
  });

  it("keeps the session authenticated just inside the window", () => {
    const session: any = { userId: "u1", lastSeenAt: Date.now() - 19 * MINUTE };
    const { next } = run(session);

    expect(session.userId).toBe("u1");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("clears authentication once the idle window is exceeded", () => {
    const session: any = { userId: "u1", lastSeenAt: Date.now() - 21 * MINUTE };
    const { next } = run(session);

    expect(session.userId).toBeUndefined();
    expect(session.lastSeenAt).toBeUndefined();
    expect(session.expiredReason).toBe("idle_timeout");
    // The request continues so /api/user can answer authenticated:false.
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not destroy the session object when expiring", () => {
    // destroy() nulls req.session, and GET /api/user dereferences it
    // unconditionally to issue a CSRF token — expiry would 500 instead of
    // logging the user out.
    const session: any = { userId: "u1", lastSeenAt: Date.now() - 21 * MINUTE, csrfToken: "tok" };
    const { req } = run(session);

    expect(req.session).toBeDefined();
    expect(req.session.csrfToken).toBe("tok");
  });

  it("respects a shorter configured timeout", () => {
    process.env.SESSION_IDLE_TIMEOUT_MINUTES = "5";
    const session: any = { userId: "u1", lastSeenAt: Date.now() - 6 * MINUTE };
    run(session);

    expect(session.userId).toBeUndefined();
  });

  it("can be disabled entirely", () => {
    process.env.SESSION_IDLE_TIMEOUT_ENABLED = "false";
    const session: any = { userId: "u1", lastSeenAt: Date.now() - 100 * MINUTE };
    const { next } = run(session);

    expect(session.userId).toBe("u1");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
