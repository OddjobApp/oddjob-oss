/**
 * Agent Builder Schema
 * 
 * Types and interfaces for the visual agent builder.
 */

import { z } from 'zod';

/**
 * Agent Node Types
 */
export const AgentNodeTypeSchema = z.enum([
  'trigger',
  'llm',
  'condition',
  'action',
  'knowledge',
  'integration',
  'output',
  'loop',
  'parallel',
  'delay',
  'webhook',
  'mcp-client',
  'reasoning-router'
]);

export type AgentNodeType = z.infer<typeof AgentNodeTypeSchema>;

/**
 * Agent Node Configuration
 */
export const AgentNodeConfigSchema = z.object({
  // LLM Node Config
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  systemPrompt: z.string().optional(),
  
  // Condition Node Config
  condition: z.string().optional(),
  operator: z.enum(['equals', 'contains', 'gt', 'lt', 'regex']).optional(),
  value: z.any().optional(),
  
  // Action Node Config
  actionType: z.string().optional(),
  actionParams: z.record(z.any()).optional(),
  
  // Knowledge Node Config
  collection: z.string().optional(),
  searchType: z.enum(['semantic', 'keyword', 'hybrid']).optional(),
  topK: z.number().optional(),
  
  // Integration Node Config
  integration: z.string().optional(),
  operation: z.string().optional(),
  
  // Trigger Node Config
  triggerType: z.enum(['webhook', 'schedule', 'event', 'manual']).optional(),
  schedule: z.string().optional(),
  
  // Output Node Config
  outputType: z.enum(['return', 'webhook', 'email', 'slack']).optional(),
  outputConfig: z.record(z.any()).optional(),
  
  // Loop Node Config
  loopCondition: z.string().optional(),
  maxIterations: z.number().optional(),
  
  // Delay Node Config
  delayMs: z.number().optional(),
  
  // Webhook Node Config
  webhookUrl: z.string().optional(),
  webhookMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),

  // MCP Client Node Config
  mcpServerUrl: z.string().optional(),
  mcpToolName: z.string().optional(),
  mcpToolParams: z.record(z.any()).optional(),
  mcpTimeout: z.number().optional(),

  // Reasoning Router Node Config
  reasoningModel: z.enum(['o1-preview', 'o1-mini', 'deepseek-r1', 'claude-3-opus', 'gpt-4']).optional(),
  reasoningStrategy: z.enum(['chain-of-thought', 'tree-of-thoug.js', 'self-consistency']).optional(),
  reasoningTimeout: z.number().optional(),
  enableThinking: z.boolean().optional()
});

export type AgentNodeConfig = z.infer<typeof AgentNodeConfigSchema>;

/**
 * Agent Node
 */
export const AgentNodeSchema = z.object({
  id: z.string(),
  type: AgentNodeTypeSchema,
  position: z.object({
    x: z.number(),
    y: z.number()
  }),
  data: z.object({
    label: z.string(),
    description: z.string().optional(),
    config: AgentNodeConfigSchema,
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional()
  }),
  width: z.number().optional(),
  height: z.number().optional()
});

export type AgentNode = z.infer<typeof AgentNodeSchema>;

/**
 * Agent Edge (Connection)
 */
export const AgentEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  type: z.enum(['default', 'conditional', 'error']).optional(),
  animated: z.boolean().optional(),
  data: z.object({
    condition: z.string().optional(),
    branch: z.enum(['true', 'false', 'default']).optional()
  }).optional()
});

export type AgentEdge = z.infer<typeof AgentEdgeSchema>;

/**
 * Agent Workflow
 */
export const AgentWorkflowSchema = z.object({
  nodes: z.array(AgentNodeSchema),
  edges: z.array(AgentEdgeSchema),
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    zoom: z.number()
  }).optional()
});

export type AgentWorkflow = z.infer<typeof AgentWorkflowSchema>;

/**
 * Agent Template
 */
export const AgentTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum([
    'customer-service',
    'data-processing',
    'content-generation',
    'automation',
    'analysis',
    'integration',
    'custom'
  ]),
  icon: z.string().optional(),
  workflow: AgentWorkflowSchema,
  variables: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    description: z.string(),
    required: z.boolean(),
    default: z.any().optional()
  })).optional(),
  estimatedComplexity: z.enum(['simple', 'moderate', 'complex']).optional(),
  averageLatency: z.string().optional(),
  popularity: z.number().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

