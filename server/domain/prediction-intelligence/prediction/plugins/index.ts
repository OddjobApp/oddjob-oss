import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { predictionModePlannerPlugin } from "./prediction-mode-planner.plugin.js";
import { predicateGeneratorPlugin } from "./predicate-generator.plugin.js";
import { branchGeneratorPlugin } from "./branch-generator.plugin.js";
import { forwardChamberPlugin } from "./forward-chamber.plugin.js";
import { predictionEntropyPlugin } from "./prediction-entropy.plugin.js";
import { predictionConfidencePlugin } from "./prediction-confidence.plugin.js";
import { predictionContractPlugin } from "./prediction-contract.plugin.js";

export function registerAllPredictionPlugins(): void {
    pluginRegistry.register(predictionModePlannerPlugin);
    pluginRegistry.register(predicateGeneratorPlugin);
    pluginRegistry.register(branchGeneratorPlugin);
    pluginRegistry.register(forwardChamberPlugin);
    pluginRegistry.register(predictionEntropyPlugin);
    pluginRegistry.register(predictionConfidencePlugin);
    pluginRegistry.register(predictionContractPlugin);
}

export {
    predictionModePlannerPlugin,
    predicateGeneratorPlugin,
    branchGeneratorPlugin,
    forwardChamberPlugin,
    predictionEntropyPlugin,
    predictionConfidencePlugin,
    predictionContractPlugin,
};
