import { AsyncLocalStorage } from "node:async_hooks";

type OrganizationResolver = () => Promise<number | null>;
const context = new AsyncLocalStorage<OrganizationResolver>();

export function hasAiOrganizationContext(): boolean {
    return context.getStore() !== undefined;
}

/** Scope AI work without storing keys in global state. Resolver must be authenticated. */
export function withAiOrganization<T>(resolve: OrganizationResolver, work: () => T): T {
    return context.run(resolve, work);
}

export async function resolveAiOrganization(explicit?: number | null): Promise<number | null> {
    const resolver = context.getStore();
    const current = resolver ? await resolver() : undefined;
    // Only a KNOWN request org can contradict the caller's. A public or webhook
    // request has none, and server code then names the resource's org.
    if (current != null && explicit != null && current !== explicit) {
        throw new Error("AI organization does not match the authenticated execution context");
    }
    const orgId = current ?? explicit ?? null;
    if (orgId !== null && (!Number.isSafeInteger(orgId) || orgId <= 0)) {
        throw new Error("A valid organization is required for AI execution");
    }
    return orgId;
}
