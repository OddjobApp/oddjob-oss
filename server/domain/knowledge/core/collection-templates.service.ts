/**
 * Collection Templates Service
 * Pre-built templates for common collection patterns
 */

import type { Job } from "@shared/schema/index.js";

export interface CollectionTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    defaultAgents: Partial<Job>[];
    defaultConfig?: {
        governorEnabled?: boolean;
        governorMode?: 'ADVISORY' | 'AUTONOMOUS';
    };
}

export const COLLECTION_TEMPLATES: CollectionTemplate[] = [
    {
        id: "data-pipeline",
        name: "Data Pipeline",
        description: "Extract, transform, and load data through a multi-stage pipeline",
        icon: "Database",
        category: "Data Processing",
        defaultAgents: [
            {
                name: "Data Extractor",
                description: "Extract raw data from source systems",
                type: "data_extraction",
                config: {
                    tool: "http_request",
                    retryPolicy: { maxRetries: 3, backoff: "exponential" },
                },
            },
            {
                name: "Data Transformer",
                description: "Clean, validate, and transform extracted data",
                type: "data_transformation",
                config: {
                    tool: "python",
                    retryPolicy: { maxRetries: 2, backoff: "linear" },
                },
            },
            {
                name: "Data Loader",
                description: "Load transformed data to target destination",
                type: "data_loading",
                config: {
                    tool: "database",
                    retryPolicy: { maxRetries: 3, backoff: "exponential" },
                },
            },
        ],
        defaultConfig: {
            governorEnabled: true,
            governorMode: "ADVISORY",
        },
    },
    {
        id: "customer-support",
        name: "Customer Support",
        description: "Classify, route, and respond to customer inquiries",
        icon: "Headphones",
        category: "Customer Service",
        defaultAgents: [
            {
                name: "Ticket Classifier",
                description: "Classify incoming support tickets by type and priority",
                type: "classification",
                config: {
                    tool: "llm",
                    retryPolicy: { maxRetries: 2, backoff: "fixed" },
                },
            },
            {
                name: "Auto Responder",
                description: "Generate automated responses for common issues",
                type: "response_generation",
                config: {
                    tool: "llm",
                    retryPolicy: { maxRetries: 2, backoff: "fixed" },
                },
            },
            {
                name: "Escalation Router",
                description: "Route complex issues to appropriate team members",
                type: "routing",
                config: {
                    tool: "llm",
                    retryPolicy: { maxRetries: 1, backoff: "fixed" },
                },
            },
        ],
        defaultConfig: {
            governorEnabled: true,
            governorMode: "AUTONOMOUS",
        },
    },
    {
        id: "monitoring-stack",
        name: "Monitoring Stack",
        description: "Collect metrics, analyze patterns, and alert on anomalies",
        icon: "Activity",
        category: "Operations",
        defaultAgents: [
            {
                name: "Metrics Collector",
                description: "Collect system and application metrics",
                type: "metrics_collection",
                config: {
                    tool: "http_request",
                    schedule: "*/5 * * * *",
                    retryPolicy: { maxRetries: 3, backoff: "exponential" },
                },
            },
            {
                name: "Pattern Analyzer",
                description: "Analyze metric patterns and detect trends",
                type: "analysis",
                config: {
                    tool: "python",
                    retryPolicy: { maxRetries: 2, backoff: "linear" },
                },
            },
            {
                name: "Alert Dispatcher",
                description: "Send alerts when thresholds are breached",
                type: "alerting",
                config: {
                    tool: "email",
                    retryPolicy: { maxRetries: 5, backoff: "exponential" },
                },
            },
        ],
        defaultConfig: {
            governorEnabled: true,
            governorMode: "ADVISORY",
        },
    },
    {
        id: "content-moderation",
        name: "Content Moderation",
        description: "Review, classify, and moderate user-generated content",
        icon: "Shield",
        category: "Trust & Safety",
        defaultAgents: [
            {
                name: "Content Scanner",
                description: "Scan content for policy violations",
                type: "moderation",
                config: {
                    tool: "llm",
                    retryPolicy: { maxRetries: 2, backoff: "fixed" },
                },
            },
            {
                name: "Severity Assessor",
                description: "Assess violation severity and required action",
                type: "assessment",
                config: {
                    tool: "llm",
                    retryPolicy: { maxRetries: 1, backoff: "fixed" },
                },
            },
            {
                name: "Action Executor",
                description: "Execute moderation actions (flag, hide, remove)",
                type: "action",
                config: {
                    tool: "api",
                    retryPolicy: { maxRetries: 3, backoff: "exponential" },
                },
            },
        ],
        defaultConfig: {
            governorEnabled: true,
            governorMode: "AUTONOMOUS",
        },
    },
    {
        id: "document-processing",
        name: "Document Processing",
        description: "Ingest, parse, and extract data from documents",
        icon: "FileText",
        category: "Data Processing",
        defaultAgents: [
            {
                name: "Document Ingestor",
                description: "Ingest documents from various sources",
                type: "ingestion",
                config: {
                    tool: "file_processor",
                    retryPolicy: { maxRetries: 2, backoff: "exponential" },
                },
            },
            {
                name: "OCR Extractor",
                description: "Extract text from images and scanned documents",
                type: "ocr",
                config: {
                    tool: "ocr",
                    retryPolicy: { maxRetries: 2, backoff: "fixed" },
                },
            },
            {
                name: "Data Extractor",
                description: "Extract structured data from documents",
                type: "extraction",
                config: {
                    tool: "llm",
                    retryPolicy: { maxRetries: 2, backoff: "fixed" },
                },
            },
        ],
        defaultConfig: {
            governorEnabled: false,
            governorMode: "ADVISORY",
        },
    },
];

export const collectionTemplatesService = {
    getAllTemplates(): CollectionTemplate[] {
        return COLLECTION_TEMPLATES;
    },

    getTemplateById(id: string): CollectionTemplate | undefined {
        return COLLECTION_TEMPLATES.find((t) => t.id === id);
    },

    getTemplatesByCategory(category: string): CollectionTemplate[] {
        return COLLECTION_TEMPLATES.filter((t) => t.category === category);
    },

    getCategories(): string[] {
        return [...new Set(COLLECTION_TEMPLATES.map((t) => t.category))];
    },
};
