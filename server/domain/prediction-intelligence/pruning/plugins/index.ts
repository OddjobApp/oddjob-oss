import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { branchScoringPlugin } from "./branch-scoring.plugin.js";
import { hardPrunePlugin } from "./hard-prune.plugin.js";
import { softSuppressionPlugin } from "./soft-suppression.plugin.js";
import { anomalyReservePlugin } from "./anomaly-reserve.plugin.js";
import { entropyPruningPlugin } from "./entropy-pruning.plugin.js";
import { branchGenealogyPlugin } from "./branch-genealogy.plugin.js";

export function registerAllPruningPlugins(): void {
    pluginRegistry.register(branchScoringPlugin);
    pluginRegistry.register(hardPrunePlugin);
    pluginRegistry.register(softSuppressionPlugin);
    pluginRegistry.register(anomalyReservePlugin);
    pluginRegistry.register(entropyPruningPlugin);
    pluginRegistry.register(branchGenealogyPlugin);
}

export {
    branchScoringPlugin,
    hardPrunePlugin,
    softSuppressionPlugin,
    anomalyReservePlugin,
    entropyPruningPlugin,
    branchGenealogyPlugin,
};
