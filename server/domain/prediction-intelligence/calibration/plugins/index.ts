import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { outcomeIntakePlugin } from "./outcome-intake.plugin.js";
import { outcomeMatchingPlugin } from "./outcome-matching.plugin.js";
import { predictionAccuracyPlugin } from "./prediction-accuracy.plugin.js";
import { falsePruneDetectorPlugin } from "./false-prune-detector.plugin.js";
import { confidenceCalibrationPlugin } from "./confidence-calibration.plugin.js";

export function registerAllCalibrationPlugins(): void {
    pluginRegistry.register(outcomeIntakePlugin);
    pluginRegistry.register(outcomeMatchingPlugin);
    pluginRegistry.register(predictionAccuracyPlugin);
    pluginRegistry.register(falsePruneDetectorPlugin);
    pluginRegistry.register(confidenceCalibrationPlugin);
}

export {
    outcomeIntakePlugin,
    outcomeMatchingPlugin,
    predictionAccuracyPlugin,
    falsePruneDetectorPlugin,
    confidenceCalibrationPlugin,
};
