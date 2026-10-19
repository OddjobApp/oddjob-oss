import { pgTable, serial, integer, text, jsonb, timestamp, index, varchar } from 'drizzle-orm/pg-core';
import { missions } from './missions/index.js';
import { appDeployments } from './apps.js'; // Corrected from agentDeployments

export const swarmTasks = pgTable("swarm_tasks", {
    id: serial("id").primaryKey(),
    missionId: integer("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
    requestingAgentId: integer("requesting_agent_id").references(() => appDeployments.id), // The agent that needs help
    description: text("description").notNull(), // Natural language description of the task
    status: varchar("status", { length: 50 }).default('open').notNull(), // open, assigned, completed, failed
    winningBidId: integer("winning_bid_id"), // Will be populated when a bid is accepted
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    missionIdx: index("swarm_tasks_mission_idx").on(table.missionId),
    statusIdx: index("swarm_tasks_status_idx").on(table.status),
}));

export const swarmBids = pgTable("swarm_bids", {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull().references(() => swarmTasks.id, { onDelete: "cascade" }),
    biddingAgentId: integer("bidding_agent_id").notNull().references(() => appDeployments.id), // The agent offering to help
    bidDetails: jsonb("bid_details"), // Can include proposed plan, cost, etc.
    status: varchar("status", { length: 50 }).default('pending').notNull(), // pending, accepted, rejected
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    taskIdx: index("swarm_bids_task_idx").on(table.taskId),
}));

export type SwarmTask = typeof swarmTasks.$inferSelect;
export type SwarmBid = typeof swarmBids.$inferSelect;


