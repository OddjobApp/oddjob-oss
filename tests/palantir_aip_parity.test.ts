import { describe, it, expect } from 'vitest';
import { customOntologyService } from '@domain/knowledge/services/custom-ontology.service.js';
import { enterpriseConnectorService } from '@domain/knowledge/services/enterprise-connector.service.js';
import { noCodeLogicBuilderService } from '@domain/governor/core/nocode-logic-builder.service.js';

describe('Palantir AIP Full Parity Suite', () => {
  describe('Custom Business Ontology Builder', () => {
    it('registers custom business entity types ("nouns") and executes kinetic actions ("verbs")', async () => {
      customOntologyService.registerEntity({
        entityType: 'Supplier',
        displayName: 'Supply Chain Vendor',
        description: 'Represents external inventory supplier',
        properties: { name: 'string', rating: 'number' },
        actions: [
          {
            actionName: 'ReorderStock',
            description: 'Triggers purchase order reorder',
            parametersSchema: { quantity: 'number' },
            handlerType: 'swarm_task'
          }
        ]
      });

      const entity = customOntologyService.getEntity('Supplier');
      expect(entity).toBeDefined();
      expect(entity?.displayName).toBe('Supply Chain Vendor');

      const actionResult = await customOntologyService.executeKineticAction('Supplier', 'ReorderStock', { quantity: 500 });
      expect(actionResult.status).toBe('executed');
      expect(actionResult.actionName).toBe('ReorderStock');
    });
  });

  describe('Enterprise ERP Connectors', () => {
    it('configures and syncs data from SAP ERP connector', async () => {
      enterpriseConnectorService.configureConnector({
        systemType: 'SAP_ERP',
        endpointUrl: 'https://sap.internal.org/api/v1',
        authMethod: 'oauth2',
        syncIntervalSec: 3600
      });

      const syncResult = await enterpriseConnectorService.syncEnterpriseData('SAP_ERP');
      expect(syncResult.status).toBe('connected');
      expect(syncResult.recordsProcessed).toBe(1250);
    });
  });

  describe('No-Code Visual Logic Builder', () => {
    it('compiles visual node graphs into executable swarm workflows', () => {
      const compiled = noCodeLogicBuilderService.compileVisualFlow({
        flowId: 'flow_101',
        flowName: 'Supply Chain Reorder Decision Flow',
        nodes: [
          { id: 'node_1', type: 'trigger', label: 'Inventory Drop Trigger', config: {} },
          { id: 'node_2', type: 'hil_approval', label: 'PO Approval Gate', config: {} }
        ],
        edges: [
          { sourceNodeId: 'node_1', targetNodeId: 'node_2' }
        ]
      });

      expect(compiled.workflowId).toMatch(/^wf_flow_101_/);
      expect(compiled.stepCount).toBe(2);
    });
  });
});
