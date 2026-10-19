
import { GraphSchemaDef } from "@shared/schema/index.js";
import { AIClientFactory, AIResponse } from "@domain/ai/core/ai-client.service.js";

interface SchemaMapping {
    id: string;
    source_key: string;
    is_active: boolean;
    node_label: string;
    relationship: string;
    extraction_type: "regex" | "ai";
    config: {
        regex?: string;
        prompt?: string;
    }
}

export interface ExtractedEntity {
    value: string;
    nodeLabel: string;
    relationship: string;
    source: string;
    confidence: number;
}

export class KnowledgeExtractor {

    async extract(text: string, schema: GraphSchemaDef): Promise<ExtractedEntity[]> {
        const mappings = schema.mappings as SchemaMapping[];
        const results: ExtractedEntity[] = [];

        if (!text || !mappings) return [];

        if (!text || !mappings) return [];

        if (!Array.isArray(mappings)) {
            console.warn("[Extractor] Mappings is not an array:", mappings);
            return [];
        }

        for (const map of mappings) {
            if (!map.is_active) continue;

            try {
                if (map.extraction_type === 'regex' && map.config.regex) {
                    const matches = this.runRegex(text, map.config.regex);
                    matches.forEach(m => results.push({
                        value: m,
                        nodeLabel: map.node_label,
                        relationship: map.relationship,
                        source: `regex:${map.source_key}`,
                        confidence: 1.0
                    }));
                } else if (map.extraction_type === 'ai' && map.config.prompt) {
                    const values = await this.runAI(text, map.config.prompt);
                    values.forEach(val => results.push({
                        value: val,
                        nodeLabel: map.node_label,
                        relationship: map.relationship,
                        source: `ai:${map.source_key}`,
                        confidence: 0.8
                    }));
                }
            } catch (e) {
                console.error(`[KnowledgeExtractor] Error running rule ${map.source_key}:`, e);
            }
        }
        return results;
    }

    private runRegex(text: string, pattern: string): string[] {
        try {
            const re = new RegExp(pattern, 'g');
            const matches = [...text.matchAll(re)];
            // Prefer capturing group 1, else match 0
            return matches.map(m => m[1] || m[0]);
        } catch (e) {
            console.error("Invalid regex:", pattern);
            return [];
        }
    }

    private async runAI(text: string, promptTemplate: string): Promise<string[]> {
        const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
        const aiConfig = await systemAiService.getAiConfig('extraction' as any);

        if (!aiConfig || !aiConfig.apiKey) {
            console.warn("[KnowledgeExtractor] No AI config found for extraction");
            return [];
        }

        // We explicitly format the prompt to request JSON object
        const prompt = `${promptTemplate}\n\nInput Text:\n"${text.substring(0, 10000)}"\n\nReturn a JSON object with a single key 'results' containing an array of strings, e.g. {"results": ["Item A", "Item B"]}. No markdown.`;

        // Manually construct a config compatible with AIClientFactory
        const config: any = {
            provider: aiConfig.provider,
            model: aiConfig.model || 'mistral:latest',
            response_format: { type: 'json_object' },
            temperature: 0.1,
            userPrompt: prompt
        };

        try {
            const client = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);
            const response: AIResponse = await client.execute(config, undefined, aiConfig.apiKey);

            if (response.success && response.output) {
                try {
                    // Sanitize potential markdown block
                    let cleaned = response.output.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleaned);
                    if (Array.isArray(parsed)) {
                        return parsed.map(s => String(s));
                    } else if (parsed && Array.isArray(parsed.results)) {
                        return parsed.results.map((s: any) => String(s));
                    }
                } catch (parseErr) {
                    console.warn("[KnowledgeExtractor] AI returned invalid JSON:", response.output);
                }
            }
        } catch (err) {
            console.error("[KnowledgeExtractor] AI Client Failed:", err);
        }
        return [];
    }
}


