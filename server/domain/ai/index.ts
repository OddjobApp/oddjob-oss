export * from './core/system-ai.service.js';
export * from './core/ai-client.service.js';
export * from './core/prompt-service.js';
export * from './core/llm-client.js';
export * from './core/agent-state.service.js';
export * from './core/context-window.service.js';
export * from './core/structured-output.service.js';
export * from './core/runtime-eval-gate.service.js';
export * from './core/canonical-trace.service.js';
export * from './core/tool-contract.service.js';
export * from './core/spec-compiler.js';
export * from './core/prompt-event-bus.js';
export * from './core/copilot-service.js';
export * from './core/copilot-prompt-manager.service.js';
export * from './core/copilot-context-filter.service.js';
export * from './core/phase-compiler.js';
export * from './core/scoped-topic-indexer.js';
export * from './core/prediction-engine.service.js';
export * from './core/good-question-engine.js';
export * from './core/mcp-copilot-bridge.service.js';
export * from './core/telemetry-alert-stream.service.js';
export * from './core/dynamic-tuning.service.js';
export * from './core/geofence-spatial-engine.service.js';
export * from './core/h3-hexagonal-spatial-engine.service.js';

import { systemAiService } from './core/system-ai.service.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';

// Register Pod Facade
podRegistry.register('ai', systemAiService);
