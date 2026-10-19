export * from './app-registry.service.js';
export * from './app-deployment.service.js';
export { appsRouter } from './apps.route.js';
export { appsPlatformRouter } from "./platform/index.js";

import { appRegistryService } from './app-registry.service.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';
import { initializeMissionAppsSubscription } from './listeners/mission-event-listener.js';

// Register Pod Facade
podRegistry.register('apps', appRegistryService);

// Register Pod Listeners
podRegistry.registerListener(initializeMissionAppsSubscription);


