/**
 * Reasoning Router Service
 * 
 * Routes complex reasoning tasks to specialized reasoning models (o1, o3, DeepSeek-R1)
 * with support for chain-of-thought, tree-of-thoughts, and self-consistency strategies.
 */

import { createLogger } from '../../../utils/logger.js';
import { AIResponse, AIClientFactory, AiQuotaManager } from './ai-client.service.js';
import { systemAiService } from './system-ai.service.js';
import { REASONING_PROMPTS } from '../../../prompts/agent-prompts.js';

const logger = createLogger('ReasoningRouterService');

export type ReasoningModel = 'o1-preview' | 'o1-mini' | 'deepseek-r1' | 'claude-3-opus' | 'gpt-4';

export type ReasoningStrategy = 
  | 'chain-of-thought' 
  | 'tree-of-thoughts' 
  | 'self-consistency'
  | 'reflexion'
  | 'plan-and-solve';

export interface ReasoningRequest {
  /** Input query or problem */
  query: string;
  /** Target reasoning model */
  model: ReasoningModel;
  /** Reasoning strategy to apply */
  strategy?: ReasoningStrategy;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Enable thinking/reasoning output */
  enableThinking?: boolean;
  /** Temperature (only for non-reasoning models) */
  temperature?: number;
  /** Context from previous steps */
  context?: string[];
  /** Maximum reasoning time in ms */
  timeout?: number;
}

export interface ReasoningStep {
  /** Step number */
  step: number;
  /** Step description */
  description: string;
  /** Reasoning content */
  reasoning: string;
  /** Confidence score */
  confidence?: number;
  /** Time taken for this step */
  latencyMs: number;
}

export interface ReasoningResult extends AIResponse {
  /** Reasoning chain/steps */
  reasoningSteps: ReasoningStep[];
  /** Final answer */
  finalAnswer: string;
  /** Total reasoning time */
  totalLatencyMs: number;
  /** Strategy used */
  strategy: ReasoningStrategy;
  /** Model used */
  model: ReasoningModel;
  /** Self-verification score */
  verificationScore?: number;
  /** Number of reasoning paths explored (for tree-of-thoughts) */
  pathsExplored?: number;
}

export interface TreeOfThoughtsBranch {
  /** Branch ID */
  id: string;
  /** Parent branch ID */
  parentId?: string;
  /** Thought/reasoning at this step */
  thought: string;
  /** Score/quality of this thought */
  score: number;
  /** Depth in tree */
  depth: number;
  /** Whether this is a terminal node */
  isTerminal: boolean;
  /** Answer if terminal */
  answer?: string;
}

/**
 * Reasoning Router Service
 */
export class ReasoningRouterService {
  private reasoningModels: Set<ReasoningModel> = new Set([
    'o1-preview',
    'o1-mini',
    'deepseek-r1',
    'claude-3-opus',
    'gpt-4'
  ]);

  private modelCapabilities: Record<ReasoningModel, {
    supportsThinking: boolean;
    maxTokens: number;
    typicalLatencyMs: number;
    bestFor: string[];
  }> = {
    'o1-preview': {
      supportsThinking: true,
      maxTokens: 32768,
      typicalLatencyMs: 15000,
      bestFor: ['complex-math', 'coding', 'scientific-reasoning', 'multi-step']
    },
    'o1-mini': {
      supportsThinking: true,
      maxTokens: 65536,
      typicalLatencyMs: 5000,
      bestFor: ['quick-reasoning', 'coding', 'logic-puzzles']
    },
    'deepseek-r1': {
      supportsThinking: true,
      maxTokens: 8192,
      typicalLatencyMs: 8000,
      bestFor: ['math', 'coding', 'chinese-language']
    },
    'claude-3-opus': {
      supportsThinking: false,
      maxTokens: 4096,
      typicalLatencyMs: 4000,
      bestFor: ['analysis', 'writing', 'creative-tasks']
    },
    'gpt-4': {
      supportsThinking: false,
      maxTokens: 8192,
      typicalLatencyMs: 3000,
      bestFor: ['general-tasks', 'summarization']
    }
  };

