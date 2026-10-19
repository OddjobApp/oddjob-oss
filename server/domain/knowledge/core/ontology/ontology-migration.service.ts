import { db } from "@server/database_service.js";
import { eq } from "drizzle-orm";
import {
    ontologyObjects,
} from "@shared/schema/ontology/ontology.js";
import { customOntologyStoreService } from "./custom-ontology-store.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OntologyMigration");

/**
 * Result of a type change migration attempt.
 */
export interface MigrationResult {
    success: boolean;
    incompatibleInstances?: Array<{ instanceId: number; currentValue: any }>;
    timedOut?: boolean;
    checkedCount?: number;
    remainingCount?: number;
}

/**
 * Type compatibility matrix.
 * Returns true if a value of the source type can be losslessly converted to the target type.
 */
function isValueCompatible(value: any, targetType: string): boolean {
    if (value === null || value === undefined) {
        // Null/undefined values are compatible with any type
        return true;
    }

    switch (targetType) {
        case "string":
            // Everything can be stringified losslessly
            return true;

        case "integer": {
            if (typeof value === "number") {
                return Number.isInteger(value);
            }
            if (typeof value === "string") {
                const parsed = Number(value);
                return !isNaN(parsed) && Number.isInteger(parsed) && String(parsed) === value.trim();
            }
            if (typeof value === "boolean") {
                // boolean -> integer: true=1, false=0 is lossless
                return true;
            }
            return false;
        }

        case "number": {
            if (typeof value === "number") {
                return true;
            }
            if (typeof value === "string") {
                const parsed = Number(value);
                return !isNaN(parsed) && value.trim() !== "";
            }
            if (typeof value === "boolean") {
                return true;
            }
            return false;
        }

        case "boolean": {
            if (typeof value === "boolean") {
                return true;
            }
            if (typeof value === "string") {
                const lower = value.toLowerCase().trim();
                return lower === "true" || lower === "false";
            }
            // Numbers: 0 and 1 can map to boolean losslessly
            if (typeof value === "number") {
                return value === 0 || value === 1;
            }
            return false;
        }

        case "array": {
            return Array.isArray(value);
        }

        case "object": {
            return typeof value === "object" && !Array.isArray(value);
        }

        default:
            // Unknown target type — conservative: not compatible
            return false;
    }
}

/**
 * OntologyMigrationService
 *
 * Handles schema evolution for custom ontology type definitions.
 * Supports adding, removing, and changing property types with safety validation.
 *
 * - Add property: Updates propertiesSchema; existing instances unchanged (Req 7, AC 1).
 * - Remove property: Marks property deprecated; instances retain data (Req 7, AC 2).
 * - Change type: Validates lossless conversion for all instances (Req 7, AC 3–5).
 */
