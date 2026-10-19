/**
 * Server-enforced session idle timeout.
 *
 * WHY THIS EXISTS: the session cookie is `maxAge: 30 days` and non-rolling, and
 * the only idle timeout was `useSessionTimeout` in the browser. That hook is a
 * UX convenience, not a control — it lives in the page it protects, so closing
 * the tab, reloading, or simply not running the client leaves the session valid
 * for the full 30 days. A cookie captured from an unattended machine stayed
 * good for a month.
 *
 * This middleware makes idleness a server-side fact: every authenticated
 * request stamps `lastSeenAt` on the session, and a request arriving more than
 * IDLE_TIMEOUT after the last one clears the session's authentication.
 *
 * IT CLEARS RATHER THAN DESTROYS. `req.session.destroy()` nulls `req.session`,
 * and `GET /api/user` then dereferences it unconditionally when issuing a CSRF
 * token (auth.controller.ts) — expiry would 500 instead of logging out. Dropping
 * `userId` leaves a valid anonymous session, which is exactly the state a
 * never-logged-in visitor is in: `populateUserContext` finds no user, so
 * `requireAuth` answers 401 and `/api/user` answers `{authenticated:false}`,
 * which is the signal the client already redirects on.
 *
 * ORDERING: must run after the session middleware and BEFORE
 * `populateUserContext`, or `req.user` is populated from the very session being
 * expired and the request proceeds authenticated.
 */

import type { Request, Response, NextFunction } from "express";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SessionIdleTimeout");

/** Minutes of inactivity before a session stops being authenticated. */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 20;

/**
 * Requests closer together than this do not rewrite `lastSeenAt`.
 *
 * Every write marks the session dirty and costs a store round-trip, so stamping
 * on literally every request would add a session UPDATE to each API call. The
 * cost of the throttle is that expiry can fire up to this much late, which is
 * immaterial against a timeout measured in minutes.
 */
const TOUCH_INTERVAL_MS = 60 * 1000;

export function getIdleTimeoutMs(): number {
  const raw = process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  const parsed = raw === undefined ? NaN : Number(raw);
  // A misconfigured value must not silently disable the control.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_IDLE_TIMEOUT_MINUTES * 60 * 1000;
  }
  return parsed * 60 * 1000;
}

/** Opt-out for environments that genuinely want long-lived sessions. */
function isEnabled(): boolean {
  return process.env.SESSION_IDLE_TIMEOUT_ENABLED !== "false";
}

export function sessionIdleTimeout(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!isEnabled()) return next();

  const session = req.session as any;
  // No session, or an anonymous one: nothing to expire. Anonymous sessions are
  // left alone deliberately — they carry the pre-auth CSRF token that the login
  // POST needs, so expiring them would break sign-in for an idle login page.
  if (!session || !session.userId) return next();

  const now = Date.now();
  const lastSeenAt =
    typeof session.lastSeenAt === "number" ? session.lastSeenAt : null;
  const idleMs = getIdleTimeoutMs();

  if (lastSeenAt !== null && now - lastSeenAt > idleMs) {
    const idleMinutes = Math.round((now - lastSeenAt) / 60000);
    logger.info(
      `Session ${req.sessionID} expired for user ${session.userId} after ${idleMinutes} min idle; clearing authentication.`
    );

    delete session.userId;
    delete session.lastSeenAt;
    // Mark the reason so /api/user can distinguish "your session timed out"
    // from "you were never signed in" if it ever wants to.
    session.expiredReason = "idle_timeout";
    // The request continues unauthenticated: requireAuth will 401 it, and
    // /api/user will report authenticated:false, which is what the client
    // already redirects to the login page on.
    return next();
  }

  // First authenticated request of a session has no stamp yet; stamp it so the
  // window starts now rather than treating the session as infinitely idle.
  if (lastSeenAt === null || now - lastSeenAt > TOUCH_INTERVAL_MS) {
    session.lastSeenAt = now;
  }

  next();
}
