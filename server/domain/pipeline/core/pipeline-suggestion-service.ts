import { db } from "@server/database_service.js";
import { credentials, jobs, aiUsageLogs, type AIProviderMetadata } from "@shared/schema/index.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

const logger = createLogger("PipelineSuggestionService");

export interface PipelineContext {
    id?: number;
    name?: string;
    steps: Array<{
        id: number;
        jobId: number;
        jobType: string;
        outputName?: string;
        order: number;
    }>;
    description?: string;
}

export interface PipelineSuggestion {
    nodeId?: string;
    nodeType: string;
    jobId?: number;
    confidence: number;
    reason: string;
    suggestedConfiguration?: any;
    estimatedCost?: number;
}

export interface SuggestionResponse {
    suggestions: PipelineSuggestion[];
    context: {
        pipelineStepCount: number;
        lastJobType?: string;
        commonPatterns: string[];
    };
    cost: {
        tokensUsed: number;
        estimatedCost: number;
    };
}

export const pipelineSuggestionService = {
    /**
     * Get AI-powered suggestions for pipeline next steps
     */
    async getSuggestions(
        pipeline: PipelineContext,
        orgId: number | null,
        options: {
            maxSuggestions?: number;
            includeCostEstimate?: boolean;
            suggestionType?: 'next_step' | 'configuration' | 'optimization';
        } = {}
    ): Promise<SuggestionResponse> {
        const startTime = Date.now();
        const maxSuggestions = options.maxSuggestions || 5;

        try {
            // Get available jobs for context
            const availableJobs = await this.getAvailableJobs(orgId);
            const commonPatterns = await this.analyzeCommonPatterns(orgId);

            // Build context for AI
            const context = this.buildAiContext(pipeline, availableJobs, commonPatterns);

            // Get AI configuration
            const aiConfig = await systemAiService.getAiConfig('copilot');
            if (!aiConfig) {
                logger.warn("No AI configuration available for suggestions");
                return {
                    suggestions: [],
                    context: {
                        pipelineStepCount: pipeline.steps.length,
                        commonPatterns
                    },
                    cost: { tokensUsed: 0, estimatedCost: 0 }
                };
            }

            // Generate suggestions using AI
            const suggestions = await this.generateAiSuggestions(
                context,
                aiConfig,
                availableJobs,
                maxSuggestions,
                options.suggestionType
            );

            // Calculate estimated costs if requested
            let estimatedCost = 0;
            if (options.includeCostEstimate) {
                estimatedCost = await this.estimateSuggestionCost(suggestions, aiConfig);
            }

            // Log AI usage
            const tokensUsed = this.estimateTokenUsage(context, suggestions);
            await this.logAiUsage(orgId, tokensUsed, aiConfig, estimatedCost);

            const latency = Date.now() - startTime;
            logger.info("Pipeline suggestions generated", {
                suggestionCount: suggestions.length,
                tokensUsed,
                latency,
                cost: estimatedCost
            });

            return {
                suggestions,
                context: {
                    pipelineStepCount: pipeline.steps.length,
                    lastJobType: pipeline.steps[pipeline.steps.length - 1]?.jobType,
                    commonPatterns
                },
                cost: {
                    tokensUsed,
                    estimatedCost
                }
            };

        } catch (error) {
            logger.error("Error generating pipeline suggestions", { error: (error as Error).message });
            return {
                suggestions: [],
                context: {
                    pipelineStepCount: pipeline.steps.length,
                    commonPatterns: []
                },
                cost: { tokensUsed: 0, estimatedCost: 0 }
            };
        }
    },

    /**
     * Get configuration suggestions for a specific job type
     */
    async getConfigurationSuggestions(
        jobType: string,
        currentConfig: any,
        orgId: number | null
    ): Promise<{
        suggestions: Array<{
            field: string;
            currentValue: any;
            suggestedValue: any;
            reason: string;
            confidence: number;
        }>;
        commonPatterns: string[];
    }> {
        try {
            // Get examples of this job type from existing jobs
            const jobExamples = await db
                .select()
                .from(jobs)
                .where(eq(jobs.type, jobType))
                .limit(10);

            // Analyze common configuration patterns
            const commonPatterns = this.extractCommonConfigurations(jobExamples, currentConfig);

            // Get AI suggestions if available
            const aiConfig = await systemAiService.getAiConfig('copilot');
            if (!aiConfig) {
                return {
                    suggestions: commonPatterns.suggestions,
                    commonPatterns: commonPatterns.patterns
                };
            }

            const context = {
                jobType,
                currentConfig,
                examples: jobExamples.slice(0, 3).map(job => job.config),
                commonPatterns: commonPatterns.patterns
            };

            const aiSuggestions = await this.generateConfigurationSuggestions(context, aiConfig);

            return {
                suggestions: [...commonPatterns.suggestions, ...aiSuggestions],
                commonPatterns: commonPatterns.patterns
            };

        } catch (error) {
            logger.error("Error generating configuration suggestions", { error: error instanceof Error ? error.message : String(error), jobType });
            return {
                suggestions: [],
                commonPatterns: []
            };
        }
    },

    /**
     * Get available jobs for suggestions
     */
    async getAvailableJobs(orgId: number | null): Promise<Array<{ id: number; type: string; name: string; description: string }>> {
        try {
            const jobList = await db
                .select({
                    id: jobs.id,
                    type: jobs.type,
                    name: jobs.name,
                    description: jobs.description
                })
                .from(jobs)
                .where(orgId ? eq(jobs.organizationId, orgId) : undefined)
                .limit(100);

            return jobList.map(job => ({
                ...job,
                description: job.description || ''
            }));
        } catch (error) {
            logger.error("Error fetching available jobs", { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    },

    /**
     * Analyze common pipeline patterns in the organization
     */
    async analyzeCommonPatterns(orgId: number | null): Promise<string[]> {
        try {
            // For now, return static patterns based on job types
            // In the future, this could be enhanced with actual pattern analysis
            return [
                "Data processing workflows often start with data import",
                "AI-powered analysis typically follows data preparation",
                "Error handling is recommended for external API calls",
                "Data transformation is commonly used before AI processing",
                "Export steps are useful for storing results"
            ];
        } catch (error) {
            logger.error("Error analyzing common patterns", { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    },

    /**
     * Build AI context for suggestion generation
     */
    buildAiContext(
        pipeline: PipelineContext,
        availableJobs: Array<{ id: number; type: string; name: string; description: string }>,
        commonPatterns: string[]
    ): string {
        const lastStep = pipeline.steps[pipeline.steps.length - 1];
        const jobTypes = pipeline.steps.map(step => step.jobType).join(', ');

        return `
You are an expert pipeline designer assistant. Analyze the current pipeline and suggest the most logical next steps.

Current Pipeline:
- Name: ${pipeline.name || 'Untitled Pipeline'}
- Description: ${pipeline.description || 'No description'}
- Current Steps (${pipeline.steps.length}): ${jobTypes}
- Last Step Type: ${lastStep?.jobType || 'None'}

Available Job Types:
${availableJobs.map(job => `- ${job.type}: ${job.description || job.name}`).join('\n')}

Common Patterns:
${commonPatterns.map(pattern => `- ${pattern}`).join('\n')}

Instructions:
1. Suggest up to 5 logical next steps based on the current pipeline context
2. Consider data flow, error handling, and common workflow patterns
3. For each suggestion, provide:
   - Job type (must be from available job types)
   - Confidence score (0.0-1.0)
   - Clear reason for the suggestion
   - Basic configuration if applicable

Response Format (JSON):
{
  "suggestions": [
    {
      "nodeType": "job_type_here",
      "confidence": 0.85,
      "reason": "Clear explanation of why this step makes sense",
      "suggestedConfiguration": {
        "basic_field": "suggested_value"
      }
    }
  ]
}
        `.trim();
    },

    /**
     * Generate AI suggestions
     */
    async generateAiSuggestions(
        context: string,
        aiConfig: any,
        availableJobs: Array<{ id: number; type: string; name: string; description: string }>,
        maxSuggestions: number,
        suggestionType: string = 'next_step'
    ): Promise<PipelineSuggestion[]> {
        try {
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            const prompt = suggestionType === 'optimization'
                ? context + "\n\nFocus on optimization opportunities and performance improvements."
                : context;

            const aiClient = AIClientFactory.getClient({
                provider: aiConfig.provider,
                model: aiConfig.model,
                baseUrl: aiConfig.baseUrl
            } as AIProviderMetadata);

            const response = await aiClient.execute(
                {
                    credentialId: 0, // System
                    model: aiConfig.model,
                    temperature: 0.3,
                    maxTokens: 500,
                    userPrompt: prompt,
                    useCache: true,
                    enableQueryExpansion: false,
                    saveOutputToFile: false
                },
                prompt,
                aiConfig.apiKey || ''
            );

            if (!response.success) {
                logger.error("AI suggestion generation failed", { error: response.error });
                return [];
            }

            const aiResponse = JSON.parse(response.output || '{}');
            const suggestions: PipelineSuggestion[] = [];

            if (aiResponse.suggestions && Array.isArray(aiResponse.suggestions)) {
                for (const suggestion of aiResponse.suggestions.slice(0, maxSuggestions)) {
                    // Find matching job
                    const matchingJob = availableJobs.find(job =>
                        job.type.toLowerCase() === suggestion.nodeType.toLowerCase()
                    );

                    suggestions.push({
                        nodeId: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        nodeType: suggestion.nodeType,
                        jobId: matchingJob?.id,
                        confidence: Math.min(Math.max(suggestion.confidence || 0.5, 0), 1),
                        reason: suggestion.reason || 'Suggested based on pipeline analysis',
                        suggestedConfiguration: suggestion.suggestedConfiguration
                    });
                }
            }

            return suggestions;

        } catch (error) {
            logger.error("Error generating AI suggestions", { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    },

    /**
     * Generate configuration suggestions using AI
     */
    async generateConfigurationSuggestions(
        context: any,
        aiConfig: any
    ): Promise<Array<{
        field: string;
        currentValue: any;
        suggestedValue: any;
        reason: string;
        confidence: number;
    }>> {
        try {
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            const prompt = `
Analyze the current job configuration and suggest improvements.

Job Type: ${context.jobType}
Current Configuration: ${JSON.stringify(context.currentConfig, null, 2)}
Examples of similar jobs: ${JSON.stringify(context.examples, null, 2)}

Suggest configuration improvements with reasoning. Format as JSON:
{
  "suggestions": [
    {
      "field": "field_name",
      "currentValue": "current_value",
      "suggestedValue": "suggested_value",
      "reason": "Why this is better",
      "confidence": 0.8
    }
  ]
}
            `.trim();

            const aiClient = AIClientFactory.getClient({
                provider: aiConfig.provider,
                model: aiConfig.model,
                baseUrl: aiConfig.baseUrl
            } as AIProviderMetadata);

            const response = await aiClient.execute(
                {
                    credentialId: 0, // System
                    model: aiConfig.model,
                    temperature: 0.2,
                    maxTokens: 300,
                    userPrompt: prompt,
                    useCache: true,
                    enableQueryExpansion: false,
                    saveOutputToFile: false
                },
                prompt,
                aiConfig.apiKey || ''
            );

            if (!response.success) {
                return [];
            }

            const aiResponse = JSON.parse(response.output || '{}');
            return aiResponse.suggestions || [];

        } catch (error) {
            logger.error("Error generating configuration suggestions", { error: (error as Error).message });
            return [];
        }
    },

    /**
     * Extract common configurations from job examples
     */
    extractCommonConfigurations(
        jobExamples: Array<{ config: any }>,
        currentConfig: any
    ): { suggestions: any[], patterns: string[] } {
        const suggestions: any[] = [];
        const patterns: string[] = [];

        // Simple pattern extraction - can be enhanced with more sophisticated analysis
        const configs = jobExamples.map(job => job.config).filter(Boolean);

        if (configs.length === 0) {
            return { suggestions, patterns };
        }

        // Analyze common field values
        const fieldAnalysis: Record<string, any> = {};

        configs.forEach(config => {
            Object.keys(config).forEach(field => {
                if (!fieldAnalysis[field]) {
                    fieldAnalysis[field] = { values: [], types: new Set() };
                }
                fieldAnalysis[field].values.push(config[field]);
                fieldAnalysis[field].types.add(typeof config[field]);
            });
        });

        // Generate suggestions based on common patterns
        Object.keys(fieldAnalysis).forEach(field => {
            const analysis = fieldAnalysis[field];
            const mostCommon = this.getMostCommonValue(analysis.values);

            if (mostCommon !== null && currentConfig[field] !== mostCommon) {
                suggestions.push({
                    field,
                    currentValue: currentConfig[field],
                    suggestedValue: mostCommon,
                    reason: `This value is used in ${Math.round((analysis.values.filter((v: any) => v === mostCommon).length / analysis.values.length) * 100)}% of similar jobs`,
                    confidence: analysis.values.filter((v: any) => v === mostCommon).length / analysis.values.length
                });
            }
        });

        return { suggestions, patterns };
    },

    /**
     * Get most common value from array
     */
    getMostCommonValue(values: any[]): any {
        if (values.length === 0) return null;

        const frequency: Record<string, number> = {};
        values.forEach((value: any) => {
            const key = JSON.stringify(value);
            frequency[key] = (frequency[key] || 0) + 1;
        });

        let maxCount = 0;
        let mostCommon = null;

        Object.keys(frequency).forEach((key: string) => {
            if (frequency[key] > maxCount) {
                maxCount = frequency[key];
                mostCommon = JSON.parse(key);
            }
        });

        return mostCommon;
    },

    /**
     * Estimate token usage for AI calls
     */
    estimateTokenUsage(context: string, suggestions: PipelineSuggestion[]): number {
        // Rough estimation: 1 token ≈ 4 characters
        const contextTokens = Math.ceil(context.length / 4);
        const responseTokens = Math.ceil(JSON.stringify(suggestions).length / 4);
        return contextTokens + responseTokens;
    },

    /**
     * Estimate cost of suggestions
     */
    async estimateSuggestionCost(suggestions: PipelineSuggestion[], aiConfig: any): Promise<number> {
        // Use cost estimation from system AI service if available
        // For now, return a small fixed cost estimate
        return suggestions.length * 0.001; // $0.001 per suggestion
    },

    /**
     * Log AI usage
     */
    async logAiUsage(
        orgId: number | null,
        tokensUsed: number,
        aiConfig: any,
        estimatedCost: number
    ): Promise<void> {
        try {
            if (!orgId) return;

            await db.insert(aiUsageLogs).values({
                organizationId: orgId,
                provider: aiConfig.provider,
                model: aiConfig.model,
                totalTokens: tokensUsed,
                costUsd: estimatedCost.toString(),
                createdAt: new Date()
            });

        } catch (error) {
            logger.error("Error logging AI usage", { error: error instanceof Error ? error.message : String(error) });
        }
    }
};


