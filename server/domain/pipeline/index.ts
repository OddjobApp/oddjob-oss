import { pipelineEngine } from "./core/pipeline-engine.js";
import { executionManager } from "./core/execution-manager.js";
import { pipelineAnalytics } from "./core/pipeline-analytics.js";
import { pipelineMonitor, PipelineMonitor } from "./core/pipeline-monitor.js";
import { pipelineSuggestionService } from "./core/pipeline-suggestion-service.js";
import { pipelineTriggerService } from "./core/pipeline-trigger.service.js";
import { pipelineGraph } from "./core/pipeline-graph.js";
import { podRegistry } from "../core/infrastructure/pod-registry.service.js";

// Re-export core logic
export {
    pipelineEngine,
    executionManager,
    pipelineAnalytics,
    pipelineMonitor,
    PipelineMonitor,
    pipelineSuggestionService,
    pipelineTriggerService,
    pipelineGraph
};

// Register Pod Facade
podRegistry.register('pipeline', {
    engine: pipelineEngine,
    execution: executionManager,
    analytics: pipelineAnalytics,
    monitor: pipelineMonitor,
    suggestions: pipelineSuggestionService,
    trigger: pipelineTriggerService,
    graph: pipelineGraph
});

// Re-export hooks
export * from "./hooks/index.js";

// Re-export types
export * from "./core/types.js";


