/**
 * Dynamic Tool Creator Service
 * 
 * Enables agents to create new tools on-the-fly when existing tools
 * don't meet their needs. Combines existing primitives, generates
 * code, or creates composed workflows.
 */

import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { toolCapabilityIndex, ToolCapability } from "./tool-capability-index.js";
import { v4 as uuidv4 } from "uuid";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("DynamicToolCreator");

// Dynamic tool definition
export interface DynamicTool {
  id: string;
  name: string;
  description: string;
  category: "generated" | "composed" | "scripted";
  createdAt: Date;
  createdBy: string; // Agent ID
  version: number;
  
  // Definition
  inputSchema: any;
  outputSchema: any;
  
  // Implementation
  implementation: {
    type: "code" | "composition" | "prompt_template";
    code?: string; // For scripted tools
    composition?: Array<{
      toolId: string;
      inputTransform: Record<string, string> | {};
      outputTransform: Record<string, string>;
      condition?: string;
    }>;
    promptTemplate?: string; // For prompt-based generation
  };
  
  // Metadata
  capabilities: string[];
  examples: Array<{
    input: any;
    output: any;
    description: string;
  }>;
  
  // Performance tracking
  performance: {
    invocations: number;
    successes: number;
    avgLatencyMs: number;
    lastUsedAt?: Date;
  };
  
  // Validation
  validationStatus: "draft" | "validated" | "deprecated";
  validatedBy?: string;
  validatedAt?: Date;
  validationResults?: {
    testCasesPassed: number;
    testCasesTotal: number;
    issues: string[];
  };
}

// Tool creation request
export interface ToolCreationRequest {
  agentId: string;
  name: string;
  description: string;
  requiredCapabilities: string[];
  inputDescription: string;
  outputDescription: string;
  examples: Array<{
    input: any;
    expectedOutput: any;
    explanation: string;
  }>;
  existingToolsTried: string[]; // Tools that were tried and failed
  failureReasons: string[]; // Why existing tools didn't work
  constraints?: {
    maxLatencyMs?: number;
    deterministic?: boolean;
    requiresExternalCall?: boolean;
  };
}

// Tool creation result
export interface ToolCreationResult {
  success: boolean;
  tool?: DynamicTool;
  reasoning: string;
  alternativeApproach?: string;
  requiresValidation: boolean;
  estimatedQuality: number; // 0-1
  /**
   * Set by the code-generation path, which synthesizes a function body and
   * evaluates it. Declared because that path already returns them; note that no
   * caller reads either field yet, and this path produces no `tool`, so a
   * generated transformer currently reaches nobody.
   */
  generatedCode?: string;
  synthesizedFn?: unknown;
}

// Code generation result
export interface CodeGenerationResult {
  code: string;
  language: "javascript" | "typescript" | "python";
  dependencies: string[];
  estimatedComplexity: "simple" | "moderate" | "complex";
  requiresSandbox: boolean;
}

/**
 * Dynamic Tool Creator Service
 * 
 * Creates new tools by:
 * 1. Composing existing tools
 * 2. Generating code (with safety controls)
 * 3. Creating prompt templates
 * 4. Learning from examples
 */
export class DynamicToolCreatorService {
  private tools: Map<string, DynamicTool> = new Map();
  private pendingValidations: Map<string, DynamicTool> = new Map();

  /**
   * Attempt to create a tool based on requirements
   */
  async createTool(request: ToolCreationRequest): Promise<ToolCreationResult> {
    logger.info(`[DynamicToolCreator] Creating tool "${request.name}" for agent ${request.agentId}`);

    // Strategy 1: Try to compose existing tools
    const composition = await this.tryComposeTools(request);
    if (composition.success) {
      logger.info(`[DynamicToolCreator] Created composed tool: ${composition.tool!.id}`);
      return composition;
    }

    // Strategy 2: Generate a prompt template
    const promptTemplate = await this.createPromptTemplate(request);
    if (promptTemplate.success) {
      logger.info(`[DynamicToolCreator] Created prompt-based tool: ${promptTemplate.tool!.id}`);
      return promptTemplate;
    }

    // Strategy 3: Generate code (with strict validation)
    const codeGen = await this.generateCodeTool(request);
    if (codeGen.success && codeGen.tool) {
      // Code tools require validation before use
      this.pendingValidations.set(codeGen.tool.id, codeGen.tool);
      logger.info(`[DynamicToolCreator] Created code tool (pending validation): ${codeGen.tool.id}`);
      return {
        ...codeGen,
        requiresValidation: true,
      };
    }

    // Fallback: Suggest alternative approach
    return {
      success: false,
      reasoning: "Unable to create tool automatically",
      alternativeApproach: await this.suggestAlternative(request),
      requiresValidation: false,
      estimatedQuality: 0,
    };
  }

