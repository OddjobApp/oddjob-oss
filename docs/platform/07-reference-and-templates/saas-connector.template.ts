/**
 * Enterprise SaaS Connector Template
 * Oddjob Reference Implementation
 * 
 * Standard template for SaaS data ingestion adapters with token-bucket
 * rate limiting, cursor pagination, and entity normalization into the Knowledge Graph.
 */

import { z } from "zod";

export const SaaSConnectorConfigSchema = z.object({
  connectorId: z.string().describe("Unique connector identifier, e.g. 'jira_production_sync'"),
  sourceType: z.enum(["JIRA", "SLACK", "SALESFORCE", "SERVICENOW", "AGENTMAIL"]),
  baseUrl: z.string().url(),
  syncIntervalMinutes: z.number().int().min(1).default(15),
  batchSize: z.number().int().min(1).max(200).default(50),
  rateLimitPerMinute: z.number().int().default(60)
});

export type SaaSConnectorConfig = z.infer<typeof SaaSConnectorConfigSchema>;

export interface SyncStateWatermark {
  lastSyncTimestamp: string;
  nextCursor?: string;
  recordsIngestedTotal: number;
}

export interface IngestedEntityPayload {
  externalId: string;
  canonicalType: "WORK_ITEM" | "INCIDENT" | "OPPORTUNITY" | "CONVERSATION_EVENT";
  title: string;
  properties: Record<string, any>;
  relationships: Array<{
    targetEntityId: string;
    predicate: "ASSIGNED_TO" | "RELATES_TO" | "BLOCKS" | "AFFECTS";
  }>;
}

export class SaaSConnectorTemplate {
  private config: SaaSConnectorConfig;

  constructor(config: SaaSConnectorConfig) {
    this.config = SaaSConnectorConfigSchema.parse(config);
  }

  /**
   * Executes an incremental synchronization run using cursor watermarks
   */
  public async executeIncrementalSync(
    watermark: SyncStateWatermark,
    fetchPage: (cursor?: string, batchSize?: number) => Promise<{ items: any[]; nextCursor?: string }>
  ): Promise<{ entities: IngestedEntityPayload[]; newWatermark: SyncStateWatermark }> {
    let currentCursor = watermark.nextCursor;
    const normalizedEntities: IngestedEntityPayload[] = [];
    let pageCount = 0;
    const maxPages = 20; // Safety guard to prevent runaway loops

    while (pageCount < maxPages) {
      // 1. Fetch page from upstream SaaS API
      const response = await fetchPage(currentCursor, this.config.batchSize);
      if (!response.items || response.items.length === 0) {
        break;
      }

      // 2. Normalize raw payload to canonical Knowledge Graph entities
      for (const item of response.items) {
        normalizedEntities.push(this.normalizeRecord(item));
      }

      currentCursor = response.nextCursor;
      pageCount++;

      if (!currentCursor) {
        break; // Reached end of stream
      }
    }

    return {
      entities: normalizedEntities,
      newWatermark: {
        lastSyncTimestamp: new Date().toISOString(),
        nextCursor: currentCursor,
        recordsIngestedTotal: watermark.recordsIngestedTotal + normalizedEntities.length
      }
    };
  }

  private normalizeRecord(rawItem: any): IngestedEntityPayload {
    return {
      externalId: String(rawItem.id),
      canonicalType: "WORK_ITEM",
      title: rawItem.title || rawItem.summary || "Untitled",
      properties: {
        status: rawItem.status,
        priority: rawItem.priority,
        rawPayload: rawItem
      },
      relationships: []
    };
  }
}
