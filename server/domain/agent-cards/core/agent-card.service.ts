/**
 * Agent Card Service
 * CRUD operations for managing agent cards within an organization.
 * Handles validation, name uniqueness (case-insensitive), model binding FK validation,
 * and soft-delete semantics.
 */

import { db } from "@server/database_service.js";
import { and, eq, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
    NotFoundError,
    ConflictError,
    ValidationError,
} from "@server/utils/errors.js";
import {
    agentCards,
    insertAgentCardSchema,
    type AgentCardRecord,
    type AgentCardCreateInput,
} from "@shared/schema/index.js";
import { llmProviders } from "@shared/schema/ai/llm-router.js";
import { getAgentTools } from "@domain/tools/v1/capabilities/index.js";

const logger = createLogger("AgentCardService");

/**
 * Validates and sanitizes a list of tools against the registered agent tools.
 * Filters out unregistered or dead tool names so phantom tools cannot silently persist.
 */
export function sanitizeAgentTools(tools: string[] | undefined | null): string[] | undefined {
    if (!tools || !Array.isArray(tools)) return tools ?? undefined;
    try {
        const registered = getAgentTools();
        const valid: string[] = [];
        const dropped: string[] = [];
        for (const t of tools) {
            if (typeof t === "string" && registered[t]) {
                valid.push(t);
            } else {
                dropped.push(String(t));
            }
        }
        if (dropped.length > 0) {
            logger.warn(`Dropped ${dropped.length} unregistered/dead tool(s) from agent card: ${dropped.join(", ")}`);
        }
        return valid;
    } catch {
        return tools.filter((t): t is string => typeof t === "string");
    }
}