  constructor() {
    logger.info('Reasoning Router Service initialized');
  }

  /**
   * Execute reasoning with the specified model and strategy
   */
  async reason(request: ReasoningRequest): Promise<ReasoningResult> {
    const startTime = Date.now();
    const strategy = request.strategy || 'chain-of-thought';

    logger.info(`Starting reasoning`, {
      model: request.model,
      strategy,
      queryLength: request.query.length
    });

    try {
      let result: ReasoningResult;

      switch (strategy) {
        case 'chain-of-thought':
          result = await this.chainOfThought(request);
          break;
        case 'tree-of-thoughts':
          result = await this.treeOfThoughts(request);
          break;
        case 'self-consistency':
          result = await this.selfConsistency(request);
          break;
        case 'reflexion':
          result = await this.reflexion(request);
          break;
        case 'plan-and-solve':
          result = await this.planAndSolve(request);
          break;
        default:
          result = await this.chainOfThought(request);
      }

      const totalLatency = Date.now() - startTime;
      result.totalLatencyMs = totalLatency;

      logger.info(`Reasoning complete`, {
        model: request.model,
        strategy,
        totalLatency,
        steps: result.reasoningSteps.length
      });

      return result;
    } catch (error) {
      logger.error(`Reasoning failed`, { error, model: request.model });
      throw error;
    }
  }

  /**
   * Chain-of-thought reasoning
   * Breaks problem into sequential steps
   */
  private async chainOfThought(request: ReasoningRequest): Promise<ReasoningResult> {
    const steps: ReasoningStep[] = [];
    const stepStart = Date.now();

    // Step 1: Problem understanding
    const understandingStep = await this.generateStep(
      request,
      'Understand the problem',
      request.query,
      1
    );
    steps.push(understandingStep);

    // Step 2: Break down (for complex problems)
    const breakdownStep = await this.generateStep(
      request,
      'Break down into sub-problems',
      `Based on the problem: ${request.query}\n\nPrevious understanding: ${understandingStep.reasoning}`,
      2
    );
    steps.push(breakdownStep);

    // Step 3: Solve each sub-problem
    const solveStep = await this.generateStep(
      request,
      'Solve step by step',
      `Sub-problems: ${breakdownStep.reasoning}\n\nNow solve each step.`,
      3
    );
    steps.push(solveStep);

    // Step 4: Verify and conclude
    const verifyStep = await this.generateStep(
      request,
      'Verify and conclude',
      `Solution: ${solveStep.reasoning}\n\nVerify this solution is correct and provide final answer.`,
      4
    );
    steps.push(verifyStep);

    return {
      success: true,
      finalAnswer: this.extractFinalAnswer(verifyStep.reasoning),
      reasoningSteps: steps,
      totalLatencyMs: Date.now() - stepStart,
      strategy: 'chain-of-thought',
      model: request.model,
      verificationScore: 0.85
    };
  }

  /**
   * Tree-of-thoughts reasoning
   * Explores multiple reasoning paths and selects best
   */
  private async treeOfThoughts(request: ReasoningRequest): Promise<ReasoningResult> {
    const branches: TreeOfThoughtsBranch[] = [];
    const stepStart = Date.now();

    // Generate initial thoughts
    const initialThoughts = await this.generateInitialThoughts(request, 3);
    
    for (const thought of initialThoughts) {
      branches.push({
        id: `branch-${branches.length}`,
        thought,
        score: 0,
        depth: 0,
        isTerminal: false
      });
    }

    // Expand tree to depth 2
    for (let depth = 0; depth < 2; depth++) {
      const currentBranches = branches.filter(b => b.depth === depth && !b.isTerminal);
      
      for (const branch of currentBranches) {
        const expansions = await this.expandThought(request, branch, 2);
        
        for (const expansion of expansions) {
          const newBranch: TreeOfThoughtsBranch = {
            id: `branch-${branches.length}`,
            parentId: branch.id,
            thought: expansion.thought,
            score: expansion.score,
            depth: depth + 1,
            isTerminal: expansion.isTerminal,
            answer: expansion.answer
          };
          branches.push(newBranch);
        }
      }
    }

    // Score all terminal branches and pick best.
    //
    // A branch is terminal only when the model happens to write "answer:" or
    // "conclusion:", which it may never do inside two levels of expansion. That
    // left this reducing an EMPTY array with no initial value — a TypeError out
    // of the reasoning router rather than an answer. When nothing declared
    // itself terminal, the highest-scoring branch explored is the best available
    // answer, and the seed branches guarantee there is one.
    const terminalBranches = branches.filter(b => b.isTerminal);
    const candidates = terminalBranches.length > 0 ? terminalBranches : branches;
    const bestBranch = candidates.reduce(
      (best, current) => (current.score > best.score ? current : best),
      candidates[0]
    );

    // Convert to reasoning steps
    const steps = this.convertTreeToSteps(branches, bestBranch);

    return {
      success: true,
      finalAnswer: bestBranch.answer || bestBranch.thought,
      reasoningSteps: steps,
      totalLatencyMs: Date.now() - stepStart,
      strategy: 'tree-of-thoughts',
      model: request.model,
      pathsExplored: branches.length,
      verificationScore: bestBranch.score
    };
  }

