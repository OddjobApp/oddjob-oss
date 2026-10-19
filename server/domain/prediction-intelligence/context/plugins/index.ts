import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { contextCandidateGeneratorPlugin } from "./context-candidate-generator.plugin.js";
import { contextScorerPlugin } from "./context-scorer.plugin.js";
import { contextCreatorPlugin } from "./context-creator.plugin.js";
import { contextLifecyclePlugin } from "./context-lifecycle.plugin.js";

export function registerAllContextPlugins(): void {
    pluginRegistry.register(contextCandidateGeneratorPlugin);
    pluginRegistry.register(contextScorerPlugin);
    pluginRegistry.register(contextCreatorPlugin);
    pluginRegistry.register(contextLifecyclePlugin);
}

export {
    contextCandidateGeneratorPlugin,
    contextScorerPlugin,
    contextCreatorPlugin,
    contextLifecyclePlugin,
};
