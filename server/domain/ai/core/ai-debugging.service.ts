
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq, and, isNull, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import type { AIProviderMetadata } from "@shared/schema/index.js";
import { aiHealingService } from "@domain/ai/core/ai-healing.service.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("AiDebuggingService");

export const aiDebuggingService = {
    /**
     * Fix Malformed JSON
     */
    async fixJson(context: string, malformedJson: string, orgId: number | null) {
        // Basic Fix first
        const { tryFixJson } = await import('@shared/utils/jsonUtils.js');
        const basicFix = tryFixJson(malformedJson);
        if (basicFix && basicFix.changes.length > 0) {
            return {
                success: true,
                fixedJson: basicFix.fixed,
                explanation: basicFix.changes.join('; '),
                changes: basicFix.changes.map(c => ({ description: c })),
                method: 'basic'
            };
        }

        // AI Fix (using Healing Service)
        try {
            const fixedContent = await aiHealingService.healJson(malformedJson, context);
            if (!fixedContent) {
                throw new Error('AI failed to fix JSON');
            }

            return {
                success: true,
                fixedJson: fixedContent,
                explanation: 'Fixed by AI Healing Service',
                changes: [{ description: 'AI-corrected JSON syntax' }],
                method: 'ai'
            };
        } catch (error: any) {
            logger.error('AI JSON fix error', { error: error.message });
            return { success: false, error: error.message };
        }
    },

    /**
     * Debug CURL Request
     */
    async debugCurl(testResult: any, jobConfig: any, orgId: number | null) {
        const { analyzeError } = await import('@shared/utils/curlDebugger.js');

        let credentialType: string | undefined;
        if (jobConfig.credentialId) {
            const [cred] = await db.select().from(credentials).where(eq(credentials.id, jobConfig.credentialId)).limit(1);
            credentialType = cred?.type;
        }

        const analysis = analyzeError(testResult, jobConfig, credentialType);
        const aiCredential = await this.getAiCredential(orgId);
        let aiExplanation: string | undefined;

        if (aiCredential) {
            const apiKey = (await resolveCredentialSecret(aiCredential));
            if (apiKey) {
                try {
                    const metadata = aiCredential.metadata as AIProviderMetadata | null;
                    const client = AIClientFactory.getClient(metadata || { provider: 'openai' } as any);

                    const errorDetails = JSON.stringify({
                        status: testResult.metadata?.status,
                        url: jobConfig.url,
                        method: jobConfig.method,
                        error: testResult.error || testResult.output,
                    }, null, 2);

                    const prompt = `Analyze this failed API request and explain what went wrong and how to fix it. Be concise.\n\nError Details:\n${errorDetails}\n\nAnalysis Category: ${analysis.category}\nSummary: ${analysis.summary}\n\nProvide a brief diagnosis (2-3 sentences) focused on the specific issue.`;

                    const response = await client.execute({
                        credentialId: aiCredential.id,
                        model: (metadata as any)?.model || 'gpt-4o-mini',
                        userPrompt: prompt,
                        temperature: 0,
                        requestType: 'text',
                        useCache: true,
                        saveOutputToFile: false
                    }, undefined, apiKey);

                    if (response.success && response.output) {
                        aiExplanation = response.output;
                    }
                } catch (error: any) {
                    logger.warn('AI debug diagnosis failed', { error: error.message });
                }
            }
        }

        return {
            analysis: { ...analysis, aiExplanation }
        };
    },

    /**
     * Translate Natural Language to JQL
     */
    async translateToJql(query: string, orgId: number | null) {
        const aiCredential = await this.getAiCredential(orgId);
        if (!aiCredential) {
            return { success: false, error: 'No AI credential configured.' };
        }

        const apiKey = (await resolveCredentialSecret(aiCredential));
        if (!apiKey) {
            return { success: false, error: 'AI API key not found.' };
        }

        try {
            const metadata = aiCredential.metadata as AIProviderMetadata | null;
            const client = AIClientFactory.getClient(metadata || { provider: 'openai' } as any);
            const prompt = `Translate this natural language request into a valid JQL (Jira Query Language) query. 
Return ONLY the JQL string, nothing else. Do not include quotes around the JQL unless they are part of the JQL itself. Do not include any explanation.

Request: "${query}"`;

            const response = await client.execute({
                credentialId: aiCredential.id,
                model: (metadata as any)?.model || 'gpt-4o-mini',
                userPrompt: prompt,
                temperature: 0,
                requestType: 'text',
                useCache: true,
                saveOutputToFile: false
            }, undefined, apiKey);

            if (!response.success || !response.output) {
                throw new Error(response.error || 'AI failed to translate JQL');
            }

            let jql = response.output.trim();
            // Remove wrapping quotes if AI added them
            if (jql.startsWith('"') && jql.endsWith('"')) jql = jql.substring(1, jql.length - 1);
            if (jql.startsWith("'") && jql.endsWith("'")) jql = jql.substring(1, jql.length - 1);

            return {
                success: true,
                jql: jql.trim(),
                explanation: 'Translated by AI'
            };
        } catch (error: any) {
            logger.error('JQL translation error', { error: error.message });
            return { success: false, error: error.message };
        }
    },

    /**
     * Execute Proxy Request (CURL Quick Test)
     */
    async executeProxyRequest(config: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: any;
        queryParams?: Record<string, any>;
        credentialId?: number;
        authType?: string;
    }, orgId: number | null) {
        const startTime = Date.now();
        try {
            let url = config.url;
            if (config.queryParams && typeof config.queryParams === 'object') {
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(config.queryParams)) {
                    if (typeof value === 'string') params.append(key, value as string);
                }
                const queryString = params.toString();
                if (queryString) url += (url.includes('?') ? '&' : '?') + queryString;
            }

            const headers: Record<string, string> = { 'Accept': 'application/json', ...(typeof config.headers === 'object' ? config.headers : {}) };

            if (config.credentialId) {
                // Get credential
                // Note: We access DB directly here to avoid circular dep with credentialsService, matching this service's pattern
                const conditions = [eq(credentials.id, config.credentialId)];
                if (orgId) {
                    conditions.push(or(eq(credentials.organizationId, orgId), isNull(credentials.organizationId)) as any);
                } else {
                    conditions.push(isNull(credentials.organizationId));
                }

                // Allow super admins to see all? OrgContext passed here usually has orgId depending on user view.
                // admin.ts used credentialsService.getById which checks permissions.
                // Here we will enforce org scoping if orgId is provided.

                const [cred] = await db
                    .select()
                    .from(credentials)
                    .where(and(...conditions))
                    .limit(1);

                if (cred) {
                    const apiKey = (await resolveCredentialSecret(cred));
                    if (apiKey) {
                        if (cred.type === 'jira') {
                            const metadata = cred.metadata as { username?: string; baseUrl?: string } | null;
                            if (metadata?.username) {
                                const basicAuth = Buffer.from(`${metadata.username}:${apiKey}`).toString('base64');
                                headers['Authorization'] = `Basic ${basicAuth}`;
                            }
                            if (url.startsWith('/') && metadata?.baseUrl) {
                                url = metadata.baseUrl.replace(/\/$/, '') + url;
                            }
                        } else if (config.authType === 'basic') {
                            headers['Authorization'] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
                        } else {
                            headers['Authorization'] = `Bearer ${apiKey}`;
                        }
                    }
                }
            }

            const fetchOptions: RequestInit = { method: config.method || 'GET', headers };
            if (config.body && config.method !== 'GET' && config.method !== 'HEAD') {
                fetchOptions.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
            }

            const response = await fetch(url, fetchOptions);
            const responseText = await response.text();
            let responseBody: any = responseText;
            try { responseBody = JSON.parse(responseText); } catch { }

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });

            return {
                success: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                body: responseBody,
                timing: { total: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Request failed',
                timing: { total: Date.now() - startTime }
            };
        }
    },

    // --- Helpers ---

    async getAiCredential(orgId: number | null) {
        let aiCredential;
        if (orgId) {
            [aiCredential] = await db.select().from(credentials).where(and(eq(credentials.organizationId, orgId), eq(credentials.type, 'ai_provider'))).limit(1);
        }
        if (!aiCredential) {
            [aiCredential] = await db.select().from(credentials).where(and(isNull(credentials.organizationId), eq(credentials.type, 'ai_provider'))).limit(1);
        }
        return aiCredential;
    },

    cleanJsonBlock(content: string) {
        let cleaned = content.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
        return cleaned.trim();
    }
};


