import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { realmExecutionPlannerPlugin } from "./realm-execution-planner.plugin.js";
import { temporalRealmPlugin } from "./temporal-realm.plugin.js";
import { semanticRealmPlugin } from "./semantic-realm.plugin.js";
import { epistemicRealmPlugin } from "./epistemic-realm.plugin.js";
import { attentionRealmPlugin } from "./attention-realm.plugin.js";
import { realmAggregatorPlugin } from "./realm-aggregator.plugin.js";
import { realmAgreementPlugin } from "./realm-agreement.plugin.js";

export function registerAllRealmPlugins(): void {
    pluginRegistry.register(realmExecutionPlannerPlugin);
    pluginRegistry.register(temporalRealmPlugin);
    pluginRegistry.register(semanticRealmPlugin);
    pluginRegistry.register(epistemicRealmPlugin);
    pluginRegistry.register(attentionRealmPlugin);
    pluginRegistry.register(realmAggregatorPlugin);
    pluginRegistry.register(realmAgreementPlugin);
}

export {
    realmExecutionPlannerPlugin, temporalRealmPlugin, semanticRealmPlugin,
    epistemicRealmPlugin, attentionRealmPlugin, realmAggregatorPlugin, realmAgreementPlugin,
};
