export * from './agent.service.js';
export * from './agent-analytics.service.js';
export * from './agent-deployment.service.js';
export * from './agent-nonce.service.js';
export * from './agent-optimization.service.js';
export * from './agent-persona.service.js';
export * from './agent-runner.js';
export * from './core/agent-orchestrator.js';
export * from './core/critic-service.js';

import { agentService } from './agent.service.js';
import { AgentOrchestrator } from './core/agent-orchestrator.js';
import { agentInbox } from './core/agent-inbox.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';

// Register Pod Facade
podRegistry.register('agents', {
    agent: agentService,
    orchestrator: AgentOrchestrator,
    inbox: agentInbox
});

export * from './core/prompt-builder.js';
export * from './core/types.js';