  /**
   * Self-consistency reasoning
   * Generates multiple answers and picks most common
   */
  private async selfConsistency(request: ReasoningRequest): Promise<ReasoningResult> {
    const paths = 5;
    const answers: { answer: string; count: number }[] = [];
    const stepStart = Date.now();
    const steps: ReasoningStep[] = [];

    // Generate multiple reasoning paths
    for (let i = 0; i < paths; i++) {
      const pathResult = await this.chainOfThought({
        ...request,
        temperature: 0.7 + (i * 0.1) // Vary temperature for diversity
      });

      steps.push(...pathResult.reasoningSteps.map(s => ({ ...s, step: s.step + i * 10 })));

      const answer = pathResult.finalAnswer;
      const existing = answers.find(a => this.similarAnswers(a.answer, answer));
      
      if (existing) {
        existing.count++;
      } else {
        answers.push({ answer, count: 1 });
      }
    }

    // Pick most common answer
    const bestAnswer = answers.reduce((best, current) => 
      current.count > best.count ? current : best
    );

    return {
      success: true,
      finalAnswer: bestAnswer.answer,
      reasoningSteps: steps.slice(0, 5), // Show first path as example
      totalLatencyMs: Date.now() - stepStart,
      strategy: 'self-consistency',
      model: request.model,
      verificationScore: bestAnswer.count / paths
    };
  }

  /**
   * Reflexion reasoning
   * Self-critique and improvement
   */
  private async reflexion(request: ReasoningRequest): Promise<ReasoningResult> {
    const steps: ReasoningStep[] = [];
    const stepStart = Date.now();
    const maxIterations = 3;

    // Initial attempt
    let currentResult = await this.chainOfThought(request);
    steps.push(...currentResult.reasoningSteps);

    // Reflexion loop
    for (let i = 0; i < maxIterations; i++) {
      const critiqueStep = await this.generateStep(
        request,
        `Self-critique (iteration ${i + 1})`,
        `Previous solution: ${currentResult.finalAnswer}\n\nCritique this solution. What are the flaws or areas for improvement?`,
        steps.length + 1
      );
      steps.push(critiqueStep);

      // Check if improvement needed
      if (critiqueStep.reasoning.toLowerCase().includes('no issues') ||
          critiqueStep.reasoning.toLowerCase().includes('correct')) {
        break;
      }

      // Improve solution
      const improveStep = await this.generateStep(
        request,
        `Improve solution (iteration ${i + 1})`,
        `Critique: ${critiqueStep.reasoning}\n\nProvide an improved solution addressing these issues.`,
        steps.length + 1
      );
      steps.push(improveStep);

      currentResult.finalAnswer = this.extractFinalAnswer(improveStep.reasoning);
    }

    return {
      success: true,
      finalAnswer: currentResult.finalAnswer,
      reasoningSteps: steps,
      totalLatencyMs: Date.now() - stepStart,
      strategy: 'reflexion',
      model: request.model,
      verificationScore: 0.9
    };
  }