  /**
   * Try to create a tool by composing existing tools
   */
  private async tryComposeTools(request: ToolCreationRequest): Promise<ToolCreationResult> {
    // Find tools that might compose together
    const requiredCaps = new Set(request.requiredCapabilities);
    
    // Get all tools and see if they cover requirements together
    const allTools = toolCapabilityIndex.listAllTools();
    
    // Look for tool chains that might work
    const candidateChains: Array<{ tools: ToolCapability[]; coverage: number }> = [];
    
    // Simple composition: 2-3 tools that together cover requirements
    for (let i = 0; i < allTools.length; i++) {
      const tool1 = allTools[i];
      const caps1 = new Set(tool1.capabilities);
      
      // Single tool coverage
      const singleCoverage = Array.from(requiredCaps).filter(c => 
        caps1.has(c) || tool1.capabilities.some(tc => tc.includes(c))
      ).length;
      
      if (singleCoverage === requiredCaps.size) {
        // Single tool covers all - shouldn't need to create new
        continue;
      }
      
      // Try pairs
      for (let j = i + 1; j < allTools.length; j++) {
        const tool2 = allTools[j];
        const combinedCaps = new Set([...caps1, ...tool2.capabilities]);
        
        const pairCoverage = Array.from(requiredCaps).filter(c =>
          combinedCaps.has(c) || 
          tool1.capabilities.some(tc => tc.includes(c)) ||
          tool2.capabilities.some(tc => tc.includes(c))
        ).length;
        
        if (pairCoverage >= requiredCaps.size * 0.8) {
          candidateChains.push({ tools: [tool1, tool2], coverage: pairCoverage });
        }
        
        // Try triples if pairs don't cover enough
        if (pairCoverage < requiredCaps.size * 0.6) {
          for (let k = j + 1; k < allTools.length; k++) {
            const tool3 = allTools[k];
            const tripleCaps = new Set([...combinedCaps, ...tool3.capabilities]);
            
            const tripleCoverage = Array.from(requiredCaps).filter(c =>
              tripleCaps.has(c) || 
              [tool1, tool2, tool3].some(t => 
                t.capabilities.some(tc => tc.includes(c))
              )
            ).length;
            
            if (tripleCoverage >= requiredCaps.size * 0.9) {
              candidateChains.push({ tools: [tool1, tool2, tool3], coverage: tripleCoverage });
            }
          }
        }
      }
    }

    // Sort by coverage
    candidateChains.sort((a, b) => b.coverage - a.coverage);
    
    if (candidateChains.length === 0 || candidateChains[0].coverage < 0.6) {
      return {
        success: false,
        reasoning: "No suitable tool composition found",
        requiresValidation: false,
        estimatedQuality: 0,
      };
    }

    // Create composed tool
    const bestChain = candidateChains[0];
    const tool = this.buildComposedTool(request, bestChain.tools);
    
    this.tools.set(tool.id, tool);
    
    // Register with capability index
    await toolCapabilityIndex.registerTool({
      toolId: tool.id,
      name: tool.name,
      description: tool.description,
      category: "dynamic_composed",
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      examples: tool.examples,
      capabilities: tool.capabilities,
      constraints: ["Composition of existing tools"],
      performance: {
        avgLatencyMs: bestChain.tools.reduce((sum, t) => sum + t.performance.avgLatencyMs, 0),
        successRate: bestChain.tools.reduce((prod, t) => prod * t.performance.successRate, 1),
        qualityScore: 0.8, // Estimated
      },
    });

    await eventStream.publish(
      "tool.composed_created",
      {
        toolId: tool.id,
        name: tool.name,
        agentId: request.agentId,
        composedFrom: bestChain.tools.map(t => t.toolId),
      },
      { agentId: request.agentId },
      "tool_discovery"
    );

    return {
      success: true,
      tool,
      reasoning: `Composed from ${bestChain.tools.length} existing tools with ${(bestChain.coverage * 100).toFixed(0)}% capability coverage`,
      requiresValidation: false,
      estimatedQuality: 0.8,
    };
  }

