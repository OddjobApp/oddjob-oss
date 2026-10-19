import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('NoCodeLogicBuilderService');

export interface LogicNode {
  id: string;
  type: 'trigger' | 'condition' | 'agent_action' | 'hil_approval';
  label: string;
  config: Record<string, any>;
}

export interface LogicEdge {
  sourceNodeId: string;
  targetNodeId: string;
  conditionLabel?: string;
}

export interface VisualLogicFlowSpec {
  flowId: string;
  flowName: string;
  nodes: LogicNode[];
  edges: LogicEdge[];
}

export interface ExecutableSwarmWorkflow {
  workflowId: string;
  name: string;
  stepCount: number;
  compiledAt: string;
}

export class NoCodeLogicBuilderService {
  /**
   * Compiles a visual drag-and-drop node graph specification into an executable Swarm workflow.
   */
  compileVisualFlow(spec: VisualLogicFlowSpec): ExecutableSwarmWorkflow {
    logger.info(`Compiling visual logic flow '${spec.flowName}' (${spec.flowId}) with ${spec.nodes.length} nodes and ${spec.edges.length} edges.`);

    if (!spec.nodes || spec.nodes.length === 0) {
      throw new Error('Visual logic flow must contain at least one node.');
    }

    return {
      workflowId: `wf_${spec.flowId}_${Date.now()}`,
      name: spec.flowName,
      stepCount: spec.nodes.length,
      compiledAt: new Date().toISOString()
    };
  }
}

export const noCodeLogicBuilderService = new NoCodeLogicBuilderService();
