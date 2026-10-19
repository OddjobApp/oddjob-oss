/**
 * MarketplaceListingService
 *
 * Handles publishing and installing agent-card-based bot packages.
 *
 * publish:   snapshots an agent card → stores a marketplace_listing row
 * list:      returns public listings ordered by install_count desc
 * install:   reads the snapshot, calls agentCardService.create, increments install_count
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    intentCategories,
    marketplaceListings,
    type MarketplaceListingRecord,
    publishBotInputSchema,
    type PublishBotInput,
    topicCategories,
} from "@shared/schema/index.js";
import { agentCardService } from "@server/domain/agent-cards/core/agent-card.service.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ValidationError } from "@server/utils/errors.js";

/** The values of `list` present in `value`, dropping anything the categories do not name. */
function keepKnown<T extends string>(value: unknown, list: readonly T[]): T[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is T => typeof entry === "string" && (list as readonly string[]).includes(entry));
}

const logger = createLogger("MarketplaceListingService");

export class MarketplaceListingService {
    /**
     * Publish a bot to the marketplace by snapshotting the specified AgentCard.
     *
     * The agent card must belong to the caller's org.
     */
    async publish(
        orgId: number,
        userId: string,
        input: PublishBotInput,
    ): Promise<MarketplaceListingRecord> {
        const parsed = publishBotInputSchema.parse(input);

        // Fetch the card to snapshot it (also validates org ownership)
        const card = await agentCardService.getById(orgId, parsed.agentCardId);
        if (!card) {
            throw new NotFoundError(
                `Agent card ${parsed.agentCardId} not found`,
                "NOT_FOUND",
                { agentCardId: parsed.agentCardId, orgId },
            );
        }

        const agentCardSnapshot = {
            name: card.name,
            description: card.description,
            personaType: card.personaType,
            capabilities: card.capabilities,
            tools: card.tools,
            topicAffinities: card.topicAffinities,
            intentAffinities: card.intentAffinities,
        };

        const [listing] = await db.insert(marketplaceListings).values({
            organizationId: orgId,
            publishedByUserId: userId,
            name: parsed.name,
            description: parsed.description,
            category: parsed.category,
            tags: parsed.tags,
            iconEmoji: parsed.iconEmoji,
            isPublic: parsed.isPublic,
            agentCardSnapshot,
        }).returning();

        logger.info("Marketplace listing published", { listingId: listing.id, name: listing.name });
        return listing;
    }

    /**
     * List all public marketplace listings, sorted by install count.
     *
     * @param category  Optional category filter
     * @param limit     Max results (default 50)
     */
    async listPublic(category?: string, limit = 50): Promise<MarketplaceListingRecord[]> {
        const conditions = [eq(marketplaceListings.isPublic, true)];
        if (category) conditions.push(eq(marketplaceListings.category, category));

        return db
            .select()
            .from(marketplaceListings)
            .where(and(...conditions))
            .orderBy(desc(marketplaceListings.installCount))
            .limit(limit);
    }

    /**
     * List all listings published by a specific org (for management view).
     */
    async listByOrg(orgId: number): Promise<MarketplaceListingRecord[]> {
        return db
            .select()
            .from(marketplaceListings)
            .where(eq(marketplaceListings.organizationId, orgId))
            .orderBy(desc(marketplaceListings.createdAt));
    }

    /**
     * Get a single listing by ID (respects isPublic).
     */
    async getById(id: number, requirePublic = true): Promise<MarketplaceListingRecord> {
        const results = await db
            .select()
            .from(marketplaceListings)
            .where(eq(marketplaceListings.id, id))
            .limit(1);

        const listing = results[0];
        if (!listing) {
            throw new NotFoundError(`Marketplace listing ${id} not found`, "NOT_FOUND");
        }
        if (requirePublic && !listing.isPublic) {
            throw new NotFoundError(`Marketplace listing ${id} not found`, "NOT_FOUND");
        }
        return listing;
    }

    /**
     * Install a marketplace listing into an org by cloning the agent card snapshot.
     *
     * Increments install_count non-fatally (a counter drift is acceptable).
     */
    async install(
        listingId: number,
        orgId: number,
    ): Promise<{ agentCardId: number; agentCardName: string }> {
        const listing = await this.getById(listingId, true);
        const snapshot = listing.agentCardSnapshot as Record<string, unknown>;

        if (!snapshot) {
            throw new ValidationError("Listing has no agent card snapshot");
        }

        // Clone the card into the target org
        const card = await agentCardService.create(orgId, {
            name: String(snapshot.name ?? listing.name),
            description: String(snapshot.description ?? listing.description ?? ""),
            personaType: String(snapshot.personaType ?? "general") as any,
            capabilities: Array.isArray(snapshot.capabilities) ? snapshot.capabilities as string[] : [],
            tools: Array.isArray(snapshot.tools) ? snapshot.tools as any[] : [],
            // A snapshot is whatever was stored when the listing was published, so its
            // affinities are checked against the categories rather than trusted: an
            // unknown one would fail the card's own validation on install.
            topicAffinities: keepKnown(snapshot.topicAffinities, topicCategories),
            intentAffinities: keepKnown(snapshot.intentAffinities, intentCategories),
        });

        // Counted in the database, not in this process: two orgs installing at the
        // same time both read the same installCount, so `read + 1` would record one
        // install. Awaited, because a floating write can outlive the request.
        await db.update(marketplaceListings)
            .set({ installCount: sql`${marketplaceListings.installCount} + 1`, updatedAt: new Date() })
            .where(eq(marketplaceListings.id, listingId))
            .catch((err) => logger.warn("Failed to increment install_count", { err, listingId }));

        logger.info("Marketplace listing installed", { listingId, orgId, agentCardId: card.id });
        return { agentCardId: card.id, agentCardName: card.name };
    }

    /**
     * Unpublish a listing (set isPublic = false). Caller must own the listing.
     */
    async unpublish(orgId: number, listingId: number): Promise<void> {
        const listing = await this.getById(listingId, false);
        if (listing.organizationId !== orgId) {
            throw new NotFoundError(`Marketplace listing ${listingId} not found`, "NOT_FOUND");
        }
        await db.update(marketplaceListings)
            .set({ isPublic: false, updatedAt: new Date() })
            .where(eq(marketplaceListings.id, listingId));

        logger.info("Marketplace listing unpublished", { listingId, orgId });
    }
}

export const marketplaceListingService = new MarketplaceListingService();
