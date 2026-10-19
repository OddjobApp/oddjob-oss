import { db } from "@server/database_service.js";
import { 
    saasIntegrations, 
    integrationEvents, 
    integrationTemplates 
} from "@shared/schema/index.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("IntegrationEcosystem");

export interface SaaSIntegration {
    id: number;
    name: string;
    platform: string;
    type: string;
    config: any;
    organizationId: number | null;
    isActive: boolean | null;
    lastSync: Date | null;
    syncFrequency: number | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface IntegrationTemplate {
    id: number;
    name: string;
    platform: string;
    description: string | null;
    category: string;
    configSchema: any;
    webhookEndpoints: any;
    isPublic: boolean | null;
    usageCount: number | null;
    rating: number | null;
    tags: any;
}

export interface IntegrationEvent {
    id: number;
    integrationId: number | null;
    eventType: string;
    payload: any;
    status: string;
    errorMessage: string | null;
    retryCount: number | null;
    createdAt: Date;
    processedAt: Date | null;
}

export class IntegrationEcosystemService {
    /**
     * Get all integrations for an organization
     */
    static async getIntegrations(organizationId: number): Promise<SaaSIntegration[]> {
        const result = await db.select().from(saasIntegrations)
            .where(eq(saasIntegrations.organizationId, organizationId))
            .orderBy(desc(saasIntegrations.createdAt));
        return result as SaaSIntegration[];
    }
    
    /**
     * Create a new SaaS integration
     */
    static async createIntegration(data: {
        name: string;
        platform: string;
        type: string;
        config: Record<string, any>;
        organizationId: number;
        createdBy: string;
    }): Promise<SaaSIntegration> {
        logger.info(`[Integration] Creating ${data.platform} integration: ${data.name}`);
        
        const [integration] = await db.insert(saasIntegrations).values({
            name: data.name,
            platform: data.platform,
            type: data.type,
            config: data.config,
            organizationId: data.organizationId,
            isActive: true,
            lastSync: new Date(),
            syncFrequency: data.config.syncFrequency || 60,
            createdBy: data.createdBy
        }).returning();
        
        // Initialize integration
        await this.initializeIntegration(integration as SaaSIntegration);
        
        return integration as SaaSIntegration;
    }
    
    /**
     * Initialize integration based on platform
     */
    static async initializeIntegration(integration: SaaSIntegration): Promise<void> {
        switch (integration.platform) {
            case 'slack':
                await this.initializeSlackIntegration(integration);
                break;
            case 'microsoft-teams':
                await this.initializeTeamsIntegration(integration);
                break;
            case 'jira':
                await this.initializeJiraIntegration(integration);
                break;
            case 'confluence':
                await this.initializeConfluenceIntegration(integration);
                break;
            case 'github':
                await this.initializeGithubIntegration(integration);
                break;
            default:
                logger.warn(`[Integration] Unsupported platform: ${integration.platform}`);
        }
    }
    
    /**
     * Initialize Slack integration
     */
    static async initializeSlackIntegration(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        if (!config.webhookUrl) {
            throw new Error("Slack webhook URL is required");
        }
        
        try {
            const response = await fetch(config.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `🚀 Oddjob integration initialized for ${integration.name}`,
                    username: 'Oddjob Bot'
                })
            });
            
            if (!response.ok) {
                throw new Error(`Slack webhook test failed: ${response.statusText}`);
            }
            
