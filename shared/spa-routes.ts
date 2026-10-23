/**
 * Which SPA bundle serves a browser navigation — the single source of truth for
 * `setupVite` (dev) and `serveStatic` (prod) in server/vite.ts, and for the
 * client's cross-SPA navigation check in client/src/lib/spa-utils.ts.
 *
 * These lists used to be written out three times, and the copies drifted. The
 * client lacked /login, /signals, /assistant and others. Prod omitted /login,
 * /signup and the other auth pages (served with a 404), and matched with Express
 * wildcards (`/app*`) where dev matched whole segments, so `/app*` swallowed
 * `/apps` and `/app-forge` and served them the login bundle.
 * A prefix here matches the path itself or anything below it — `/app` matches
 * `/app/x`, never `/apps`.
 *
 * Order is precedence: the first entry whose prefix matches wins. That is what
 * keeps `/signal-intelligence` on operations even though intelligence would
 * also be a plausible home for it.
 *
 * A new top-level client route needs a prefix here AND a route in the router of
 * the SPA that owns it; registering it in a sibling router does nothing.
 */
export type SpaTemplate =
  | "login.html"
  | "knowledge.html"
  | "operations.html"
  | "intelligence.html"
  | "armory.html";

export const SPA_ROUTES: ReadonlyArray<{ template: SpaTemplate; prefixes: readonly string[] }> = [
  {
    template: "login.html",
    prefixes: [
      "/auth", "/login", "/logout", "/signin", "/signup", "/register",
      "/forgot-password", "/reset-password",
      // Public deployment pages: /a/:slug (agent), /app/:slug, /o/:orgId/app/:slug,
      // /r and /h (shared run / HIL links).
      "/a", "/app", "/o", "/r", "/h", "/external", "/hil-form",
      "/trust", "/overview", "/use-cases", "/getting-started", "/contact",
      "/privacy", "/terms", "/404", "/docs",
    ],
  },
  {
    template: "knowledge.html",
    prefixes: ["/knowledge", "/datasets", "/knowledge-store"],
  },
  {
    template: "operations.html",
    prefixes: [
      "/launchpad", "/launch", "/workspace", "/spatial", "/signals", "/signal",
      "/operations", "/projects", "/agents", "/missions", "/jobs", "/schedules",
      "/scheduled-agents", "/scheduled-jobs", "/pipeline", "/pipelines",
      "/templates", "/pipeline-executions", "/dashboard", "/workstreams",
      "/platform-maintenance", "/connections", "/account-admin", "/platform",
      "/organizations", "/users", "/billing", "/snapshots", "/admin",
      "/credentials", "/settings", "/profile", "/saas", "/signal-intelligence",
      "/dev",
    ],
  },
  {
    template: "intelligence.html",
    prefixes: [
      "/insights", "/prediction-intelligence", "/analytics", "/predictive",
      "/agent", "/assistant", "/governance", "/control", "/approvals",
      "/fine-tuning", "/intelligence", "/monitoring", "/observability",
      "/alerts", "/events", "/health",
    ],
  },
  {
    template: "armory.html",
    prefixes: [
      "/armory", "/apps", "/forms", "/app-forge", "/appforge", "/prospecting",
      "/swarm", "/tactics",
    ],
  },
];

/** The template that owns `path`, or null when no SPA claims it. */
export function resolveSpaTemplate(path: string): SpaTemplate | null {
  if (path === "/") return "login.html";
  for (const { template, prefixes } of SPA_ROUTES) {
    if (prefixes.some((p) => path === p || path.startsWith(p + "/"))) return template;
  }
  return null;
}
