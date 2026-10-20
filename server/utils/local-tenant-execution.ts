/**
 * Local child processes share the platform user's filesystem and process namespace.
 * An environment allowlist is necessary, but does not make them a sandbox.
 * Never allow generated app code, lifecycle scripts or build tools to run here
 * in production. Docker execution has a separate runtime path.
 */
export function assertLocalTenantExecutionAllowed(): void {
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "Local generated-app execution is disabled in production. " +
            "Dependency installation, builds, compiler checks, tests and app startup " +
            "require an isolated tenant runtime. See README_DEPLOYMENT.md.",
        );
    }
}
