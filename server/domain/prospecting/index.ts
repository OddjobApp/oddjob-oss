export * from './prospecting.service.js';
export { prospectingRouter } from './prospecting.route.js';

import { prospectingService } from './prospecting.service.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';

// Register Pod Facade
podRegistry.register('prospecting', prospectingService);
