/**
 * XRay Pod
 *
 * Provides code graph analysis for forge workspaces and blueprint templates.
 * Parses TypeScript/JavaScript source files using the TS Compiler API and
 * stores structured code nodes/edges in the existing knowledge graph.
 *
 * Pod facade exposed via: podRegistry.getPod('xray')
 */

export { codeGraphService } from "./core/code-graph.service.js";
export { codeParserService } from "./core/code-parser.service.js";
export { workspaceWatcher } from "./infrastructure/workspace-watcher.js";
export { xrayRouter } from "./routes/xray.route.js";
export { compositionRouter } from "./routes/composition.route.js";
export { prefetchManifestRouter } from "./routes/prefetch-manifest.route.js";
export { default as xrayLineageRouter } from "./routes/xray-lineage.routes.js";
export { xrayCompositionService } from "./core/xray-composition.service.js";
export { xrayOperationalGuideService } from "./core/xray-operational-guide.service.js";
export { xrayContextPackageService } from "./core/xray-context-package.service.js";
export { xrayOperationsPersistenceService } from "./core/xray-operations-persistence.service.js";
export type { XrayOperationalGuide } from "./types/operational-guide.js";
export {
  fullReindex,
  indexJobDatasetEdges,
  indexMissionPipelineEdges,
  invalidateCompositionCache,
  indexSwarmTaskEdges,
  indexPromptVersionEdges,
  indexTransferenceRuleEdges
} from "./core/xray-indexing.service.js";

import { codeGraphService } from "./core/code-graph.service.js";
import { workspaceWatcher } from "./infrastructure/workspace-watcher.js";
import { podRegistry } from "../core/infrastructure/pod-registry.service.js";
import { initializeXrayEventListeners } from "./listeners/xray-event-listener.js";
import { initializePrefetchEventListeners } from "./listeners/prefetch-event-listener.js";

// Register Pod Facade
podRegistry.register('xray', codeGraphService);

// Register Pod Listener — starts file watcher and event listeners
// after EventStream is ready (Nightly indexer is owned by WorkerManagerService)
podRegistry.registerListener(() => {
    workspaceWatcher.start();
    initializeXrayEventListeners();
    initializePrefetchEventListeners();
});
