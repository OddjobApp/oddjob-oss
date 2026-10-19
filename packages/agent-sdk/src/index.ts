export interface AgentSkillDefinition {
  name: string;
  description: string;
  version: string;
  tags?: string[];
  tools?: AgentToolDefinition[];
  handler: (input: Record<string, any>, context: AgentExecutionContext) => Promise<Record<string, any>>;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>) => Promise<any>;
}

export interface AgentExecutionContext {
  agentId: number;
  missionId: number;
  traceparent?: string;
  logger: {
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

/**
 * Helper function for third-party developers to define a structured Oddjob Agent Skill.
 */
export function defineSkill(definition: AgentSkillDefinition): AgentSkillDefinition {
  if (!definition.name || !definition.description || !definition.handler) {
    throw new Error('Invalid Skill Definition: name, description, and handler are required.');
  }
  return definition;
}

/**
 * Helper function for third-party developers to define an agent tool.
 */
export function defineTool(tool: AgentToolDefinition): AgentToolDefinition {
  if (!tool.name || !tool.execute) {
    throw new Error('Invalid Tool Definition: name and execute function are required.');
  }
  return tool;
}
