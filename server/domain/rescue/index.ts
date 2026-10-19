export * from './core/rescue-service.js';
export * from './core/telemetry-processor.js';
export * from './core/partner-service.js';
export * from './core/geo-service.js';
export * from './core/geocoding-service.js';
export * from './core/routing-service.js';
export * from './infrastructure/rescue-events.routes.js';

import { rescueService } from './core/rescue-service.js';
import { telemetryProcessor } from './core/telemetry-processor.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';

// Register Pod Facade
podRegistry.register('rescue', {
    rescue: rescueService,
    telemetry: telemetryProcessor
});
