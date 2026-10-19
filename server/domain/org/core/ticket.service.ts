import { db } from "@server/database_service.js";
import {
    tickets,
    type Ticket,
    type InsertTicket,
} from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "@server/utils/auth-context.js";

/**
 * Service for managing support tickets
 */
export const ticketService = {
    /**
     * Create a new ticket
     */
    async create(input: InsertTicket, orgContext: OrgContext): Promise<Ticket> {
        return withQueryTracking("ticketService.create", async () => {
            const [ticket] = await db.insert(tickets).values({
                ...input,
                // organizationId: orgContext.organizationId, // Ticket schema doesn't have organizationId currently
            }).returning();
            return ticket;
        }, { table: "tickets", operation: "insert" });
    },

    /**
     * List tickets
     */
    async list(orgContext: OrgContext): Promise<Ticket[]> {
        return withQueryTracking("ticketService.list", async () => {
            // Since tickets don't have organizationId yet, filtering is limited.
            // For now, list all or based on userEmail if available.
            return db.select().from(tickets).orderBy(desc(tickets.createdAt));
        }, { table: "tickets", operation: "select" });
    },

    /**
     * Get ticket by ID
     */
    async getById(id: number, orgContext: OrgContext): Promise<Ticket> {
        return withQueryTracking("ticketService.getById", async () => {
            const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
            if (!ticket) throw new NotFoundError("Ticket not found");
            return ticket;
        }, { table: "tickets", operation: "select" });
    },

    /**
     * Update ticket
     */
    async update(id: number, data: Partial<InsertTicket>, orgContext: OrgContext): Promise<Ticket> {
        return withQueryTracking("ticketService.update", async () => {
            const [updated] = await db.update(tickets)
                .set({ ...data, updatedAt: new Date() })
                .where(eq(tickets.id, id))
                .returning();
            if (!updated) throw new NotFoundError("Ticket not found");
            return updated;
        }, { table: "tickets", operation: "update" });
    }
};


