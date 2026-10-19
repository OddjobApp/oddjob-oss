import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { hiddenStateCandidatePlugin } from "./hidden-state-candidate.plugin.js";
import { hiddenStateScorerPlugin } from "./hidden-state-scorer.plugin.js";
import { hiddenStateEntropyPlugin } from "./hidden-state-entropy.plugin.js";
import { hiddenStatePersistencePlugin } from "./hidden-state-persistence.plugin.js";
import { hiddenStateInfluencePlugin } from "./hidden-state-influence.plugin.js";

export function registerAllHiddenStatePlugins(): void {
    pluginRegistry.register(hiddenStateCandidatePlugin);
    pluginRegistry.register(hiddenStateScorerPlugin);
    pluginRegistry.register(hiddenStateEntropyPlugin);
    pluginRegistry.register(hiddenStatePersistencePlugin);
    pluginRegistry.register(hiddenStateInfluencePlugin);
}

export {
    hiddenStateCandidatePlugin,
    hiddenStateScorerPlugin,
    hiddenStateEntropyPlugin,
    hiddenStatePersistencePlugin,
    hiddenStateInfluencePlugin,
};
