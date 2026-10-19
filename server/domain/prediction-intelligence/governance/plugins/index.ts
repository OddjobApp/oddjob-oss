import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { tenantIsolationPlugin } from "./tenant-isolation.plugin.js";
import { sensitivityEnforcementPlugin } from "./sensitivity-enforcement.plugin.js";
import { riskClassificationPlugin } from "./risk-classification.plugin.js";
import { confidenceGatingPlugin } from "./confidence-gating.plugin.js";
import { actionAuthorizationPlugin } from "./action-authorization.plugin.js";
import { policyEnginePlugin } from "./policy-engine.plugin.js";

export function registerAllGovernancePlugins(): void {
    pluginRegistry.register(tenantIsolationPlugin);
    pluginRegistry.register(sensitivityEnforcementPlugin);
    pluginRegistry.register(riskClassificationPlugin);
    pluginRegistry.register(confidenceGatingPlugin);
    pluginRegistry.register(actionAuthorizationPlugin);
    pluginRegistry.register(policyEnginePlugin);
}

export {
    tenantIsolationPlugin,
    sensitivityEnforcementPlugin,
    riskClassificationPlugin,
    confidenceGatingPlugin,
    actionAuthorizationPlugin,
    policyEnginePlugin,
};