/**
 * Agent Definition (Complete Agent)
 */
export const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().default('1.0.0'),
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'),
  workflow: AgentWorkflowSchema,
  
  // Constitutional AI Settings
  constitutionalPrinciples: z.array(z.object({
    id: z.string(),
    principle: z.string(),
    priority: z.number()
  })).optional(),
  
  // Knowledge Integration
  knowledgeCollections: z.array(z.string()).optional(),
  
  // Multi-Modal Settings
  enabledCapabilities: z.array(z.enum([
    'vision',
    'ocr',
    'audio',
    'video',
    'document-parsing'
  ])).optional(),
  
  // Deployment Settings
  deploymentConfig: z.object({
    environment: z.enum(['development', 'staging', 'production']),
    autoScale: z.boolean().optional(),
    rateLimit: z.number().optional(),
    timeout: z.number().optional()
  }).optional(),
  
  // Metadata
  createdBy: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  lastDeployedAt: z.string().datetime().optional(),
  usageStats: z.object({
    totalRuns: z.number(),
    successfulRuns: z.number(),
    failedRuns: z.number(),
    averageLatency: z.number()
  }).optional()
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/**
 * Natural Language to Agent Request
 */
export const NLToAgentRequestSchema = z.object({
  description: z.string().min(10).max(5000),
  context: z.object({
    domain: z.string().optional(),
    integrations: z.array(z.string()).optional(),
    knowledgeBases: z.array(z.string()).optional(),
    expectedVolume: z.enum(['low', 'medium', 'high']).optional()
  }).optional(),
  constraints: z.object({
    maxComplexity: z.enum(['simple', 'moderate', 'complex']).optional(),
    requiredCapabilities: z.array(z.string()).optional(),
    budget: z.number().optional()
  }).optional()
});

export type NLToAgentRequest = z.infer<typeof NLToAgentRequestSchema>;

/**
 * Natural Language to Agent Response
 */
export const NLToAgentResponseSchema = z.object({
  success: z.boolean(),
  agent: AgentDefinitionSchema.optional(),
  suggestedTemplate: AgentTemplateSchema.optional(),
  explanation: z.string(),
  estimatedNodes: z.number(),
  estimatedComplexity: z.enum(['simple', 'moderate', 'complex']),
  suggestedPrinciples: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional()
});

export type NLToAgentResponse = z.infer<typeof NLToAgentResponseSchema>;

/**
 * Agent Deployment Request
 */
export const AgentDeploymentRequestSchema = z.object({
  agentId: z.string(),
  environment: z.enum(['development', 'staging', 'production']),
  version: z.string().optional(),
  config: z.object({
    autoScale: z.boolean().optional(),
    rateLimit: z.number().optional(),
    timeout: z.number().optional(),
    environmentVariables: z.record(z.string()).optional()
  }).optional()
});

export type AgentDeploymentRequest = z.infer<typeof AgentDeploymentRequestSchema>;

/**
 * Agent Execution Request
 */
export const AgentExecutionRequestSchema = z.object({
  agentId: z.string(),
  version: z.string().optional(),
  input: z.record(z.any()),
  options: z.object({
    stream: z.boolean().optional(),
    timeout: z.number().optional(),
    trace: z.boolean().optional()
  }).optional()
});

export type AgentExecutionRequest = z.infer<typeof AgentExecutionRequestSchema>;

/**
 * Agent Execution Response
 */
export const AgentExecutionResponseSchema = z.object({
  success: z.boolean(),
  output: z.any().optional(),
  trace: z.array(z.object({
    nodeId: z.string(),
    nodeType: z.string(),
    input: z.any(),
    output: z.any(),
    latency: z.number(),
    timestamp: z.string().datetime()
  })).optional(),
  latency: z.number(),
  tokenUsage: z.object({
    prompt: z.number(),
    completion: z.number(),
    total: z.number()
  }).optional(),
  error: z.string().optional()
});

export type AgentExecutionResponse = z.infer<typeof AgentExecutionResponseSchema>;


