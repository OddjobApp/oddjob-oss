import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    salesAccounts,
    salesActivities,
    salesContacts,
    salesLeads,
    salesOpportunities,
    salesStageHistory,
    type InsertSalesAccount,
    type InsertSalesActivity,
    type InsertSalesContact,
    type InsertSalesLead,
    type InsertSalesOpportunity,
    type SalesAccount,
    type SalesContact,
    type SalesLead,
    type SalesOpportunity,
    type SalesStage,
} from "@shared/schema/index.js";
import { SALES_STAGE_ENTITLEMENT } from "./collections.js";

const TERMINAL_STAGES: SalesStage[] = ["CLOSED_WON", "CLOSED_LOST"];

function key(prefix: string): string {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export class SalesDomainService {
    async createAccount(input: Omit<InsertSalesAccount, "accountKey"> & { accountKey?: string }): Promise<SalesAccount> {
        const [account] = await db.insert(salesAccounts).values({
            ...input,
            accountKey: input.accountKey ?? key("acct"),
            updatedAt: new Date(),
        }).returning();
        return account;
    }

    async createContact(input: Omit<InsertSalesContact, "contactKey"> & { contactKey?: string }): Promise<SalesContact> {
        const [contact] = await db.insert(salesContacts).values({
            ...input,
            contactKey: input.contactKey ?? key("contact"),
            updatedAt: new Date(),
        }).returning();
        return contact;
    }

    async createLead(input: Omit<InsertSalesLead, "leadKey"> & { leadKey?: string }): Promise<SalesLead> {
        const [lead] = await db.insert(salesLeads).values({
            ...input,
            leadKey: input.leadKey ?? key("lead"),
            updatedAt: new Date(),
        }).returning();
        return lead;
    }

    async createOpportunity(
        input: Omit<InsertSalesOpportunity, "opportunityKey" | "stageEntitlement"> & {
            opportunityKey?: string;
            stageEntitlement?: number;
            changedBy?: string;
        },
    ): Promise<SalesOpportunity> {
        const { changedBy, opportunityKey, stageEntitlement, ...opportunityInput } = input;
        const now = new Date();
        const stage = opportunityInput.stage ?? "PROSPECT";
        const [opportunity] = await db.insert(salesOpportunities).values({
            ...opportunityInput,
            opportunityKey: opportunityKey ?? key("opp"),
            stage,
            stageEntitlement: stageEntitlement ?? SALES_STAGE_ENTITLEMENT[stage],
            openedAt: opportunityInput.openedAt ?? now,
            updatedAt: now,
        }).returning();

        await db.insert(salesStageHistory).values({
            organizationId: opportunity.organizationId,
            opportunityId: opportunity.id,
            fromStage: null,
            toStage: opportunity.stage,
            changedAt: now,
            changedBy: changedBy ?? "sales-domain",
            reason: "created",
        });

        return opportunity;
    }

    async advanceOpportunityStage(params: {
        organizationId: number;
        opportunityId: number;
        toStage: SalesStage;
        changedBy?: string;
        reason?: string;
    }): Promise<SalesOpportunity> {
        const [current] = await db.select().from(salesOpportunities).where(and(
            eq(salesOpportunities.organizationId, params.organizationId),
            eq(salesOpportunities.id, params.opportunityId),
        )).limit(1);

        if (!current) {
            throw new Error(`Sales opportunity ${params.opportunityId} not found for org ${params.organizationId}`);
        }

        const now = new Date();
        const [updated] = await db.update(salesOpportunities)
            .set({
                stage: params.toStage,
                stageEntitlement: SALES_STAGE_ENTITLEMENT[params.toStage],
                outcome: params.toStage === "CLOSED_WON" ? "won" : params.toStage === "CLOSED_LOST" ? "lost" : null,
                closedAt: TERMINAL_STAGES.includes(params.toStage) ? now : null,
                updatedAt: now,
            })
            .where(and(
                eq(salesOpportunities.organizationId, params.organizationId),
                eq(salesOpportunities.id, params.opportunityId),
            ))
            .returning();

        await db.insert(salesStageHistory).values({
            organizationId: params.organizationId,
            opportunityId: params.opportunityId,
            fromStage: current.stage,
            toStage: params.toStage,
            changedAt: now,
            changedBy: params.changedBy ?? "sales-domain",
            reason: params.reason,
        });

        return updated;
    }

    async listOpenOpportunities(organizationId: number): Promise<SalesOpportunity[]> {
        return db.select().from(salesOpportunities)
            .where(and(
                eq(salesOpportunities.organizationId, organizationId),
                inArray(salesOpportunities.stage, ["PROSPECT", "QUALIFIED", "PROPOSAL", "NEGOTIATION"]),
            ))
            .orderBy(desc(salesOpportunities.updatedAt));
    }

    async logActivity(input: Omit<InsertSalesActivity, "activityKey"> & { activityKey?: string }) {
        const [activity] = await db.insert(salesActivities).values({
            ...input,
            activityKey: input.activityKey ?? key("act"),
        }).returning();
        return activity;
    }
}

export const salesDomainService = new SalesDomainService();
