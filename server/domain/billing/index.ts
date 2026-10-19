export * from './stripe.service.js';
export * from './payout.service.js';
export { billingRouter } from './billing.route.js';

import { stripeService } from './stripe.service.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';
import { initializeMissionBillingSubscription } from './listeners/mission-billing-listener.js';

// Register Pod Facade
podRegistry.register('billing', stripeService);

// Initialize Listeners
initializeMissionBillingSubscription();


