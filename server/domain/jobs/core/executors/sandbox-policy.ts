/**
 * Whether a job's user-supplied code (Python script, shell command) must run in
 * the sandbox.
 *
 * A job config could set `sandbox: false` and run its code directly on the
 * host, as the server's own user and with the server's whole environment —
 * every platform secret, the database, every org's data. In production that is
 * never acceptable, whatever the config says. Development keeps the opt-out for
 * running scripts locally without Docker.
 */
export function mustSandboxUserCode(config: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.NODE_ENV === "production" || env.FORCE_SANDBOX === "true") return true;
    return (config as { sandbox?: unknown } | null | undefined)?.sandbox !== false;
}
