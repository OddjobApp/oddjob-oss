export * from './core/mission.service.js';
export * from './core/mission-query.service.js';
export * from './core/mission-lifecycle.service.js';
export * from './core/mission-execution.service.js';
export * from './core/mission-run.service.js';
export * from './core/mission-analyst.service.js';
export * from './core/mission-dependency-resolver.service.js';
export { missionsRouter } from './routes/missions.route.js';
export { missionRunsRouter } from './routes/mission-runs.route.js';
export { RescueStrategyFactory } from './utils/rescue-strategy-factory.js';

import { missionService } from './core/mission.service.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';
import { initializeTemplateRevisionSubscription } from './listeners/template-revision-listener.js';

// Register Pod Facade
podRegistry.register('mission', missionService);

// Register Pod Listeners
podRegistry.registerListener(initializeTemplateRevisionSubscription);


