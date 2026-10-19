
import { createLogger } from '@server/utils/logger.js';
import { systemAiService } from '@domain/ai/core/system-ai.service.js';
import { AIClientFactory } from '@domain/ai/core/ai-client.service.js';
import { AgentPersonaService } from '../agent-persona.service.js';

const logger = createLogger("ThreatAnalysisService");

interface ThreatAnalysisInput {
    httpStatus?: number;
    loadTimeMs?: number;
    captchaPresent?: boolean;
    urlChanged?: boolean;
}

interface ThreatAnalysisResult {
    threatScore: number;
    reasoning: string;
}

class ThreatAnalysisService {
    public async analyze(input: ThreatAnalysisInput, organizationId?: number): Promise<ThreatAnalysisResult> {
        const aiConfig = await systemAiService.getAiConfig('threat_detector', organizationId);
        if (!aiConfig) throw new Error("AI Configuration (threat_detector) not found");

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const prompt = `Analyze the following action outcome and provide a threat score:\n\n${JSON.stringify(input, null, 2)}`;

        const result = await aiClient.execute({
            systemPrompt: AgentPersonaService.augmentSystemPrompt('threat_detector' as any),
            userPrompt: prompt,
            requestType: 'json',
            model: aiConfig.model,
            temperature: 0,
            useCache: false,
            saveOutputToFile: false
        }, prompt, aiConfig.apiKey || "");

        if (!result.success) {
            logger.error("Threat detector AI call failed", { error: result.error });
            return { threatScore: 0, reasoning: "AI analysis failed." };
        }

        try {
            const analysis = JSON.parse(result.output || "{}");
            analysis.threatScore = parseInt(analysis.threatScore, 10);
            return analysis;
        } catch (error) {
            logger.error("Failed to parse JSON response from Threat Detector agent", { error, response: result.output });
            return { threatScore: 0, reasoning: "Failed to analyze threat due to parsing error." };
        }
    }
}

export const threatAnalysisService = new ThreatAnalysisService();
