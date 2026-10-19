import { db } from "@server/database_service.js";
import { eq, and, asc } from "drizzle-orm";
import {
    ontologyObjectTypes,
    type OntologyObjectType,
    type InsertOntologyObjectTypeInput,
} from "@shared/schema/ontology/ontology.js";
import {
    ontologyTypeVersions,
    type OntologyTypeVersion,
} from "@shared/schema/ontology/ontology-versions.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CustomOntologyStore");

/**
 * CustomOntologyStore
 *
 * Persistent, versioned registry for user-defined business entity type definitions.
 * Replaces in-memory-only registration with DB-backed persistence, version history,
 * and boot-time loading.
 *
 * All methods are org-scoped. The in-memory registry is populated at startup via
 * `loadActiveDefinitions` and updated only on successful DB operations (Req 6, AC 6).
 */
export const customOntologyStoreService = {
    /**
     * In-memory registry of active ontology definitions, keyed by type id.
     * Populated by loadActiveDefinitions at startup and kept in sync on
     * successful register/update operations.
     */
    _registry: new Map<number, OntologyObjectType>(),

    /**
     * Register a new business entity type definition.
     *
     * Persists to the `ontology_object_types` table, creates a version 1 record
     * in `ontology_type_versions`, and adds the definition to the in-memory registry.
     *
     * On DB failure, returns an error without updating the in-memory registry (Req 6, AC 6).
     *
     * @param def - The ontology object type definition to register
     * @param actorId - The authenticated user id performing the registration
     * @returns The stored definition including its assigned id and version number
     */
    async register(
        def: InsertOntologyObjectTypeInput,
        actorId: string,
    ): Promise<OntologyObjectType> {
        try {
            // Insert the object type definition
            const [inserted] = await db
                .insert(ontologyObjectTypes)
                .values({
                    organizationId: def.organizationId,
                    name: def.name,
                    description: def.description ?? null,
                    propertiesSchema: def.propertiesSchema ?? {},
                    titleProperty: def.titleProperty ?? null,
                    icon: def.icon ?? null,
                    backing: def.backing ?? "materialized",
                    sourceAdapter: def.sourceAdapter ?? null,
                    isActive: def.isActive ?? true,
                    createdBy: actorId,
                })
                .returning();

            // Create version 1 record in the version history
            await db.insert(ontologyTypeVersions).values({
                objectTypeId: inserted.id,
                organizationId: inserted.organizationId,
                version: 1,
                definitionSnapshot: inserted as unknown as Record<string, unknown>,
                actorUserId: actorId,
            });

            // Only update in-memory registry on successful DB operations
            this._registry.set(inserted.id, inserted);

            logger.info("Registered ontology type", {
                typeId: inserted.id,
                name: inserted.name,
                orgId: inserted.organizationId,
                actorId,
            });

            return inserted;
        } catch (error: any) {
            // Req 6, AC 6: On DB failure, return error without updating in-memory registry
            logger.error("Failed to register ontology type", {
                name: def.name,
                orgId: def.organizationId,
                actorId,
                error: error.message || error,
            });
            throw new Error(`Failed to register ontology type '${def.name}': ${error.message}`);
        }
    },

    /**
     * Update an existing business entity type definition.
     *
     * Increments the version number, applies changes to `ontology_object_types`,
     * and inserts a new immutable version record in `ontology_type_versions` with
     * the actor and timestamp (Req 6, AC 3 & AC 4).
     *
     * On DB failure, returns an error without updating the in-memory registry (Req 6, AC 6).
     *
     * @param typeId - The id of the ontology object type to update
     * @param changes - Partial changes to apply to the definition
     * @param actorId - The authenticated user id performing the modification
     * @returns The updated definition with its new version number
     */
    async update(
        typeId: number,
        changes: Partial<InsertOntologyObjectTypeInput>,
        actorId: string,
    ): Promise<OntologyObjectType> {
        try {
            // Get the current highest version number for this type
            const versionRows = await db
                .select({ version: ontologyTypeVersions.version })
                .from(ontologyTypeVersions)
                .where(eq(ontologyTypeVersions.objectTypeId, typeId))
                .orderBy(asc(ontologyTypeVersions.version));

            const currentMaxVersion = versionRows.length > 0
                ? versionRows[versionRows.length - 1].version
                : 0;
            const nextVersion = currentMaxVersion + 1;

            // Build the update payload, only including defined fields
            const updatePayload: Record<string, any> = { updatedAt: new Date() };
            if (changes.name !== undefined) updatePayload.name = changes.name;
            if (changes.description !== undefined) updatePayload.description = changes.description;
            if (changes.propertiesSchema !== undefined) updatePayload.propertiesSchema = changes.propertiesSchema;
            if (changes.titleProperty !== undefined) updatePayload.titleProperty = changes.titleProperty;
            if (changes.icon !== undefined) updatePayload.icon = changes.icon;
            if (changes.backing !== undefined) updatePayload.backing = changes.backing;
            if (changes.sourceAdapter !== undefined) updatePayload.sourceAdapter = changes.sourceAdapter;
            if (changes.isActive !== undefined) updatePayload.isActive = changes.isActive;

            // Apply changes to the object type
            const [updated] = await db
                .update(ontologyObjectTypes)
                .set(updatePayload)
                .where(eq(ontologyObjectTypes.id, typeId))
                .returning();

            if (!updated) {
                throw new Error(`Ontology type with id ${typeId} not found`);
            }

            // Insert immutable version history record with actor and timestamp
            await db.insert(ontologyTypeVersions).values({
                objectTypeId: typeId,
                organizationId: updated.organizationId,
                version: nextVersion,
                definitionSnapshot: updated as unknown as Record<string, unknown>,
                actorUserId: actorId,
            });

            // Only update in-memory registry on successful DB operations
            this._registry.set(updated.id, updated);

            logger.info("Updated ontology type", {
                typeId,
                version: nextVersion,
                actorId,
                orgId: updated.organizationId,
            });

            return updated;
        } catch (error: any) {
            // Req 6, AC 6: On DB failure, return error without updating in-memory registry
            logger.error("Failed to update ontology type", {
                typeId,
                actorId,
                error: error.message || error,
            });
            throw new Error(`Failed to update ontology type ${typeId}: ${error.message}`);
        }
    },

    /**
     * Load all active ontology definitions for an organization into the in-memory registry.
     *
     * Called at application startup before the server accepts requests (Req 6, AC 2).
     * Queries `ontology_object_types` WHERE `is_active = true` for the given org.
     *
     * @param orgId - The organization id to load definitions for
     * @returns Array of active ontology type definitions
     */
    async loadActiveDefinitions(orgId: number): Promise<OntologyObjectType[]> {
        try {
            const definitions = await db
                .select()
                .from(ontologyObjectTypes)
                .where(
                    and(
                        eq(ontologyObjectTypes.organizationId, orgId),
                        eq(ontologyObjectTypes.isActive, true),
                    ),
                );

            // Populate the in-memory registry
            for (const def of definitions) {
                this._registry.set(def.id, def);
            }

            logger.info("Loaded active ontology definitions", {
                orgId,
                count: definitions.length,
            });

            return definitions;
        } catch (error: any) {
            logger.error("Failed to load active ontology definitions", {
                orgId,
                error: error.message || error,
            });
            throw new Error(`Failed to load active ontology definitions for org ${orgId}: ${error.message}`);
        }
    },

    /**
     * Get the version history for a specific ontology object type.
     *
     * Returns all version records in ascending chronological order (Req 6, AC 5).
     * Returns an empty array (not an error) if the type does not exist (Req 6, AC 7).
     *
     * @param typeId - The ontology object type id to query history for
     * @param orgId - The organization id to scope the query to
     * @returns Array of version records ordered by version ascending (empty if not found)
     */
    async getVersionHistory(
        typeId: number,
        orgId: number,
    ): Promise<OntologyTypeVersion[]> {
        try {
            const versions = await db
                .select()
                .from(ontologyTypeVersions)
                .where(
                    and(
                        eq(ontologyTypeVersions.objectTypeId, typeId),
                        eq(ontologyTypeVersions.organizationId, orgId),
                    ),
                )
                .orderBy(asc(ontologyTypeVersions.version));

            return versions;
        } catch (error: any) {
            logger.error("Failed to get version history", {
                typeId,
                orgId,
                error: error.message || error,
            });
            throw new Error(`Failed to get version history for type ${typeId}: ${error.message}`);
        }
    },

    /**
     * Get a definition from the in-memory registry by type id.
     * Returns undefined if not loaded.
     */
    getFromRegistry(typeId: number): OntologyObjectType | undefined {
        return this._registry.get(typeId);
    },

    /**
     * Get all definitions from the in-memory registry.
     */
    getAllFromRegistry(): OntologyObjectType[] {
        return Array.from(this._registry.values());
    },

    /**
     * Clear the in-memory registry. Useful for testing.
     */
    clearRegistry(): void {
        this._registry.clear();
    },
};

export default customOntologyStoreService;
