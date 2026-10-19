/**
 * Whether an app owns an HTTP runtime that should be served through the public
 * proxy. Tokenized-UI apps deliberately return false: their surface is rendered
 * by Oddjob itself and must continue to fall through to the public shell.
 */
export function isRuntimeBackedApp(app: {
    dockerImage?: string | null;
    developmentPlan?: unknown;
    runtimeMetadata?: unknown;
}): boolean {
    if (app.dockerImage) return true;

    const runtime = (app.runtimeMetadata ?? {}) as Record<string, unknown>;
    if (runtime.assignedPort || runtime.status === "running") return true;
    if (["node", "next", "docker"].includes(String(runtime.launchProfile ?? ""))) return true;

    const plan = (app.developmentPlan ?? {}) as { modules?: Array<{ id?: string; provides?: string[] }> };
    return (plan.modules ?? []).some((module) =>
        module.id === "core-node-express" || (module.provides ?? []).includes("web-host"),
    );
}
