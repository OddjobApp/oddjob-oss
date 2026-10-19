import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { TenantIsolationPluginInput } from "../types.js";
import { makeGovManifest, successResult } from "./plugin-helpers.js";

interface TenantIsolationOutput { allowed: boolean; crossTenant: boolean; reason: string }

const manifest = makeGovManifest({
    name: "tenant-isolation",
    subPod: "tenant-isolation",
    capability: "governance.tenant_isolation",
    description: "Prevents unauthorized cross-tenant memory, context, and graph access (spec §21).",
    inputTypes: ["TenantIsolationPluginInput"],
    outputTypes: ["TenantIsolationOutput"],
    timeoutMs: 5,
});

export const tenantIsolationPlugin: PredictionPlugin<TenantIsolationPluginInput, TenantIsolationOutput> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always run tenant isolation", priority: 100, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: TenantIsolationPluginInput, ctx: PluginContext): Promise<PluginResult<TenantIsolationOutput>> {
        const startedAt = new Date().toISOString();

        // Cross-tenant merge is always denied by default
        if (input.isCrossTenantMerge) {
            return successResult(manifest, { allowed: false, crossTenant: true, reason: "cross-tenant context merge is denied by default" }, 1.0, ctx, startedAt, "tenant_isolation");
        }

        // Mismatched tenant IDs → deny
        const tenants = [input.contextTenantId, input.subjectTenantId, input.resourceTenantId].filter(Boolean);
        const unique = new Set(tenants);
        if (unique.size > 1) {
            return successResult(manifest, {
                allowed: false,
                crossTenant: true,
                reason: `cross-tenant access denied: tenant mismatch [${[...unique].join(", ")}]`,
            }, 1.0, ctx, startedAt, "tenant_isolation");
        }

        return successResult(manifest, { allowed: true, crossTenant: false, reason: "same-tenant access allowed" }, 1.0, ctx, startedAt, "tenant_isolation");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
