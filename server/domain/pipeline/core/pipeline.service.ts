/**
 * Pipeline Service
 * 
 * Facade that re-exports all pipeline-related service functionality.
 * Maintains backward compatibility while delegating to specialized sub-services.
 */

import { pipelineEngine, executionManager, pipelineAnalytics, pipelineGraph } from "../index.js";

// Re-export common types for convenience
export * from "../index.js";

export const pipelineService = {
    ...pipelineEngine,
    ...executionManager,
    ...pipelineAnalytics,
    ...pipelineGraph,
};

export default pipelineService;


