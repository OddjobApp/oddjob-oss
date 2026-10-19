/**
 * Dataset Service
 * 
 * Facade layer that re-exports modular dataset services.
 * Maintains backward compatibility while delegating to specialized sub-services.
 */

import { coreService } from "./dataset/core-service.js";
import { itemService } from "./dataset/item-service.js";
import { platformService } from "./dataset/platform-service.js";
import { normalizationService } from "./dataset/normalization-service.js";

// Re-export types for consumers
export * from "./dataset/types.js";

export const datasetService = {
    // Core Dataset CRUD
    ...coreService,

    // Item Operations
    ...itemService,

    // Platform Specific
    ...platformService,

    // Normalization & specialized operations
    ...normalizationService
};

export default datasetService;