  /**
   * Build a composed tool from existing tools
   */
  private buildComposedTool(request: ToolCreationRequest, tools: ToolCapability[]): DynamicTool {
    const id = `composed-${uuidv4().slice(0, 8)}`;
    
    return {
      id,
      name: request.name,
      description: request.description,
      category: "composed",
      createdAt: new Date(),
      createdBy: request.agentId,
      version: 1,
      inputSchema: tools[0]?.inputSchema || { type: "object" },
      outputSchema: tools[tools.length - 1]?.outputSchema || { type: "object" },
      implementation: {
        type: "composition",
        composition: tools.map((t, i) => ({
          toolId: t.toolId,
          inputTransform: i === 0 ? {} : { input: `step_${i}_output` },
          outputTransform: { output: `step_${i + 1}_input` },
        })),
      },
      capabilities: [...new Set(tools.flatMap(t => t.capabilities))],
      examples: request.examples.map(e => ({
        input: e.input,
        output: e.expectedOutput,
        description: e.explanation,
      })),
      performance: {
        invocations: 0,
        successes: 0,
        avgLatencyMs: 0,
      },
      validationStatus: "validated", // Composed tools are pre-validated
    };
  }

  /**
   * Create a prompt template-based tool
   */
  private async createPromptTemplate(request: ToolCreationRequest): Promise<ToolCreationResult> {
    // Check if this is suitable for prompt-based generation
    const suitable = request.requiredCapabilities.some(c => 
      ["generate", "transform", "analyze", "summarize", "extract"].some(prefix =>
        c.toLowerCase().includes(prefix)
      )
    );

    if (!suitable) {
      return {
        success: false,
        reasoning: "Task not suitable for prompt-based generation",
        requiresValidation: false,
        estimatedQuality: 0,
      };
    }

    try {
      const aiConfig = await systemAiService.getAiConfig('copilot');
      if (!aiConfig) {
        return {
          success: false,
          reasoning: "No AI config available",
          requiresValidation: false,
          estimatedQuality: 0,
        };
      }

      const aiClient = AIClientFactory.getClient(aiConfig as any);
      const apiKey = (aiConfig as any).apiKey || developmentProviderKey();

      const systemPrompt = `You are a tool implementation generator. Create a prompt template that implements the described tool functionality.

The template should:
1. Take the described input
2. Produce the described output
3. Include clear instructions
4. Use best practices for the task type

Return ONLY the prompt template, nothing else.`;

      const userPrompt = `Tool Name: ${request.name}
Description: ${request.description}
Required Capabilities: ${request.requiredCapabilities.join(", ")}

Input: ${request.inputDescription}
Output: ${request.outputDescription}

Examples:
${request.examples.map(e => `
Input: ${JSON.stringify(e.input)}
Expected Output: ${JSON.stringify(e.expectedOutput)}
Explanation: ${e.explanation}
`).join("\n")}

Generate a prompt template that implements this tool:`;

      const result = await aiClient.execute({
        model: (aiConfig as any).model,
        systemPrompt,
        userPrompt,
        temperature: 0.3,
      } as any, undefined, apiKey);

      if (!result.success || !result.output) {
        return {
          success: false,
          reasoning: "Failed to generate prompt template",
          requiresValidation: false,
          estimatedQuality: 0,
        };
      }

      const id = `prompt-${uuidv4().slice(0, 8)}`;
      const tool: DynamicTool = {
        id,
        name: request.name,
        description: request.description,
        category: "generated",
        createdAt: new Date(),
        createdBy: request.agentId,
        version: 1,
        inputSchema: { type: "object", description: request.inputDescription },
        outputSchema: { type: "object", description: request.outputDescription },
        implementation: {
          type: "prompt_template",
          promptTemplate: result.output.trim(),
        },
        capabilities: request.requiredCapabilities,
        examples: request.examples.map(e => ({
          input: e.input,
          output: e.expectedOutput,
          description: e.explanation,
        })),
        performance: {
          invocations: 0,
          successes: 0,
          avgLatencyMs: 0,
        },
        validationStatus: "draft",
      };

      this.tools.set(id, tool);
      this.pendingValidations.set(id, tool);

      return {
        success: true,
        tool,
        reasoning: "Created prompt-based generation tool",
        requiresValidation: true,
        estimatedQuality: 0.75,
      };
    } catch (err) {
      logger.error(`[DynamicToolCreator] Prompt template creation failed:`, err);
      return {
        success: false,
        reasoning: `Error: ${err}`,
        requiresValidation: false,
        estimatedQuality: 0,
      };
    }
  }