  /**
   * Plan-and-solve reasoning
   * First plan, then execute
   */
  private async planAndSolve(request: ReasoningRequest): Promise<ReasoningResult> {
    const steps: ReasoningStep[] = [];
    const stepStart = Date.now();

    // Step 1: Create plan
    const planStep = await this.generateStep(
      request,
      'Create plan',
      `Create a detailed step-by-step plan to solve this problem: ${request.query}`,
      1
    );
    steps.push(planStep);

    // Parse plan (structured JSON)
    let planItems: string[] = [];
    try {
        const planJson = JSON.parse(planStep.reasoning);
        planItems = planJson.steps || planJson.tasks || [];
    } catch {
        // Fallback to numbered list parsing if JSON fails
        planItems = planStep.reasoning
            .split('\n')
            .filter(line => /^\d+\./.test(line.trim()))
            .map(line => line.replace(/^\d+\.\s*/, '').trim());
    }

    // Step 2: Execute each plan item
    for (let i = 0; i < planItems.length && i < 5; i++) {
      const executeStep = await this.generateStep(
        request,
        `Execute step ${i + 1}`,
        `Plan: ${planStep.reasoning}\n\nExecuting step: ${planItems[i]}`,
        steps.length + 1
      );
      steps.push(executeStep);
    }

    // Step 3: Final synthesis
    const synthesisStep = await this.generateStep(
      request,
      'Synthesize final answer',
      `Plan: ${planStep.reasoning}\n\nExecution results: ${steps.slice(1).map(s => s.reasoning).join('\n')}\n\nProvide the final answer.`,
      steps.length + 1
    );
    steps.push(synthesisStep);

    return {
      success: true,
      finalAnswer: this.extractFinalAnswer(synthesisStep.reasoning),
      reasoningSteps: steps,
      totalLatencyMs: Date.now() - stepStart,
      strategy: 'plan-and-solve',
      model: request.model,
      verificationScore: 0.88
    };
  }

  /**
   * Generate a single reasoning step
   */
  private async generateStep(
    request: ReasoningRequest,
    stepName: string,
    prompt: string,
    stepNumber: number
  ): Promise<ReasoningStep> {
    const start = Date.now();
    
    // This would call the actual LLM
    // For now, simulating the response structure
    const reasoning = await this.callReasoningModel(request, prompt);

    return {
      step: stepNumber,
      description: stepName,
      reasoning,
      confidence: 0.85,
      latencyMs: Date.now() - start
    };
  }

  /**
   * Call the reasoning model via actual AI client
   */
  private async callReasoningModel(request: ReasoningRequest, prompt: string): Promise<string> {
    const startTime = Date.now();
    logger.info(`Calling reasoning model ${request.model}`, { promptLength: prompt.length });

    try {
      // Map reasoning models to actual provider models
      const modelMapping: Record<ReasoningModel, { provider: string; model: string }> = {
        'o1-preview': { provider: 'openai', model: 'o1-preview' },
        'o1-mini': { provider: 'openai', model: 'o1-mini' },
        'deepseek-r1': { provider: 'deepseek', model: 'deepseek-reasoner' },
        'claude-3-opus': { provider: 'anthropic', model: 'claude-3-opus-20240229' },
        'gpt-4': { provider: 'openai', model: 'gpt-4-turbo' }
      };

      const modelConfig = modelMapping[request.model];
      if (!modelConfig) {
        throw new Error(`Unknown reasoning model: ${request.model}`);
      }

      // Get AI config from system service
      const config = await systemAiService.getAiConfig('copilot');
      if (!config?.apiKey) {
        throw new Error('No AI API key configured');
      }

      // Check if we should use the configured provider or fall back
      const provider = config.provider || modelConfig.provider;
      const model = config.model || modelConfig.model;

      // Throttle to respect rate limits (priority call)
      await AiQuotaManager.throttle(true);

      // Get AI client
      const client = AIClientFactory.getClient({
        provider,
        baseUrl: config.baseUrl
      } as any);

      // Build system prompt based on reasoning strategy
      let systemPrompt = REASONING_PROMPTS.baseSystem;
      
      if (request.strategy === 'chain-of-thought') {
        systemPrompt += REASONING_PROMPTS.chainOfThought;
      } else if (request.strategy === 'tree-of-thoughts') {
        systemPrompt += REASONING_PROMPTS.treeOfThoughts;
      } else if (request.strategy === 'self-consistency') {
        systemPrompt += REASONING_PROMPTS.selfConsistency;
      }

      if (request.enableThinking) {
        systemPrompt += REASONING_PROMPTS.enableThinking;
      }

      // Execute the AI call
      const response = await client.execute({
        userPrompt: prompt,
        systemPrompt,
        model,
        temperature: request.temperature ?? 0.7,
        maxTokens: request.maxTokens ?? 4000
      } as any, undefined, config.apiKey);

      // Report success to quota manager
      await AiQuotaManager.reportSuccess();

      const latency = Date.now() - startTime;
      logger.info(`Reasoning model call completed`, {
        model: request.model,
        latency,
        success: response.success
      });

      if (!response.success) {
        throw new Error(`AI call failed: ${response.error}`);
      }

      return response.output || 'No response generated';

    } catch (error: any) {
      // Report failure to quota manager
      await AiQuotaManager.reportFailure();

      logger.error(`Reasoning model call failed`, {
        model: request.model,
        error: error.message
      });

      // Return error message in reasoning format
      return `[Error during reasoning: ${error.message}. Please try again or select a different model.]`;
    }
  }