export class AgentCardService {
    /**
     * Create a new agent card for the organization.
     * Validates input fields, name uniqueness (case-insensitive), and model binding FK.
     */
    async create(orgId: number, input: AgentCardCreateInput): Promise<AgentCardRecord> {
        // Validate input via Zod schema
        const parsed = insertAgentCardSchema.safeParse({
            ...input,
            organizationId: orgId,
        });
        if (!parsed.success) {
            const fieldErrors = parsed.error.flatten().fieldErrors;
            throw new ValidationError("Agent card validation failed", fieldErrors);
        }

        // Validate name length explicitly (belt-and-suspenders with Zod)
        if (!input.name || input.name.length < 1 || input.name.length > 100) {
            throw new ValidationError("Name must be between 1 and 100 characters");
        }

        // Validate description length
        if (!input.description || input.description.length < 1 || input.description.length > 500) {
            throw new ValidationError("Description must be between 1 and 500 characters");
        }

        // Validate capabilities non-empty
        if (!input.capabilities || input.capabilities.length === 0) {
            throw new ValidationError("At least one capability is required");
        }

        // Validate model binding FK - provider must be active for the org
        if (input.modelBindingProviderId) {
            const provider = await db
                .select({ id: llmProviders.id })
                .from(llmProviders)
                .where(
                    and(
                        eq(llmProviders.id, input.modelBindingProviderId),
                        eq(llmProviders.isActive, true),
                    )
                )
                .limit(1);

            if (provider.length === 0) {
                throw new ValidationError(
                    "Model binding provider not found or inactive",
                    { modelBindingProviderId: input.modelBindingProviderId }
                );
            }
        }

        // Check case-insensitive name uniqueness within org
        const existingByName = await db
            .select({ id: agentCards.id })
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.organizationId, orgId),
                    sql`lower(${agentCards.name}) = lower(${input.name})`
                )
            )
            .limit(1);

        if (existingByName.length > 0) {
            throw new ConflictError(
                `An agent card with name "${input.name}" already exists in this organization`
            );
        }

        const tools = parsed.data.tools !== undefined ? sanitizeAgentTools(parsed.data.tools as string[]) : undefined;

        // Insert the record
        const [created] = await db
            .insert(agentCards)
            .values({
                ...parsed.data,
                ...(tools !== undefined ? { tools } : {}),
                organizationId: orgId,
            })
            .returning();

        logger.info(`Created agent card "${created.name}" (id=${created.id}) for org ${orgId}`);
        return created;
    }

    /**
     * List all enabled agent cards for an organization, ordered by createdAt descending.
     */
    async list(orgId: number): Promise<AgentCardRecord[]> {
        return db
            .select()
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.organizationId, orgId),
                    eq(agentCards.enabled, true)
                )
            )
            .orderBy(desc(agentCards.createdAt));
    }

    /**
     * Get a single agent card by ID, scoped to the organization.
     * Returns null if not found.
     */
    async getById(orgId: number, id: number): Promise<AgentCardRecord | null> {
        const results = await db
            .select()
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.id, id),
                    eq(agentCards.organizationId, orgId)
                )
            )
            .limit(1);

        return results[0] ?? null;
    }

    /**
     * Update an agent card with partial update semantics.
     * Only provided fields are modified; unspecified fields are preserved.
     * Validates name uniqueness if name is being changed.
     */
    async update(
        orgId: number,
        id: number,
        input: Partial<AgentCardCreateInput>
    ): Promise<AgentCardRecord> {
        // Verify the card exists and belongs to the org
        const existing = await this.getById(orgId, id);
        if (!existing) {
            throw new NotFoundError(
                `Agent card ${id} not found`,
                "NOT_FOUND",
                { agentCardId: id, organizationId: orgId }
            );
        }

        // Validate name length if provided
        if (input.name !== undefined) {
            if (input.name.length < 1 || input.name.length > 100) {
                throw new ValidationError("Name must be between 1 and 100 characters");
            }

            // Check case-insensitive name uniqueness (excluding current record)
            const existingByName = await db
                .select({ id: agentCards.id })
                .from(agentCards)
                .where(
                    and(
                        eq(agentCards.organizationId, orgId),
                        sql`lower(${agentCards.name}) = lower(${input.name})`,
                        sql`${agentCards.id} != ${id}`
                    )
                )
                .limit(1);

            if (existingByName.length > 0) {
                throw new ConflictError(
                    `An agent card with name "${input.name}" already exists in this organization`
                );
            }
        }

        // Validate description length if provided
        if (input.description !== undefined) {
            if (input.description.length < 1 || input.description.length > 500) {
                throw new ValidationError("Description must be between 1 and 500 characters");
            }
        }

        // Validate capabilities non-empty if provided
        if (input.capabilities !== undefined) {
            if (input.capabilities.length === 0) {
                throw new ValidationError("At least one capability is required");
            }
        }

        // Validate model binding FK if provided. `!= null` on purpose: the field
        // is nullable, and passing an explicit null (clearing the binding) must
        // skip the lookup rather than reach eq(), which rejects null.
        if (input.modelBindingProviderId != null) {
            const provider = await db
                .select({ id: llmProviders.id })
                .from(llmProviders)
                .where(
                    and(
                        eq(llmProviders.id, input.modelBindingProviderId),
                        eq(llmProviders.isActive, true),
                    )
                )
                .limit(1);

            if (provider.length === 0) {
                throw new ValidationError(
                    "Model binding provider not found or inactive",
                    { modelBindingProviderId: input.modelBindingProviderId }
                );
            }
        }

        // Build update payload - only include provided fields
        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (input.name !== undefined) updateData.name = input.name;
        if (input.description !== undefined) updateData.description = input.description;
        if (input.personaType !== undefined) updateData.personaType = input.personaType;
        if (input.modelBindingProviderId !== undefined) updateData.modelBindingProviderId = input.modelBindingProviderId;
        if (input.modelBindingModelId !== undefined) updateData.modelBindingModelId = input.modelBindingModelId;
        if (input.capabilities !== undefined) updateData.capabilities = input.capabilities;
        if (input.tools !== undefined) updateData.tools = sanitizeAgentTools(input.tools as string[]);
        if (input.topicAffinities !== undefined) updateData.topicAffinities = input.topicAffinities;
        if (input.intentAffinities !== undefined) updateData.intentAffinities = input.intentAffinities;
        // Explicit null clears the boundary; undefined leaves it alone.
        if (input.approvalBoundary !== undefined) updateData.approvalBoundary = input.approvalBoundary || null;

        const [updated] = await db
            .update(agentCards)
            .set(updateData)
            .where(
                and(
                    eq(agentCards.id, id),
                    eq(agentCards.organizationId, orgId)
                )
            )
            .returning();

        logger.info(`Updated agent card "${updated.name}" (id=${id}) for org ${orgId}`);
        return updated;
    }

    /**
     * Soft-delete an agent card by setting enabled=false.
     * The record is retained for auditing but excluded from list and routing queries.
     */
    async softDelete(orgId: number, id: number): Promise<void> {
        const existing = await this.getById(orgId, id);
        if (!existing) {
            throw new NotFoundError(
                `Agent card ${id} not found`,
                "NOT_FOUND",
                { agentCardId: id, organizationId: orgId }
            );
        }

        await db
            .update(agentCards)
            .set({ enabled: false, updatedAt: new Date() })
            .where(
                and(
                    eq(agentCards.id, id),
                    eq(agentCards.organizationId, orgId)
                )
            );

        logger.info(`Soft-deleted agent card (id=${id}) for org ${orgId}`);
    }

    /**
     * Get all enabled agent cards for routing (same as list but explicitly named for intent router use).
     */
    async getEnabledForRouting(orgId: number): Promise<AgentCardRecord[]> {
        return db
            .select()
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.organizationId, orgId),
                    eq(agentCards.enabled, true)
                )
            )
            .orderBy(desc(agentCards.createdAt));
    }

    /**
     * Get the default agent card for the organization.
     * The default card is used as a fallback when no other card matches routing.
     */
    async getDefault(orgId: number): Promise<AgentCardRecord> {
        const results = await db
            .select()
            .from(agentCards)
            .where(
                and(
                    eq(agentCards.organizationId, orgId),
                    eq(agentCards.isDefault, true),
                    eq(agentCards.enabled, true)
                )
            )
            .limit(1);

        if (results.length === 0) {
            throw new NotFoundError(
                `No default agent card found for organization ${orgId}`,
                "NOT_FOUND",
                { organizationId: orgId }
            );
        }

        return results[0];
    }
}

export const agentCardService = new AgentCardService();
