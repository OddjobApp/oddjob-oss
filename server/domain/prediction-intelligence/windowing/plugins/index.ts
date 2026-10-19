import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { timestampNormalizerPlugin } from "./timestamp-normalizer.plugin.js";
import { eventSequencerPlugin } from "./event-sequencer.plugin.js";
import { rollingWindowPlugin } from "./rolling-window.plugin.js";
import { densityModePlugin } from "./density-mode.plugin.js";
import { recencyScoringPlugin } from "./recency-scoring.plugin.js";
import { frequencyScoringPlugin } from "./frequency-scoring.plugin.js";
import { burstDetectionPlugin } from "./burst-detection.plugin.js";
import { silenceDetectionPlugin } from "./silence-detection.plugin.js";

export function registerAllWindowingPlugins(): void {
    pluginRegistry.register(timestampNormalizerPlugin);
    pluginRegistry.register(eventSequencerPlugin);
    pluginRegistry.register(rollingWindowPlugin);
    pluginRegistry.register(densityModePlugin);
    pluginRegistry.register(recencyScoringPlugin);
    pluginRegistry.register(frequencyScoringPlugin);
    pluginRegistry.register(burstDetectionPlugin);
    pluginRegistry.register(silenceDetectionPlugin);
}

export {
    timestampNormalizerPlugin,
    eventSequencerPlugin,
    rollingWindowPlugin,
    densityModePlugin,
    recencyScoringPlugin,
    frequencyScoringPlugin,
    burstDetectionPlugin,
    silenceDetectionPlugin,
};
