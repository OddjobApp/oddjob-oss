import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { shortTermMemoryPlugin } from "./short-term-memory.plugin.js";
import { patternMemoryPlugin } from "./pattern-memory.plugin.js";
import { baselineMemoryPlugin } from "./baseline-memory.plugin.js";
import { outcomeMemoryPlugin } from "./outcome-memory.plugin.js";
import { attractorMemoryPlugin } from "./attractor-memory.plugin.js";
import { memoryRecallScorerPlugin } from "./memory-recall-scorer.plugin.js";

export function registerAllMemoryPlugins(): void {
    pluginRegistry.register(shortTermMemoryPlugin);
    pluginRegistry.register(patternMemoryPlugin);
    pluginRegistry.register(baselineMemoryPlugin);
    pluginRegistry.register(outcomeMemoryPlugin);
    pluginRegistry.register(attractorMemoryPlugin);
    pluginRegistry.register(memoryRecallScorerPlugin);
}

export {
    shortTermMemoryPlugin,
    patternMemoryPlugin,
    baselineMemoryPlugin,
    outcomeMemoryPlugin,
    attractorMemoryPlugin,
    memoryRecallScorerPlugin,
};
