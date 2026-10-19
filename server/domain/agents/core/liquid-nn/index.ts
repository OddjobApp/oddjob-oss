/**
 * Liquid Neural Networks Module
 * 
 * MIT Liquid Neural Networks for real-time adaptive agents.
 * Continuous-time dynamics with Neural ODEs.
 * 
 * @example
 * ```typescript
 * import { LNNCoreService } from './liquid-nn';
 * 
 * const service = new LNNCoreService(eventStream);
 * 
 * // Create agent
 * const agent = await service.createAgent(
 *   'Traffic Monitor',
 *   'monitoring',
 *   { numNeurons: 64, timeConstant: 0.1 }
 * );
 * 
 * // Real-time inference
 * const result = await service.forward(agent.id, inputData);
 * 
 * // Adapt to changing conditions
 * await service.adapt(agent.id, input, target);
 * 
 * // Deploy to edge
 * await service.optimizeForEdge(agent.id, {
 *   device: 'embedded',
 *   memoryBudget: 50,
 *   latencyRequirement: 50
 * });
 * ```
 */

// Types (interfaces erased at runtime — must use export type)
export type {
  LNNConfig,
  LiquidNeuronState,
  LNNState,
  LiquidAgent,
  LNNForwardResult,
  AdaptationEvent,
  EdgeProfile,
  ModelSizeMetrics,
  RealTimeMonitoringConfig,
  LNNMetrics,
  LNNTrainingConfig
} from './types.js';

// Values (const, class, enum — survive to runtime)
export { DEFAULT_LNN_CONFIG, LNNError, LNNErrorType } from './types.js';

// Services
export { LNNCoreService } from './lnn-core.service.js';

import { eventStream } from "../../../core/infrastructure/event-stream.service.js";
import { LNNCoreService } from "./lnn-core.service.js";

let _lnnCoreService: LNNCoreService | null = null;

export function getLnnCoreService(): LNNCoreService {
    if (!_lnnCoreService) {
        _lnnCoreService = new LNNCoreService({
            publish: async (event: { type: string; payload: any }) => {
                await eventStream.publish(event.type, event.payload);
            }
        });
    }
    return _lnnCoreService;
}

export const lnnCoreService: LNNCoreService = new Proxy({} as LNNCoreService, {
    get(_target, prop) {
        return (getLnnCoreService() as any)[prop];
    },
});
