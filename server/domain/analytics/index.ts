export * from './core/analytics.service.js';
export * from './core/reporting.service.js';
export * from './core/roi.service.js';

import { analyticsService } from './core/analytics.service.js';
import { reportingService } from './core/reporting.service.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';

// Register Pod Facade
podRegistry.register('analytics', {
    analytics: analyticsService,
    reporting: reportingService
});
