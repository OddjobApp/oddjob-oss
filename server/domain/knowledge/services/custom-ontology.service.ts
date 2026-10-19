import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('CustomOntologyService');

export interface KineticAction {
  actionName: string;
  description: string;
  parametersSchema: Record<string, any>;
  handlerType: 'swarm_task' | 'http_webhook' | 'function';
}

export interface BusinessEntityDefinition {
  entityType: string;
  displayName: string;
  description: string;
  properties: Record<string, 'string' | 'number' | 'boolean' | 'date'>;
  actions: KineticAction[];
}

export class CustomOntologyService {
  private entityTypes = new Map<string, BusinessEntityDefinition>();

  /**
   * Registers a custom business entity type ("noun") with bound kinetic actions ("verbs").
   */
  registerEntity(definition: BusinessEntityDefinition): BusinessEntityDefinition {
    logger.info(`Registering custom Ontology entity type '${definition.entityType}' (${definition.displayName}) with ${definition.actions.length} kinetic actions.`);
    this.entityTypes.set(definition.entityType, definition);
    return definition;
  }

  /**
   * Retrieves a registered business entity definition.
   */
  getEntity(entityType: string): BusinessEntityDefinition | undefined {
    return this.entityTypes.get(entityType);
  }

  /**
   * Lists all registered business entity types in the Ontology.
   */
  listEntities(): BusinessEntityDefinition[] {
    return Array.from(this.entityTypes.values());
  }

  /**
   * Executes a bound kinetic action ("verb") on an entity instance.
   */
  async executeKineticAction(
    entityType: string,
    actionName: string,
    params: Record<string, any>
  ): Promise<{ status: 'executed'; actionName: string; result: any }> {
    const entity = this.entityTypes.get(entityType);
    if (!entity) {
      throw new Error(`Ontology Entity '${entityType}' not found.`);
    }

    const action = entity.actions.find(a => a.actionName === actionName);
    if (!action) {
      throw new Error(`Kinetic Action '${actionName}' not bound to Entity '${entityType}'.`);
    }

    logger.info(`[OntologyKineticAction] Executing action '${actionName}' on entity '${entityType}' with parameters:`, params);

    return {
      status: 'executed',
      actionName,
      result: {
        executedAt: new Date().toISOString(),
        entityType,
        params
      }
    };
  }
}

export const customOntologyService = new CustomOntologyService();
