import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { eventDiffPlugin } from "./event-diff.plugin.js";
import { quantDiffPlugin } from "./quant-diff.plugin.js";
import { hiddenStateDiffPlugin } from "./hidden-state-diff.plugin.js";
import { velocityPlugin } from "./velocity.plugin.js";
import { significanceScoringPlugin } from "./significance-scoring.plugin.js";
import { diffTriggerPlugin } from "./diff-trigger.plugin.js";

export function registerAllDiffPlugins(): void {
    pluginRegistry.register(eventDiffPlugin);
    pluginRegistry.register(quantDiffPlugin);
    pluginRegistry.register(hiddenStateDiffPlugin);
    pluginRegistry.register(velocityPlugin);
    pluginRegistry.register(significanceScoringPlugin);
    pluginRegistry.register(diffTriggerPlugin);
}

export {
    eventDiffPlugin,
    quantDiffPlugin,
    hiddenStateDiffPlugin,
    velocityPlugin,
    significanceScoringPlugin,
    diffTriggerPlugin,
};