  /**
   * Generate initial thoughts for tree-of-thoughts
   */
  private async generateInitialThoughts(request: ReasoningRequest, count: number): Promise<string[]> {
    const thoughts: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const thought = await this.callReasoningModel(
        request,
        REASONING_PROMPTS.generateInitialThought(request.query, i + 1)
      );
      thoughts.push(thought);
    }

    return thoughts;
  }

  /**
   * Expand a thought branch
   */
  private async expandThought(
    request: ReasoningRequest,
    branch: TreeOfThoughtsBranch,
    expansions: number
  ): Promise<Array<{ thought: string; score: number; isTerminal: boolean; answer?: string }>> {
    const results: Array<{ thought: string; score: number; isTerminal: boolean; answer?: string }> = [];

    for (let i = 0; i < expansions; i++) {
      const expansion = await this.callReasoningModel(
        request,
        REASONING_PROMPTS.expandThought(branch.thought, i + 1)
      );

      const isTerminal = expansion.toLowerCase().includes('answer:') || 
                        expansion.toLowerCase().includes('conclusion:');

      const evaluation = await this.evaluateThought(request, expansion);

      results.push({
        thought: expansion,
        score: evaluation.score,
        isTerminal,
        answer: isTerminal ? this.extractFinalAnswer(expansion) : undefined
      });
    }

    return results;
  }

  /**
   * Convert tree branches to reasoning steps
   */
  private convertTreeToSteps(
    branches: TreeOfThoughtsBranch[],
    bestBranch: TreeOfThoughtsBranch
  ): ReasoningStep[] {
    // Build path from root to best branch
    const path: TreeOfThoughtsBranch[] = [];
    let current: TreeOfThoughtsBranch | undefined = bestBranch;
    
    while (current) {
      path.unshift(current);
      current = branches.find(b => b.id === current?.parentId);
    }

    return path.map((branch, index) => ({
      step: index + 1,
      description: `Thought path depth ${branch.depth}`,
      reasoning: branch.thought,
      confidence: branch.score,
      latencyMs: 0
    }));
  }

  /**
   * Extract final answer from reasoning output
   */
  private extractFinalAnswer(reasoning: string): string {
    // Look for common answer patterns
    const patterns = [
      /answer:\s*(.+)/i,
      /final answer:\s*(.+)/i,
      /conclusion:\s*(.+)/i,
      /therefore,\s*(.+)/i,
      /in conclusion,\s*(.+)/i
    ];

    for (const pattern of patterns) {
      const match = reasoning.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Return last sentence if no pattern found
    const sentences = reasoning.split(/[.!?]+/).filter(s => s.trim());
    return sentences[sentences.length - 1]?.trim() || reasoning;
  }

  /**
   * Check if two answers are similar
   */
  private similarAnswers(a: string, b: string): boolean {
    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizedA = normalize(a);
    const normalizedB = normalize(b);
    
    // Exact match or contains
    return normalizedA === normalizedB || 
           normalizedA.includes(normalizedB) || 
           normalizedB.includes(normalizedA);
  }

  /**
   * Recommend best reasoning strategy for a query
   */
  recommendStrategy(query: string): ReasoningStrategy {
    const queryLower = query.toLowerCase();
    
    // Math problems
    if (/\d+\s*[\+\-\*\/\^]\s*\d+/.test(query) || 
        queryLower.includes('calculate') ||
        queryLower.includes('solve for')) {
      return 'chain-of-thought';
    }

    // Open-ended creative problems
    if (queryLower.includes('design') || 
        queryLower.includes('create') ||
        queryLower.includes('brainstorm')) {
      return 'tree-of-thoughts';
    }

    // Complex multi-step problems
    if (queryLower.includes('steps') || 
        queryLower.includes('process') ||
        queryLower.includes('how to')) {
      return 'plan-and-solve';
    }

    // Factual questions
    if (queryLower.includes('what is') || 
        queryLower.includes('who is') ||
        queryLower.includes('when')) {
      return 'self-consistency';
    }

    // Default
    return 'chain-of-thought';
  }

  /**
   * Recommend best model for a query
   */
  recommendModel(query: string): ReasoningModel {
    const queryLower = query.toLowerCase();
    
    // Complex reasoning
    if (queryLower.includes('prove') || 
        queryLower.includes('theorem') ||
        queryLower.includes('complex')) {
      return 'o1-preview';
    }

    // Coding
    if (queryLower.includes('code') || 
        queryLower.includes('program') ||
        queryLower.includes('debug')) {
      return 'o1-mini';
    }

    // Math
    if (/\d+/.test(query) && (queryLower.includes('solve') || queryLower.includes('calculate'))) {
      return 'deepseek-r1';
    }

    // Analysis
    if (queryLower.includes('analyze') || 
        queryLower.includes('compare') ||
        queryLower.includes('evaluate')) {
      return 'claude-3-opus';
    }

    // Default
    return 'gpt-4';
  }

  /**
   * Get model capabilities
   */
  getModelCapabilities(model: ReasoningModel) {
    return this.modelCapabilities[model];
  }

  /**
   * List available reasoning models
   */
  getAvailableModels(): ReasoningModel[] {
    return Array.from(this.reasoningModels);
  }

  /**
   * Evaluate the quality and relevance of a thought branch
   */
  private async evaluateThought(request: ReasoningRequest, thought: string): Promise<{ score: number; logic: string }> {
    const evaluationPrompt = REASONING_PROMPTS.evaluateThought(request.query, thought);

    try {
      const config = await systemAiService.getAiConfig('copilot');
      const client = AIClientFactory.getClient({ provider: config?.provider || 'openai' } as any);
      
      const response = await client.execute({
        model: config?.model || 'gpt-4o-mini',
        systemPrompt: 'You are a critical reasoning evaluator. Provide objective scores for internal thoughts.',
        userPrompt: evaluationPrompt,
        responseType: 'json'
      } as any, undefined, config?.apiKey || "");

      if (response.success && response.output) {
        const result = typeof response.output === 'string' ? JSON.parse(response.output) : response.output;
        return {
          score: Math.min(1, Math.max(0, result.score || 0.7)),
          logic: result.logic || 'No feedback'
        };
      }
    } catch (err) {
      logger.warn(`Thought evaluation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    return { score: 0.7, logic: 'Default fallback score' };
  }

  /** Alias for reason() — preserves backward compatibility with callers using .route() */
  async route(request: ReasoningRequest): Promise<ReasoningResult> {
    return this.reason(request);
  }
}

// Singleton instance
export const reasoningRouterService = new ReasoningRouterService();

export default ReasoningRouterService;
