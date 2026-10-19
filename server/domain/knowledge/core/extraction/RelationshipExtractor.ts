
import _ from "lodash";
const { get } = _;
import type { RelationshipRule } from "@shared/schema/index.js";
import { ExtractedEntity, evaluateSimpleCondition } from "./EntityExtractor.js";

export interface ExtractedRelationship {
    relation: string;
    sourceEntity: ExtractedEntity;
    targetEntity: ExtractedEntity;
    weight?: number;
}

/**
 * Extract relationships from data using relationship rules
 */
export function extractRelationships(
    data: any,
    relationshipRules: RelationshipRule[],
    entities: ExtractedEntity[]
): ExtractedRelationship[] {
    const relationships: ExtractedRelationship[] = [];

    // Create lookup map by externalId for quick entity finding
    const entityMap = new Map<string, ExtractedEntity>();
    for (const entity of entities) {
        if (entity.externalId) {
            entityMap.set(entity.externalId, entity);
        }
    }

    // Handle arrays
    const dataArray = Array.isArray(data) ? data : [data];

    for (const item of dataArray) {
        for (const rule of relationshipRules) {
            try {
                const sourceId = get(item, String(rule.sourcePath));
                const targetId = get(item, String(rule.targetPath));

                if (!sourceId || !targetId) {
                    continue; // Skip if source or target is missing
                }

                // Find source and target entities
                const sourceEntity = entityMap.get(String(sourceId));
                const targetEntity = entityMap.get(String(targetId));

                if (!sourceEntity || !targetEntity) {
                    continue; // Skip if entities not found
                }

                // Check condition if provided
                if (rule.condition) {
                    // Simple condition evaluation (can be enhanced with CEL evaluator)
                    // For now, just check if condition is a simple boolean expression
                    try {
                        // This is a simplified condition check - in production, use CEL evaluator
                        const conditionResult = evaluateSimpleCondition(rule.condition, item);
                        if (!conditionResult) {
                            continue; // Skip if condition is false
                        }
                    } catch (e) {
                        console.warn(`[Knowledge Graph] Failed to evaluate condition: ${rule.condition}`, e);
                        continue;
                    }
                }

                relationships.push({
                    relation: rule.relation,
                    sourceEntity,
                    targetEntity,
                    weight: rule.weight || 1,
                });
            } catch (error) {
                console.error(`[Knowledge Graph] Error extracting relationship with rule ${rule.relation}:`, error);
            }
        }
    }

    return relationships;
}


