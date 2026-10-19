import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs } from './auth.js';
import { operationalCycles } from './operational-cycles.js';

export const resourcePools = pgTable("resource_pools", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(), // compute, dataset, credential, text, number
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    capacity: integer("capacity").default(10),
    currentUtilization: integer("current_utilization").default(0),
    metadata: jsonb("metadata").default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const resourceAllocations = pgTable("resource_allocations", {
    id: serial("id").primaryKey(),
    poolId: integer("pool_id").references(() => resourcePools.id, { onDelete: "cascade" }),
    cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    userId: text("user_id"),
    allocatedAt: timestamp("allocated_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    autoRelease: boolean("auto_release").default(false),
    usage: jsonb("usage").default({
        totalRequests: 0,
        lastUsed: null,
        successRate: 0,
        avgResponseTime: 0,
        totalTokens: 0
    }),
});

export const insertResourcePoolSchema = createInsertSchema(resourcePools).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertResourceAllocationSchema = createInsertSchema(resourceAllocations).omit({
    id: true,
    allocatedAt: true,
});

export type ResourcePool = typeof resourcePools.$inferSelect;
export type ResourceAllocation = typeof resourceAllocations.$inferSelect;


