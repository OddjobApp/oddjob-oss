import { z } from "zod";

// Explicit Mapping Interfaces for Knowledge Graph Extraction
export interface EntityRule {
    id?: string;             // Rule identifier (for referencing in relationships)
    name?: string;           // Friendly name
    entityType: string;      // Classification (e.g., "User", "Issue")
    label: string;           // KnowledgeNode label
    rootPath?: string;       // JSONPath to iterate over (default "$")
    mappings: {
        name: string;        // Path to name property
        externalId?: string; // Path to external ID
        data?: Record<string, string>; // Maps custom fields
    };
    includeFullSourceData?: boolean;
    condition?: string;
}

export interface RelationshipRule {
    relation: string;
    sourceEntity: string;  // ID or entityType of source
    targetEntity: string;  // ID or entityType of target
    sourcePath?: string;   // Path to source join key
    targetPath?: string;   // Path to target join key
    weight?: number;
    condition?: string;
}

export interface KnowledgeGraphConfig {
    entityRules: EntityRule[];
    relationshipRules?: RelationshipRule[];
}

// Zod Schemas for Knowledge Graph Configuration
export const entityRuleSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    entityType: z.string(),
    label: z.string(),
    rootPath: z.string().optional(),
    mappings: z.object({
        name: z.string(),
        externalId: z.string().optional(),
        data: z.record(z.string()).optional(),
    }),
    includeFullSourceData: z.boolean().optional(),
    condition: z.string().optional(),
});

export const relationshipRuleSchema = z.object({
    relation: z.string(),
    sourceEntity: z.string(),
    targetEntity: z.string(),
    sourcePath: z.string().optional(),
    targetPath: z.string().optional(),
    weight: z.number().optional(),
    condition: z.string().optional(),
});

export const pipelineKnowledgeGraphConfigSchema = z.object({
    extractFromSteps: z.array(z.number().int().positive()).optional(), // Empty = all steps
    entityRules: z.array(entityRuleSchema).optional(),
    relationshipRules: z.array(relationshipRuleSchema).optional(),
    autoCreate: z.boolean().default(true),
    linkToKnowledgeDocuments: z.boolean().default(true),
    defaultExtractionSchemaId: z.number().int().positive().optional(),
});

export type PipelineKnowledgeGraphConfig = z.infer<typeof pipelineKnowledgeGraphConfigSchema>;



