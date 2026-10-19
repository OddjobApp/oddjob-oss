/**
 * useAgentBuilder Hook
 * 
 * Custom hook for agent builder functionality including:
 * - Workflow validation
 * - Agent generation
 * - Complexity estimation
 * - Node/edge management utilities
 */

import { useCallback, useMemo } from 'react';
import { 
  AgentNode, 
  AgentEdge, 
  AgentDefinition,
  AgentWorkflow 
} from '../../../shared/schema/agent-builder';
import { v4 as uuidv4 } from 'uuid';

interface ValidationError {
  nodeId?: string;
  message: string;
  severity: 'error' | 'warning';
}

export const useAgentBuilder = () => {
  /**
   * Validate agent workflow
   */
  const validateWorkflow = useCallback((
    nodes: AgentNode[],
    edges: AgentEdge[]
  ): string[] => {
    const errors: string[] = [];
    
    // Check for at least one trigger node
    const triggerNodes = nodes.filter((n) => n.type === 'trigger');
    if (triggerNodes.length === 0) {
      errors.push('Workflow must have at least one Trigger node');
    }
    
    // Check for at least one output node
    const outputNodes = nodes.filter((n) => n.type === 'output');
    if (outputNodes.length === 0) {
      errors.push('Workflow must have at least one Output node');
    }
    
    // Check for orphaned nodes (no connections)
    const connectedNodeIds = new Set<string>();
    edges.forEach((e) => {
      connectedNodeIds.add(e.source);
      connectedNodeIds.add(e.target);
    });
    
    nodes.forEach((node) => {
      if (!connectedNodeIds.has(node.id) && nodes.length > 1) {
        errors.push(`Node "${node.data.label}" has no connections`);
      }
    });
    
    // Check for disconnected subgraphs
    const visited = new Set<string>();
    const adjacencyList = new Map<string, string[]>();
    
    nodes.forEach((n) => adjacencyList.set(n.id, []));
    edges.forEach((e) => {
      adjacencyList.get(e.source)?.push(e.target);
      adjacencyList.get(e.target)?.push(e.source);
    });
    
    const dfs = (nodeId: string) => {
      visited.add(nodeId);
      const neighbors = adjacencyList.get(nodeId) || [];
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        }
      });
    };
    
    if (nodes.length > 0) {
      dfs(nodes[0].id);
      if (visited.size !== nodes.length) {
        errors.push('Workflow contains disconnected components');
      }
    }
    
    // Validate condition nodes have both true/false branches
    const conditionNodes = nodes.filter((n) => n.type === 'condition');
    conditionNodes.forEach((node) => {
      const outgoingEdges = edges.filter((e) => e.source === node.id);
      const hasTrueBranch = outgoingEdges.some((e) => e.data?.branch === 'true');
      const hasFalseBranch = outgoingEdges.some((e) => e.data?.branch === 'false');
      
      if (outgoingEdges.length > 0 && (!hasTrueBranch || !hasFalseBranch)) {
        errors.push(`Condition node "${node.data.label}" should have both true and false branches`);
      }
    });
    
    // Validate loop nodes have exit condition
    const loopNodes = nodes.filter((n) => n.type === 'loop');
    loopNodes.forEach((node) => {
      if (!node.data.config?.loopCondition && !node.data.config?.maxIterations) {
        errors.push(`Loop node "${node.data.label}" should have a loop condition or max iterations`);
      }
    });
    
    // Check for cycles (except in loop nodes)
    const hasCycle = (startNodeId: string, visited: Set<string> = new Set()): boolean => {
      if (visited.has(startNodeId)) return true;
      visited.add(startNodeId);
      
      const outgoingEdges = edges.filter((e) => e.source === startNodeId);
      for (const edge of outgoingEdges) {
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (targetNode?.type !== 'loop' && hasCycle(edge.target, new Set(visited))) {
          return true;
        }
      }
      return false;
    };
    
    triggerNodes.forEach((trigger) => {
      if (hasCycle(trigger.id)) {
        errors.push('Workflow contains cycles (loops should use Loop nodes)');
      }
    });
    
    return errors;
  }, []);

  /**
   * Estimate workflow complexity
   */
  const estimateComplexity = useCallback((
    nodes: AgentNode[],
    edges: AgentEdge[]
  ): 'simple' | 'moderate' | 'complex' => {
    const nodeCount = nodes.length;
    const edgeCount = edges.length;
    const conditionCount = nodes.filter((n) => n.type === 'condition').length;
    const loopCount = nodes.filter((n) => n.type === 'loop').length;
    const parallelCount = nodes.filter((n) => n.type === 'parallel').length;
    
    // Calculate complexity score
    let score = nodeCount * 1 + edgeCount * 0.5 + conditionCount * 2 + loopCount * 3 + parallelCount * 2;
    
    if (score <= 10) return 'simple';
    if (score <= 25) return 'moderate';
    return 'complex';
  }, []);

  /**
   * Generate agent definition from workflow
   */
  const generateAgentDefinition = useCallback((
    name: string,
    description: string,
    nodes: AgentNode[],
    edges: AgentEdge[]
  ): AgentDefinition => {
    const workflow: AgentWorkflow = {
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    
    // Auto-generate constitutional principles based on node types
    const principles: Array<{ id: string; principle: string; priority: number }> = [];
    
    const hasLLMNode = nodes.some((n) => n.type === 'llm');
    const hasKnowledgeNode = nodes.some((n) => n.type === 'knowledge');
    const hasIntegrationNode = nodes.some((n) => n.type === 'integration');
    
    if (hasLLMNode) {
      principles.push({
        id: 'csai-001',
        principle: 'Provide accurate and helpful responses based on available context',
        priority: 1
      });
      principles.push({
        id: 'csai-002',
        principle: 'Acknowledge uncertainty when information is incomplete',
        priority: 2
      });
    }
    
    if (hasKnowledgeNode) {
      principles.push({
        id: 'csai-003',
        principle: 'Only use information from authorized knowledge sources',
        priority: 1
      });
    }
    
    if (hasIntegrationNode) {
      principles.push({
        id: 'csai-004',
        principle: 'Respect rate limits and API quotas of external services',
        priority: 3
      });
    }
    
    // Auto-detect capabilities
    const enabledCapabilities: Array<'vision' | 'ocr' | 'audio' | 'video' | 'document-parsing'> = [];
    
    // Check node configurations for capabilities
    nodes.forEach((node) => {
      if (node.data.config?.model?.includes('vision')) {
        enabledCapabilities.push('vision');
      }
      if (node.data.config?.actionType === 'ocr') {
        enabledCapabilities.push('ocr');
      }
      if (node.data.config?.actionType === 'document-parse') {
        enabledCapabilities.push('document-parsing');
      }
    });
    
    return {
      id: uuidv4(),
      name,
      description,
      version: '1.0.0',
      status: 'draft',
      workflow,
      constitutionalPrinciples: principles.length > 0 ? principles : undefined,
      enabledCapabilities: enabledCapabilities.length > 0 ? [...new Set(enabledCapabilities)] : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }, []);

  /**
   * Serialize workflow to JSON
   */
  const serializeWorkflow = useCallback((
    nodes: AgentNode[],
    edges: AgentEdge[]
  ): string => {
    return JSON.stringify({ nodes, edges }, null, 2);
  }, []);

  /**
   * Deserialize workflow from JSON
   */
  const deserializeWorkflow = useCallback((json: string): { nodes: AgentNode[]; edges: AgentEdge[] } | null => {
    try {
      const parsed = JSON.parse(json);
      return {
        nodes: parsed.nodes || [],
        edges: parsed.edges || []
      };
    } catch {
      return null;
    }
  }, []);

  /**
   * Calculate estimated execution time
   */
  const estimateExecutionTime = useCallback((nodes: AgentNode[]): number => {
    let totalMs = 0;
    
    nodes.forEach((node) => {
      switch (node.type) {
        case 'llm':
          totalMs += 2000; // ~2s for LLM call
          break;
        case 'knowledge':
          totalMs += 500; // ~500ms for vector search
          break;
        case 'integration':
          totalMs += 1500; // ~1.5s for external API
          break;
        case 'condition':
          totalMs += 100; // ~100ms for evaluation
          break;
        case 'loop':
          const iterations = node.data.config?.maxIterations || 3;
          totalMs += 500 * iterations;
          break;
        default:
          totalMs += 200; // ~200ms default
      }
    });
    
    return totalMs;
  }, []);

  /**
   * Get node type color
   */
  const getNodeTypeColor = useCallback((type: string): string => {
    const colors: Record<string, string> = {
      trigger: '#10b981',
      llm: '#8b5cf6',
      condition: '#f59e0b',
      action: '#3b82f6',
      knowledge: '#06b6d4',
      integration: '#ec4899',
      output: '#22c55e',
      loop: '#f97316',
      parallel: '#6366f1',
      delay: '#64748b',
      webhook: '#14b8a6'
    };
    return colors[type] || '#6b7280';
  }, []);

  /**
   * Get node type icon
   */
  const getNodeTypeIcon = useCallback((type: string): string => {
    const icons: Record<string, string> = {
      trigger: 'play',
      llm: 'brain',
      condition: 'git-branch',
      action: 'zap',
      knowledge: 'database',
      integration: 'plug',
      output: 'send',
      loop: 'repeat',
      parallel: 'layers',
      delay: 'clock',
      webhook: 'webhook'
    };
    return icons[type] || 'circle';
  }, []);

  return useMemo(() => ({
    validateWorkflow,
    estimateComplexity,
    generateAgentDefinition,
    serializeWorkflow,
    deserializeWorkflow,
    estimateExecutionTime,
    getNodeTypeColor,
    getNodeTypeIcon
  }), [
    validateWorkflow,
    estimateComplexity,
    generateAgentDefinition,
    serializeWorkflow,
    deserializeWorkflow,
    estimateExecutionTime,
    getNodeTypeColor,
    getNodeTypeIcon
  ]);
};

export default useAgentBuilder;
