// ============================================================================
// QUANT POD — Plugin Registration Barrel
// Call registerAllQuantPlugins() at server startup.
// ============================================================================

import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";
import { quantGeneratorPlugin, quantEpistemicPlugin } from "./quant-generator.plugin.js";
import { quantTrajectoryPlugin } from "./quant-trajectory.plugin.js";
import { quantResonancePlugin } from "./quant-resonance.plugin.js";
import { quantInterferencePlugin } from "./quant-interference.plugin.js";
import { quantFieldSummaryPlugin } from "./quant-field-summary.plugin.js";
import { quantBranchInfluencePlugin } from "./quant-branch-influence.plugin.js";
import { quantHiddenStateInfluencePlugin } from "./quant-hidden-state-influence.plugin.js";
import { quantDecayPlugin } from "./quant-decay.plugin.js";
import { quantCollapseDetectorPlugin } from "./quant-collapse-detector.plugin.js";
import { quantRelationshipPlugin } from "./quant-relationship.plugin.js";

/** Register all 11 Quant Pod plugins with the Plugin Runtime. */
export function registerAllQuantPlugins(): void {
    // Hot-path generators (spec §26.1)
    pluginRegistry.register(quantGeneratorPlugin);
    pluginRegistry.register(quantEpistemicPlugin);

    // Enrichment (spec §26.2)
    pluginRegistry.register(quantTrajectoryPlugin);
    pluginRegistry.register(quantResonancePlugin);
    pluginRegistry.register(quantInterferencePlugin);
    pluginRegistry.register(quantRelationshipPlugin);

    // Field and influence (spec §26.3)
    pluginRegistry.register(quantFieldSummaryPlugin);
    pluginRegistry.register(quantBranchInfluencePlugin);
    pluginRegistry.register(quantHiddenStateInfluencePlugin);

    // Lifecycle (decay + collapse)
    pluginRegistry.register(quantDecayPlugin);
    pluginRegistry.register(quantCollapseDetectorPlugin);
}

// Re-export individual plugins for direct use in tests
export {
    quantGeneratorPlugin, quantEpistemicPlugin,
    quantTrajectoryPlugin,
    quantResonancePlugin, quantInterferencePlugin,
    quantRelationshipPlugin,
    quantFieldSummaryPlugin,
    quantBranchInfluencePlugin, quantHiddenStateInfluencePlugin,
    quantDecayPlugin, quantCollapseDetectorPlugin,
};

// Re-export deprecated alias for backward compat
export { registerAllQuantPlugins as registerQuantPlugins };
