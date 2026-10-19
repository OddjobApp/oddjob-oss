/**
 * Critique Engine
 * 
 * LLM-powered critique system for evaluating agent actions
 * against constitutional principles.
 */

import {
  AgentAction,
  AgentContext,
  ConstitutionalPrinciple,
  ConstitutionalCheck,
  CritiquePromptTemplate,
  AutoCorrectionResult,
  ConstitutionalAIError,
  ConstitutionalAIErrorType
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createLogger('CritiqueEngine');

/**
 * LLM Client Interface
 */
interface LLMClient {
  generateStructured<T>(params: {
    prompt: string;
    schema: object;
    temperature?: number;
    maxTokens?: number;
  }): Promise<T>;
}

/**
 * Critique Engine
 */
export class CritiqueEngine {
  private defaultTemplate: CritiquePromptTemplate;

  constructor(
    private llmClient: LLMClient,
    private config: {
      model: string;
      temperature: number;
      timeoutMs: number;
    }
  ) {
    this.defaultTemplate = this.createDefaultTemplate();
  }

  /**
   * Critique an action against a principle
   */
  async critiqueAction(
    action: AgentAction,
    principle: ConstitutionalPrinciple,
    context: AgentContext
  ): Promise<ConstitutionalCheck> {
    const startTime = Date.now();
    const checkId = randomUUID();

    logger.debug(`[${checkId}] Critiquing action ${action.id} against principle ${principle.id}`);

    try {
      // Build critique prompt
      const prompt = this.buildCritiquePrompt(action, principle, context);

      // Generate critique using LLM
      const critiqueResult = await this.generateCritique(prompt);

      // Build check result
      const check: ConstitutionalCheck = {
        principle,
        action,
        critique: critiqueResult.critique,
        compliant: critiqueResult.compliant,
        confidence: critiqueResult.confidence,
        suggestions: critiqueResult.suggestions,
        checkedAt: new Date(),
        reviewTimeMs: Date.now() - startTime
      };

      // Auto-correct if applicable
      if (!check.compliant && 
          principle.autoCorrect && 
          critiqueResult.confidence >= 0.8) {
        logger.info(`[${checkId}] Attempting auto-correction for principle ${principle.id}`);
        
        const correction = await this.attemptAutoCorrection(
          action,
          principle,
          critiqueResult,
          context
        );

        if (correction.success && correction.correctedAction) {
          check.revisedAction = correction.correctedAction;
          logger.info(`[${checkId}] Auto-correction successful`);
        }
      }

      logger.debug(`[${checkId}] Critique completed: ${check.compliant ? 'compliant' : 'non-compliant'} (${check.confidence.toFixed(2)})`);

      return check;

    } catch (error) {
      logger.error(`[${checkId}] Critique failed:`, error);
      
      return {
        principle,
        action,
        critique: `Critique generation failed: ${(error as Error).message}`,
        compliant: false,  // Fail-safe: assume non-compliant if critique fails
        confidence: 0,
        checkedAt: new Date(),
        reviewTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Critique action against multiple principles
   */
  async critiqueAgainstPrinciples(
    action: AgentAction,
    principles: ConstitutionalPrinciple[],
    context: AgentContext,
    parallel: boolean = true
  ): Promise<ConstitutionalCheck[]> {
    if (parallel) {
      // Run all critiques in parallel
      const checkPromises = principles.map(p => 
        this.critiqueAction(action, p, context)
      );
      return Promise.all(checkPromises);
    } else {
      // Run sequentially
      const checks: ConstitutionalCheck[] = [];
      for (const principle of principles) {
        const check = await this.critiqueAction(action, principle, context);
        checks.push(check);
        
        // Early exit on critical violations
        if (!check.compliant && check.principle.severity === 'critical') {
          logger.warn(`Critical violation detected, stopping further checks`);
          break;
        }
      }
      return checks;
    }
  }

  /**
   * Attempt to auto-correct a violating action
   */
  private async attemptAutoCorrection(
    action: AgentAction,
    principle: ConstitutionalPrinciple,
    critiqueResult: any,
    context: AgentContext
  ): Promise<AutoCorrectionResult> {
    const correctionPrompt = this.buildCorrectionPrompt(
      action,
      principle,
      critiqueResult,
      context
    );

    try {
      const correction = await this.llmClient.generateStructured<{
        correctedAction: AgentAction;
        explanation: string;
        confidence: number;
      }>({
        prompt: correctionPrompt,
        schema: {
          type: 'object',
          properties: {
            correctedAction: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                description: { type: 'string' },
                parameters: { type: 'object' }
              }
            },
            explanation: { type: 'string' },
            confidence: { type: 'number' }
          }
        },
        temperature: 0.3,
        maxTokens: 1000
      });

      return {
        success: correction.confidence >= 0.8,
        correctedAction: correction.correctedAction,
        explanation: correction.explanation,
        confidence: correction.confidence,
        attempts: 1
      };

    } catch (error) {
      logger.error('Auto-correction failed:', error);
      return {
        success: false,
        confidence: 0,
        attempts: 1
      };
    }
  }

  /**
   * Generate critique using LLM
   */
  private async generateCritique(prompt: string): Promise<{
    compliant: boolean;
    confidence: number;
    critique: string;
    suggestions?: string[];
  }> {
    return this.llmClient.generateStructured({
      prompt,
      schema: {
        type: 'object',
        properties: {
          compliant: { type: 'boolean' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          critique: { type: 'string' },
          suggestions: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['compliant', 'confidence', 'critique']
      },
      temperature: this.config.temperature,
      maxTokens: 800
    });
  }

  /**
   * Build critique prompt
   */
  private buildCritiquePrompt(
    action: AgentAction,
    principle: ConstitutionalPrinciple,
    context: AgentContext
  ): string {
    return `
You are a Constitutional AI reviewer. Your task is to evaluate whether an agent action complies with a constitutional principle.

## CONSTITUTIONAL PRINCIPLE

**Name**: ${principle.name}
**ID**: ${principle.id}
**Category**: ${principle.category}
**Severity**: ${principle.severity}
**Description**: ${principle.description}

**Rule**: ${principle.rule}

## AGENT ACTION

**Action ID**: ${action.id}
**Type**: ${action.type}
**Description**: ${action.description}

**Parameters**:
\`\`\`json
${JSON.stringify(action.parameters, null, 2)}
\`\`\`

**Expected Outcome**: ${action.expectedOutcome || 'Not specified'}

## AGENT CONTEXT

**Agent**: ${context.agentName} (${action.agentId})
**Mission**: ${context.missionDescription || 'Not specified'}
**Risk Level**: ${context.riskLevel}
**Involves PII**: ${context.involvesPII ? 'Yes' : 'No'}
**External Exposure**: ${context.exposesExternally ? 'Yes' : 'No'}

**Action History**: ${context.actionHistory.length} previous actions

## EXAMPLES

**Compliant Examples**:
${principle.examples.compliant.map(e => `- ${e}`).join('\n')}

**Violating Examples**:
${principle.examples.violating.map(e => `- ${e}`).join('\n')}

## YOUR TASK

Evaluate the agent action against the constitutional principle:

1. **Compliant**: Is the action compliant? (true/false)
2. **Confidence**: How confident are you in this assessment? (0.0 - 1.0)
3. **Critique**: Provide a detailed explanation of your evaluation
4. **Suggestions**: If non-compliant, suggest how to fix the violation

Consider:
- The literal text of the rule
- The intent and spirit of the principle
- The specific context of this action
- Potential edge cases or ambiguities

Respond with a structured JSON object.
`;
  }

  /**
   * Build correction prompt
   */
  private buildCorrectionPrompt(
    action: AgentAction,
    principle: ConstitutionalPrinciple,
    critiqueResult: any,
    context: AgentContext
  ): string {
    return `
You are a Constitutional AI corrector. Your task is to revise a non-compliant action to make it compliant with a constitutional principle.

## CONSTITUTIONAL PRINCIPLE

**Name**: ${principle.name}
**Rule**: ${principle.rule}

## ORIGINAL ACTION

**Type**: ${action.type}
**Description**: ${action.description}

**Parameters**:
\`\`\`json
${JSON.stringify(action.parameters, null, 2)}
\`\`\`

## VIOLATION CRITIQUE

${critiqueResult.critique}

## YOUR TASK

Create a corrected version of this action that:
1. Achieves the same or similar goal
2. Fully complies with the constitutional principle
3. Is safe and appropriate

Provide:
- **correctedAction**: The revised action object
- **explanation**: Why this correction addresses the violation
- **confidence**: Your confidence in this correction (0.0 - 1.0)

The corrected action should be a valid AgentAction with id, type, description, and parameters.
`;
  }

  /**
   * Create default critique template
   */
  private createDefaultTemplate(): CritiquePromptTemplate {
    return {
      id: 'default',
      name: 'Default Critique Template',
      systemPrompt: `You are a Constitutional AI safety reviewer. Your role is to evaluate agent actions against constitutional principles to ensure safety, compliance, and ethical behavior. Be thorough but fair in your assessments.`,
      userPromptTemplate: this.buildCritiquePrompt.toString(),
      outputSchema: {
        type: 'object',
        properties: {
          compliant: { type: 'boolean' },
          confidence: { type: 'number' },
          critique: { type: 'string' },
          suggestions: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['compliant', 'confidence', 'critique']
      }
    };
  }

  /**
   * Batch critique multiple actions
   */
  async critiqueBatch(
    actions: Array<{
      action: AgentAction;
      principle: ConstitutionalPrinciple;
      context: AgentContext;
    }>
  ): Promise<ConstitutionalCheck[]> {
    logger.info(`Processing batch of ${actions.length} critique requests`);
    
    const checks = await Promise.all(
      actions.map(({ action, principle, context }) =>
        this.critiqueAction(action, principle, context)
      )
    );

    const violations = checks.filter(c => !c.compliant).length;
    logger.info(`Batch complete: ${violations}/${actions.length} violations detected`);

    return checks;
  }
}
