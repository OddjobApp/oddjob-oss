export interface ExtractedEntity {
    name: string;
    label: string;
    description?: string;
    confidenceScore?: number;
    externalId?: string;
    properties?: Record<string, any>;
}

export interface ExtractedRelationship {
    source: string;
    target: string;
    relation: string;
    description?: string;
    weight?: number;
}

export interface ExtractionResult {
    entities: ExtractedEntity[];
    relationships: ExtractedRelationship[];
}

export function normalizeExtractionResult(value: unknown): ExtractionResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const candidate = value as Record<string, unknown>;
    const rawEntities = Array.isArray(candidate.entities) ? candidate.entities : [];
    const rawRelationships = Array.isArray(candidate.relationships) ? candidate.relationships : [];

    const entities = rawEntities.filter((entity): entity is ExtractedEntity => {
        if (!entity || typeof entity !== "object" || Array.isArray(entity)) return false;
        const item = entity as Record<string, unknown>;
        return typeof item.name === "string" && item.name.trim().length > 0
            && typeof item.label === "string" && item.label.trim().length > 0;
    });

    const relationships = rawRelationships.filter((relationship): relationship is ExtractedRelationship => {
        if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) return false;
        const item = relationship as Record<string, unknown>;
        return typeof item.source === "string" && item.source.trim().length > 0
            && typeof item.target === "string" && item.target.trim().length > 0
            && typeof item.relation === "string" && item.relation.trim().length > 0;
    });

    return { entities, relationships };
}
