import { evolutionService } from './core/evolution.service.js';
import { docsSynthesizer } from './infrastructure/docs-synthesizer.js';
import { selfHealingHandler } from './infrastructure/self-healing.handler.js';
import { podRegistry } from '../core/infrastructure/pod-registry.service.js';

// Register Pod Facade
podRegistry.register('evolution', {
    service: evolutionService,
    docs: docsSynthesizer,
    healing: selfHealingHandler
});

export { 
    evolutionService, 
    docsSynthesizer, 
    selfHealingHandler 
};