export const ontologyMigrationService = {
    /**
     * Add a new property to an existing entity type definition.
     *
     * Updates the propertiesSchema on the type definition. Existing instances
     * remain queryable with their current property values unchanged (Req 7, AC 1).
     *
     * @param typeId - The ontology object type ID
     * @param propertyName - Name of the new property to add
     * @param propertySchema - JSON Schema definition for the property (e.g. { type: "string" })
     * @param actorId - The authenticated user performing the migration
     */
    async addProperty(
        typeId: number,
        propertyName: string,
        propertySchema: any,
        actorId: string,
    ): Promise<void> {
        const typeDef = customOntologyStoreService.getFromRegistry(typeId);
        if (!typeDef) {
            throw new Error(`Ontology type with id ${typeId} not found in registry`);
        }

        const currentSchema = (typeDef.propertiesSchema as Record<string, any>) ?? {};

        if (currentSchema[propertyName] !== undefined) {
            throw new Error(`Property '${propertyName}' already exists on type ${typeId}`);
        }

        // Build updated schema with the new property
        const updatedSchema = {
            ...currentSchema,
            [propertyName]: propertySchema,
        };

        // Persist via customOntologyStoreService.update (creates version record)
        await customOntologyStoreService.update(
            typeId,
            { propertiesSchema: updatedSchema },
            actorId,
        );

        logger.info("Added property to ontology type", {
            typeId,
            propertyName,
            actorId,
        });
    },

    /**
     * Remove a property from an existing entity type definition.
     *
     * Marks the property as deprecated in the propertiesSchema (adds `_deprecated: true` flag).
     * Existing instances continue to return the deprecated property values on read
     * until explicitly purged by the operator (Req 7, AC 2).
     *
     * @param typeId - The ontology object type ID
     * @param propertyName - Name of the property to deprecate
     * @param actorId - The authenticated user performing the migration
     */
    async removeProperty(
        typeId: number,
        propertyName: string,
        actorId: string,
    ): Promise<void> {
        const typeDef = customOntologyStoreService.getFromRegistry(typeId);
        if (!typeDef) {
            throw new Error(`Ontology type with id ${typeId} not found in registry`);
        }

        const currentSchema = (typeDef.propertiesSchema as Record<string, any>) ?? {};

        if (currentSchema[propertyName] === undefined) {
            throw new Error(`Property '${propertyName}' does not exist on type ${typeId}`);
        }

        // Mark property as deprecated rather than deleting it
        const updatedSchema = {
            ...currentSchema,
            [propertyName]: {
                ...((typeof currentSchema[propertyName] === "object" && currentSchema[propertyName] !== null)
                    ? currentSchema[propertyName]
                    : { type: currentSchema[propertyName] }),
                _deprecated: true,
            },
        };

        // Persist via customOntologyStoreService.update (creates version record)
        await customOntologyStoreService.update(
            typeId,
            { propertiesSchema: updatedSchema },
            actorId,
        );

        logger.info("Deprecated property on ontology type", {
            typeId,
            propertyName,
            actorId,
        });
    },

    /**
     * Change the type of a property on an existing entity type definition.
     *
     * Validates that all existing instance values for that property can be
     * losslessly converted to the new type before applying (Req 7, AC 3).
     *
     * On incompatibility, returns up to 100 affected instances (Req 7, AC 4).
     * Validation timeout: 30 seconds — aborts and returns remaining count (Req 7, AC 5).
     *
     * @param typeId - The ontology object type ID
     * @param propertyName - Name of the property to change
     * @param newType - The new type string (e.g. "string", "integer", "boolean", "number")
     * @param actorId - The authenticated user performing the migration
     * @returns MigrationResult indicating success or failure details
     */
    async changePropertyType(
        typeId: number,
        propertyName: string,
        newType: string,
        actorId: string,
    ): Promise<MigrationResult> {
        const typeDef = customOntologyStoreService.getFromRegistry(typeId);
        if (!typeDef) {
            throw new Error(`Ontology type with id ${typeId} not found in registry`);
        }

        const currentSchema = (typeDef.propertiesSchema as Record<string, any>) ?? {};

        if (currentSchema[propertyName] === undefined) {
            throw new Error(`Property '${propertyName}' does not exist on type ${typeId}`);
        }

        // Query all instances of this type to validate compatibility
        const instances = await db
            .select({
                id: ontologyObjects.id,
                properties: ontologyObjects.properties,
            })
            .from(ontologyObjects)
            .where(eq(ontologyObjects.objectTypeId, typeId));

        const incompatibleInstances: Array<{ instanceId: number; currentValue: any }> = [];
        let checkedCount = 0;
        const startTime = Date.now();
        const TIMEOUT_MS = 30_000; // 30 seconds

        for (const instance of instances) {
            // Check timeout (Req 7, AC 5)
            if (Date.now() - startTime >= TIMEOUT_MS) {
                const remainingCount = instances.length - checkedCount;
                logger.warn("Ontology migration validation timed out", {
                    typeId,
                    propertyName,
                    newType,
                    checkedCount,
                    remainingCount,
                });
                return {
                    success: false,
                    timedOut: true,
                    checkedCount,
                    remainingCount,
                };
            }

            const properties = instance.properties as Record<string, any> | null;
            if (!properties || !(propertyName in properties)) {
                // Instance doesn't have this property set — compatible
                checkedCount++;
                continue;
            }

            const currentValue = properties[propertyName];

            if (!isValueCompatible(currentValue, newType)) {
                incompatibleInstances.push({
                    instanceId: instance.id,
                    currentValue,
                });

                // Cap at 100 incompatible instances (Req 7, AC 4)
                if (incompatibleInstances.length >= 100) {
                    checkedCount++;
                    break;
                }
            }

            checkedCount++;
        }

        // If there are incompatible instances, reject the migration
        if (incompatibleInstances.length > 0) {
            logger.info("Ontology migration rejected: incompatible instances", {
                typeId,
                propertyName,
                newType,
                incompatibleCount: incompatibleInstances.length,
                checkedCount,
            });
            return {
                success: false,
                incompatibleInstances,
                checkedCount,
                remainingCount: instances.length - checkedCount,
            };
        }

        // All instances are compatible — apply the type change
        const updatedSchema = {
            ...currentSchema,
            [propertyName]: {
                ...((typeof currentSchema[propertyName] === "object" && currentSchema[propertyName] !== null)
                    ? currentSchema[propertyName]
                    : {}),
                type: newType,
            },
        };

        await customOntologyStoreService.update(
            typeId,
            { propertiesSchema: updatedSchema },
            actorId,
        );

        logger.info("Changed property type on ontology type", {
            typeId,
            propertyName,
            newType,
            actorId,
            checkedCount,
        });

        return {
            success: true,
            checkedCount,
            remainingCount: 0,
        };
    },
};

export default ontologyMigrationService;