            logger.info(`[Integration] Slack integration ${integration.id} initialized successfully`);
        } catch (error) {
            logger.error(`[Integration] Slack initialization failed: ${error}`);
            throw error;
        }
    }
    
    /**
     * Initialize Microsoft Teams integration
     */
    static async initializeTeamsIntegration(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        if (!config.webhookUrl) {
            throw new Error("Teams webhook URL is required");
        }
        
        try {
            const response = await fetch(config.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Oddjob Integration',
                    text: `🚀 Integration initialized for ${integration.name}`,
                    themeColor: '00FF00'
                })
            });
            
            if (!response.ok) {
                throw new Error(`Teams webhook test failed: ${response.statusText}`);
            }
            
            logger.info(`[Integration] Teams integration ${integration.id} initialized successfully`);
        } catch (error) {
            logger.error(`[Integration] Teams initialization failed: ${error}`);
            throw error;
        }
    }
    
    /**
     * Initialize Jira integration
     */
    static async initializeJiraIntegration(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        if (!config.endpoint || !config.account || !config.apiKey) {
            throw new Error("Jira Endpoint, Account, and API Key are required");
        }
        
        try {
            const response = await fetch(`${config.endpoint}/rest/api/3/myself`, {
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${config.account}:${config.apiKey}`).toString('base64')}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Jira API test failed: ${response.statusText}`);
            }
            
            logger.info(`[Integration] Jira integration ${integration.id} initialized successfully`);
        } catch (error) {
            logger.error(`[Integration] Jira initialization failed: ${error}`);
            throw error;
        }
    }
    
    /**
     * Initialize Confluence integration
     */
    static async initializeConfluenceIntegration(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        if (!config.endpoint || !config.account || !config.apiKey) {
            throw new Error("Confluence Endpoint, Account, and API Key are required");
        }
        
        try {
            const response = await fetch(`${config.endpoint}/wiki/rest/api/user/current`, {
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${config.account}:${config.apiKey}`).toString('base64')}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Confluence API test failed: ${response.statusText}`);
            }
            
            logger.info(`[Integration] Confluence integration ${integration.id} initialized successfully`);
        } catch (error) {
            logger.error(`[Integration] Confluence initialization failed: ${error}`);
            throw error;
        }
    }
    
    /**
     * Initialize GitHub integration
     */
    static async initializeGithubIntegration(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        if (!config.accessToken) {
            throw new Error("GitHub access token is required");
        }
        
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${config.accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`GitHub API test failed: ${response.statusText}`);
            }
            
            logger.info(`[Integration] GitHub integration ${integration.id} initialized successfully`);
        } catch (error) {
            logger.error(`[Integration] GitHub initialization failed: ${error}`);
            throw error;
        }
    }
    
    /**
     * Send notification to integrated platform (Legacy Webhook)
     */
    static async sendNotification(integrationId: number, message: {
        title: string;
        content: string;
        severity?: 'info' | 'warning' | 'error';
        metadata?: Record<string, any>;
    }): Promise<void> {
        const [integration] = await db.select().from(saasIntegrations)
            .where(eq(saasIntegrations.id, integrationId))
            .limit(1);
        
        if (!integration || !integration.isActive) {
            logger.warn(`[Integration] Integration ${integrationId} not found or inactive`);
            return;
        }
        
        try {
            switch (integration.platform) {
                case 'slack':
                    await this.sendSlackNotification(integration as SaaSIntegration, message);
                    break;
                case 'microsoft-teams':
                    await this.sendTeamsNotification(integration as SaaSIntegration, message);
                    break;
                case 'jira':
                    await this.createJiraIssue(integration as SaaSIntegration, message);
                    break;
                case 'confluence':
                    await this.createConfluencePage(integration as SaaSIntegration, message);
                    break;
                case 'github':
                    await this.createGithubIssue(integration as SaaSIntegration, message);
                    break;
            }
            
            await db.insert(integrationEvents).values({
                integrationId,
                eventType: 'notification_sent',
                payload: message,
                status: 'completed',
                processedAt: new Date()
            });
        } catch (error) {
            logger.error(`[Integration] Failed to send notification via ${integration.platform}: ${error}`);
            
            await db.insert(integrationEvents).values({
                integrationId,
                eventType: 'notification_sent',
                payload: message,
                status: 'failed',
                errorMessage: String(error),
                retryCount: 0
            });
        }
    }

    /**
     * MCP (Model Context Protocol) Stakeholder Agent Dispatch
     * Replaces raw webhook notifications with active, bidirectional AI agents
     * capable of grounding responses in Cycle Synthesis memory.
     */
    static async dispatchMcpStakeholderAgent(integrationId: number, cycleId: number, eventContext: any): Promise<void> {
        const [integration] = await db.select().from(saasIntegrations)
            .where(eq(saasIntegrations.id, integrationId))
            .limit(1);
            
        if (!integration || !integration.isActive) return;

        logger.info(`[Integration] Dispatching MCP Stakeholder Agent for Cycle ${cycleId} via ${integration.platform}`);

        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            
            // Generate the contextualized stakeholder message
            const prompt = `
                You are the ODDJOB MCP Stakeholder Agent acting as an active liaison for Cycle #${cycleId}.
                Your task is to craft a highly contextual message to be posted to the external platform: ${integration.platform}.
                
                Event Context: ${JSON.stringify(eventContext)}
                
                Generate a concise, professional message summarizing the event and requesting necessary stakeholder input if needed.
                Do not include raw JSON dumps. Use markdown appropriate for ${integration.platform}.
            `;

            const message = await systemAiService.generateText(prompt, { serviceKey: 'copilot' });
            if (!message) throw new Error("MCP Agent failed to synthesize a message");

            // Dispatch via the platform-specific API
            await this.sendNotification(integrationId, {
                title: "Stakeholder Update",
                content: message,
                severity: 'info',
                metadata: { cycleId, eventType: 'mcp_dispatch' }
            });

            // Log the MCP interaction
            await db.insert(integrationEvents).values({
                integrationId,
                eventType: 'mcp_stakeholder_interaction',
                payload: { cycleId, eventContext, generatedMessage: message },
                status: 'completed',
                processedAt: new Date()
            });

        } catch (err: any) {
            logger.error(`[Integration] MCP Stakeholder Agent dispatch failed: ${err.message}`);
        }
    }
    
    /**
     * Send Slack notification
     */
    static async sendSlackNotification(integration: SaaSIntegration, message: any): Promise<void> {
        const config = integration.config as any;
        
        const payload = {
            text: message.title,
            attachments: [{
                color: message.severity === 'error' ? 'danger' : 
                        message.severity === 'warning' ? 'warning' : 'good',
                text: message.content,
                fields: message.metadata ? Object.entries(message.metadata).map(([key, value]) => ({
                    title: key,
                    value: String(value),
                    short: true
                })) : []
            }]
        };
        
        const response = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`Slack notification failed: ${response.statusText}`);
        }
    }
    
    /**
     * Send Teams notification
     */
    static async sendTeamsNotification(integration: SaaSIntegration, message: any): Promise<void> {
        const config = integration.config as any;
        
        const payload = {
            title: message.title,
            text: message.content,
            themeColor: message.severity === 'error' ? 'FF0000' : 
                        message.severity === 'warning' ? 'FFFF00' : '00FF00',
            potentialAction: (message.metadata as any)?.url ? [{
                '@type': 'OpenUri',
                name: 'View Details',
                targets: [{ os: 'default', uri: (message.metadata as any).url }]
            }] : []
        };
        
        const response = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`Teams notification failed: ${response.statusText}`);
        }
    }
    
    /**
     * Create Jira issue
     */
    static async createJiraIssue(integration: SaaSIntegration, message: any): Promise<void> {
        const config = integration.config as any;
        
        const issueData = {
            fields: {
                project: { key: config.projectKey },
                summary: message.title,
                description: message.content,
                issuetype: { name: config.issueType || 'Task' },
                priority: { name: message.severity === 'error' ? 'Highest' : 
                               message.severity === 'warning' ? 'High' : 'Medium' }
            }
        };
        
        const response = await fetch(`${config.endpoint}/rest/api/3/issue`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${config.account}:${config.apiKey}`).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(issueData)
        });
        
        if (!response.ok) {
            throw new Error(`Jira issue creation failed: ${response.statusText}`);
        }
    }
    
    /**
     * Create Confluence page
     */
    static async createConfluencePage(integration: SaaSIntegration, message: any): Promise<void> {
        const config = integration.config as any;
        
        const pageData = {
            type: 'page',
            title: message.title,
            space: { key: config.spaceKey || 'ENG' },
            body: {
                storage: {
                    value: `<p>${message.content}</p>`,
                    representation: 'storage'
                }
            }
        };
        
        const response = await fetch(`${config.endpoint}/wiki/rest/api/content`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${config.account}:${config.apiKey}`).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(pageData)
        });
        
        if (!response.ok) {
            throw new Error(`Confluence page creation failed: ${response.statusText}`);
        }
    }
    
    /**
     * Create GitHub issue
     */
    static async createGithubIssue(integration: SaaSIntegration, message: any): Promise<void> {
        const config = integration.config as any;
        
        const issueData = {
            title: message.title,
            body: message.content,
            labels: (message.metadata as any)?.labels || []
        };
        
        const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${config.accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(issueData)
        });
        
        if (!response.ok) {
            throw new Error(`GitHub issue creation failed: ${response.statusText}`);
        }
    }
    
    /**
     * Get integration templates
     */
    static async getIntegrationTemplates(): Promise<IntegrationTemplate[]> {
        const result = await db.select().from(integrationTemplates).orderBy(desc(integrationTemplates.usageCount));
        return result as IntegrationTemplate[];
    }
    
    /**
     * Get integration events
     */
    static async getIntegrationEvents(integrationId: number, limit: number = 50): Promise<IntegrationEvent[]> {
        const result = await db.select().from(integrationEvents)
            .where(eq(integrationEvents.integrationId, integrationId))
            .orderBy(desc(integrationEvents.createdAt))
            .limit(limit);
        return result as IntegrationEvent[];
    }
    
    /**
     * Retry failed integration events
     */
    static async retryFailedEvents(integrationId: number): Promise<void> {
        const failedEvents = await db.select().from(integrationEvents)
            .where(and(
                eq(integrationEvents.integrationId, integrationId),
                eq(integrationEvents.status, 'failed'),
                sql`${integrationEvents.retryCount} < 3`
            ))
            .orderBy(integrationEvents.createdAt);
        
        for (const event of failedEvents) {
            try {
                const [integration] = await db.select().from(saasIntegrations)
                    .where(eq(saasIntegrations.id, integrationId))
                    .limit(1);
                
                if (integration && integration.isActive) {
                    await this.sendNotification(integrationId, event.payload as any);
                    
                    await db.update(integrationEvents)
                        .set({ 
                            status: 'completed',
                            retryCount: (event.retryCount || 0) + 1,
                            processedAt: new Date()
                        })
                        .where(eq(integrationEvents.id, event.id));
                }
            } catch (error) {
                logger.error(`[Integration] Retry failed for event ${event.id}: ${error}`);
                
                await db.update(integrationEvents)
                    .set({ retryCount: (event.retryCount || 0) + 1 })
                    .where(eq(integrationEvents.id, event.id));
            }
        }
    }
    
    /**
     * Sync data from external platform
     */
    static async syncExternalData(integrationId: number): Promise<void> {
        const [integration] = await db.select().from(saasIntegrations)
            .where(eq(saasIntegrations.id, integrationId))
            .limit(1);
        
        if (!integration || !integration.isActive) {
            return;
        }
        
        try {
            switch (integration.platform) {
                case 'jira':
                    await this.syncJiraData(integration as SaaSIntegration);
                    break;
                case 'github':
                    await this.syncGithubData(integration as SaaSIntegration);
                    break;
            }
            
            await db.update(saasIntegrations)
                .set({ lastSync: new Date() })
                .where(eq(saasIntegrations.id, integrationId));
        } catch (error) {
            logger.error(`[Integration] Sync failed for ${integration.platform}: ${error}`);
        }
    }
    
    /**
     * Sync Jira data
     */
    static async syncJiraData(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        
        const response = await fetch(`${config.apiUrl}/rest/api/3/search?jql=project=${config.projectKey}`, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${config.username}:${config.apiToken}`).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Jira sync failed: ${response.statusText}`);
        }
        
        const data: any = await response.json();
        logger.info(`[Integration] Synced ${data.issues?.length || 0} issues from Jira`);
    }
    
    /**
     * Sync GitHub data
     */
    static async syncGithubData(integration: SaaSIntegration): Promise<void> {
        const config = integration.config as any;
        
        const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
            headers: {
                'Authorization': `token ${config.accessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`GitHub sync failed: ${response.statusText}`);
        }
        
        const issues: any = await response.json();
        logger.info(`[Integration] Synced ${issues?.length || 0} issues from GitHub`);
    }
}
