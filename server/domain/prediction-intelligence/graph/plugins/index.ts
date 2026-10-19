import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { eventGraphPlugin } from "./event-graph.plugin.js";
import { quantGraphPlugin } from "./quant-graph.plugin.js";
import { branchGraphPlugin } from "./branch-graph.plugin.js";
import { graphTraversalPlugin } from "./graph-traversal.plugin.js";
import { graphFeatureExtractorPlugin } from "./graph-feature-extractor.plugin.js";

export function registerAllGraphPlugins(): void {
    pluginRegistry.register(eventGraphPlugin);
    pluginRegistry.register(quantGraphPlugin);
    pluginRegistry.register(branchGraphPlugin);
    pluginRegistry.register(graphTraversalPlugin);
    pluginRegistry.register(graphFeatureExtractorPlugin);
}

export {
    eventGraphPlugin,
    quantGraphPlugin,
    branchGraphPlugin,
    graphTraversalPlugin,
    graphFeatureExtractorPlugin,
};