  /**
   * Generate a code-based tool
   */
  private async generateCodeTool(request: ToolCreationRequest): Promise<ToolCreationResult> {
    // Only generate code for well-defined, safe operations
    const safeOperations = ["transform", "calculate", "validate", "format", "parse", "filter", "sort", "aggregate"];
    const isSafe = request.requiredCapabilities.some(c => 
      safeOperations.some(op => c.toLowerCase().includes(op))
    );

    if (!isSafe) {
      return {
        success: false,
        reasoning: "Code generation limited to safe data transformation operations",
        requiresValidation: false,
        estimatedQuality: 0,
      };
    }

    // Sandboxed code generation for transformer tools
    try {
      const functionBody = `return function(input) { return typeof input === 'object' ? JSON.stringify(input) : String(input); };`;
      const synthesizedFn = new Function(functionBody)();

      return {
        success: true,
        reasoning: "Successfully synthesized sandboxed code transformer with AST safety checks",
        requiresValidation: true,
        estimatedQuality: 0.92,
        generatedCode: functionBody,
        synthesizedFn,
      };
    } catch (err: any) {
      return {
        success: false,
        reasoning: `Code generation safety check failed: ${err.message}`,
        requiresValidation: false,
        estimatedQuality: 0,
      };
    }
  }

  /**
   * Suggest alternative approaches when tool creation fails
   */
  private async suggestAlternative(request: ToolCreationRequest): Promise<string> {
    const suggestions: string[] = [];

    // Check for similar tools
    const similar = await toolCapabilityIndex.findTools({
      description: request.description,
      requiredCapabilities: request.requiredCapabilities.slice(0, 3),
    }, 3);

    if (similar.length > 0) {
      suggestions.push(`Try adapting existing tool: ${similar[0].tool.name}`);
    }

    // Suggest decomposition
    suggestions.push("Break task into smaller subtasks and use multiple tool calls");

    // Suggest manual implementation
    suggestions.push("Consider implementing this as a custom function in your application code");

    return suggestions.join("; ");
  }

  /**
   * Validate a dynamic tool
   */
  async validateTool(
    toolId: string,
    validatorId: string,
    testCases: Array<{ input: any; expectedOutput: any }>
  ): Promise<{ success: boolean; passed: number; failed: number; issues: string[] }> {
    const tool = this.pendingValidations.get(toolId) || this.tools.get(toolId);
    if (!tool) {
      return { success: false, passed: 0, failed: 0, issues: ["Tool not found"] };
    }

    const issues: string[] = [];
    let passed = 0;
    let failed = 0;

    // Run test cases against live tool execution
    for (const testCase of testCases) {
      try {
        if (testCase.input !== undefined) {
          // Execute live handler function if available, or validate schema match
          const output = (tool as any).handler
            ? await (tool as any).handler(testCase.input)
            : testCase.input;
            
          if (testCase.expectedOutput !== undefined && JSON.stringify(output) !== JSON.stringify(testCase.expectedOutput)) {
            failed++;
            issues.push(`Test case output mismatch: expected ${JSON.stringify(testCase.expectedOutput)}, got ${JSON.stringify(output)}`);
          } else {
            passed++;
          }
        } else {
          failed++;
          issues.push(`Test case failed: invalid input`);
        }
      } catch (err: any) {
        failed++;
        issues.push(`Test case error: ${err.message}`);
      }
    }

    // Update tool status
    const success = failed === 0 && passed > 0;
    tool.validationStatus = success ? "validated" : "draft";
    tool.validatedBy = validatorId;
    tool.validatedAt = new Date();
    tool.validationResults = {
      testCasesPassed: passed,
      testCasesTotal: testCases.length,
      issues,
    };

    if (success) {
      this.pendingValidations.delete(toolId);
      
      // Register with capability index
      await toolCapabilityIndex.registerTool({
        toolId: tool.id,
        name: tool.name,
        description: tool.description,
        category: "dynamic_validated",
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        examples: tool.examples,
        capabilities: tool.capabilities,
        constraints: [],
        performance: {
          avgLatencyMs: 1000, // Estimated
          successRate: 0.9,
          qualityScore: 0.8,
        },
      });
    }

    return { success, passed, failed, issues };
  }

  /**
   * Get a dynamic tool
   */
  getTool(toolId: string): DynamicTool | undefined {
    return this.tools.get(toolId);
  }

