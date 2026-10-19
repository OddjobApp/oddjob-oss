import type { ToolContext } from "./types.js";

/**
 * Resolves the organization a tool must operate on, or throws.
 *
 * Tool implementations previously wrote `context.organizationId || 1`. That
 * silently redirected every read AND write to organization 1 whenever the tool
 * was invoked without a resolved organization — which happens in practice,
 * because `ToolContext.organizationId` is `number | null | undefined` and
 * several invocation paths do not populate it (see
 * `agent-plugin-bridge.service.ts`, which calls `capability.execute(args)` with
 * no context argument at all).
 *
 * Every current call site sits inside a `try`/`catch` that converts a throw into
 * the tool's own error envelope, so failing closed here surfaces a normal tool
 * error to the agent rather than corrupting another tenant's data.
 */
export function requireToolOrgId(context: ToolContext | undefined | null): number {
    const orgId = Number(context?.organizationId);
    if (!Number.isInteger(orgId) || orgId <= 0) {
        throw new Error(
            "Organization context required: this tool reads and writes org-scoped data and will not fall back to a default organization.",
        );
    }
    return orgId;
}
