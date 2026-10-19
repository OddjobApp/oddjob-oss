import { systemAiService } from '@domain/ai/core/system-ai.service.js';
import { AIClientFactory } from '@domain/ai/core/ai-client.service.js';
import { AgentPersonaService } from '@domain/agents/agent-persona.service.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger("UiGenerationService");

export class UiGenerationService {
  /**
   * Generates a React UI from an OpenAPI specification using the UI Specialist agent.
   *
   * @param openApiSpec The OpenAPI specification as a JSON object.
   * @param organizationId The ID of the organization, for AI configuration purposes.
   * @returns The generated React code as a string.
   */
  static async generateUiFromSpec(
    openApiSpec: Record<string, any>,
    themeColor: string,
    organizationId: number
  ): Promise<{ app_tsx: string; theme_css: string }> {
    logger.info('Invoking UI Specialist to generate UI with theme...');

    const persona = 'ui_specialist';
    const aiConfig = await systemAiService.getAiConfig(persona as any, organizationId);
    if (!aiConfig) {
      logger.error(`AI Configuration (${persona}) not found for organization ${organizationId}`);
      throw new Error(`AI Configuration (${persona}) not found`);
    }

    const aiClient = AIClientFactory.getClient(aiConfig as any);
    const systemPrompt = AgentPersonaService.augmentSystemPrompt(persona);
    const userPrompt = JSON.stringify({ openApiSpec, themeColor });

    const result = await aiClient.execute(
      {
        model: aiConfig.model,
        systemPrompt,
        userPrompt,
        requestType: 'json',
        responseType: 'json', // We now expect a JSON object
        maxTokens: 4096,
      } as any,
      undefined,
      aiConfig.apiKey ?? ''
    );

    if (!result.success || !result.output) {
      logger.error('UI Specialist agent failed', { error: result.error });
      throw new Error(`UI Specialist agent failed: ${result.error ?? 'no output'}`);
    }

    logger.info('UI generation complete.');

    // The output should be a JSON object with app_tsx and theme_css keys.
    return (result.output as unknown) as { app_tsx: string; theme_css: string };
  }
}