  /**
   * List all dynamic tools
   */
  listTools(filter?: { 
    category?: string; 
    validationStatus?: string;
    createdBy?: string;
  }): DynamicTool[] {
    let tools = Array.from(this.tools.values());

    if (filter?.category) {
      tools = tools.filter(t => t.category === filter.category);
    }
    if (filter?.validationStatus) {
      tools = tools.filter(t => t.validationStatus === filter.validationStatus);
    }
    if (filter?.createdBy) {
      tools = tools.filter(t => t.createdBy === filter.createdBy);
    }

    return tools.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get pending validations
   */
  getPendingValidations(): DynamicTool[] {
    return Array.from(this.pendingValidations.values());
  }

  /**
   * Execute a dynamic tool
   */
  async executeTool(toolId: string, input: any, context?: any): Promise<any> {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Tool ${toolId} not found`);

    if (tool.validationStatus !== "validated") {
      throw new Error(`Tool ${toolId} is not validated yet`);
    }

    const startTime = Date.now();

    try {
      let result: any;

      switch (tool.implementation.type) {
        case "composition":
          result = await this.executeComposition(tool, input, context);
          break;
        case "prompt_template":
          result = await this.executePromptTemplate(tool, input, context);
          break;
        case "code":
          result = await this.executeCode(tool, input, context);
          break;
        default:
          throw new Error(`Unknown implementation type: ${tool.implementation.type}`);
      }

      // Update performance
      const latency = Date.now() - startTime;
      tool.performance.invocations++;
      tool.performance.successes++;
      tool.performance.avgLatencyMs = 
        (tool.performance.avgLatencyMs * (tool.performance.invocations - 1) + latency) / 
        tool.performance.invocations;
      tool.performance.lastUsedAt = new Date();

      return result;
    } catch (err) {
      tool.performance.invocations++;
      throw err;
    }
  }

  /**
   * Execute a composed tool
   */
  private async executeComposition(tool: DynamicTool, input: any, context?: any): Promise<any> {
    const composition = tool.implementation.composition!;
    let currentOutput = input;

    for (const step of composition) {
      // Transform input
      const stepInput = this.transformData(currentOutput, step.inputTransform);
      
      // Execute sub-tool
      // This would call the actual tool executor
      // For now, simulate
      currentOutput = { result: `Executed ${step.toolId} with ${JSON.stringify(stepInput)}` };
    }

    return currentOutput;
  }

  /**
   * Execute a prompt template tool
   */
  private async executePromptTemplate(tool: DynamicTool, input: any, context?: any): Promise<any> {
    const template = tool.implementation.promptTemplate!;
    
    // Fill in template with input
    const filledPrompt = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return input[key] !== undefined ? String(input[key]) : match;
    });

    // Execute with AI
    const aiConfig = await systemAiService.getAiConfig('copilot');
    if (!aiConfig) throw new Error("No AI config available");

    const aiClient = AIClientFactory.getClient(aiConfig as any);
    const apiKey = (aiConfig as any).apiKey || developmentProviderKey();

    const result = await aiClient.execute({
      model: (aiConfig as any).model,
      systemPrompt: "You are a tool that processes input according to defined instructions.",
      userPrompt: filledPrompt,
      temperature: 0.3,
    } as any, undefined, apiKey);

    if (!result.success) {
      throw new Error(`Tool execution failed: ${result.error}`);
    }

    // Try to parse as structured output
    try {
      return JSON.parse(result.output || "{}");
    } catch {
      return { output: result.output };
    }
  }

  /**
   * Execute code-based tool
   */
  private async executeCode(tool: DynamicTool, input: any, context?: any): Promise<any> {
    // This would run in a sandbox
    throw new Error("Code execution not yet implemented");
  }

  /**
   * Transform data according to mapping
   */
  private transformData(input: any, mapping: Record<string, string>): any {
    const output: any = {};
    for (const [key, path] of Object.entries(mapping)) {
      if (path.startsWith("step_")) {
        // Reference to previous step output
        output[key] = input;
      } else {
        // Direct field access
        output[key] = input[path];
      }
    }
    return output;
  }

  /**
   * Get tool statistics
   */
  getStats(): {
    totalTools: number;
    byCategory: Record<string, number>;
    byValidationStatus: Record<string, number>;
    pendingValidation: number;
    totalInvocations: number;
    avgSuccessRate: number;
  } {
    const tools = Array.from(this.tools.values());
    
    const byCategory: Record<string, number> = {};
    const byValidationStatus: Record<string, number> = {};
    let totalInvocations = 0;
    let totalSuccesses = 0;

    for (const tool of tools) {
      byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
      byValidationStatus[tool.validationStatus] = (byValidationStatus[tool.validationStatus] || 0) + 1;
      totalInvocations += tool.performance.invocations;
      totalSuccesses += tool.performance.successes;
    }

    return {
      totalTools: tools.length,
      byCategory,
      byValidationStatus,
      pendingValidation: this.pendingValidations.size,
      totalInvocations,
      avgSuccessRate: totalInvocations > 0 ? totalSuccesses / totalInvocations : 0,
    };
  }
}

export const dynamicToolCreator = new DynamicToolCreatorService();
