
import { pgTable, serial, text, timestamp, boolean, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { orgs as organizations } from './auth.js';
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const mcpServers = pgTable("mcp_servers", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),

    // Transport Configuration
    transport: text("transport").notNull().default("stdio"), // 'stdio' | 'sse'

    // Stdio Configuration
    command: text("command"),
    args: jsonb("args").$type<string[]>(),
    env: jsonb("env").$type<Record<string, string>>(),

    // SSE Configuration
    url: text("url"),

    // Status & Metadata
    status: text("status").notNull().default("inactive"), // 'active', 'inactive', 'error', 'connecting'
    lastConnectedAt: timestamp("last_connected_at"),
    error: text("error"),

    // Standard Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const mcpServersRelations = relations(mcpServers, ({ one }) => ({
    organization: one(organizations, {
        fields: [mcpServers.organizationId],
        references: [organizations.id],
    }),
}));

// Zod Schemas
export const insertMcpServerSchema = createInsertSchema(mcpServers).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    lastConnectedAt: true,
    error: true,
    status: true
});

export const selectMcpServerSchema = createSelectSchema(mcpServers);

export type McpServer = typeof mcpServers.$inferSelect;
export type InsertMcpServer = typeof mcpServers.$inferInsert;



