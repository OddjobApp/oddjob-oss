/**
 * Slack Integration Schema
 * Stores Slack workspace connections, commands, and notifications
 */

import { pgTable, serial, integer, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { orgs } from '../auth.js';

// Slack workspace connections
export const slackWorkspaces = pgTable("slack_workspaces", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id),
    
    // Slack credentials
    teamId: text("team_id").notNull().unique(),
    teamName: text("team_name").notNull(),
    botToken: text("bot_token").notNull(),
    userToken: text("user_token"),
    botUserId: text("bot_user_id"),
    
    // Webhook configuration
    webhookUrl: text("webhook_url"),
    webhookChannel: text("webhook_channel"),
    
    // Settings
    isActive: boolean("is_active").notNull().default(true),
    defaultChannel: text("default_channel"),
    notifyOnMissionComplete: boolean("notify_on_mission_complete").default(true),
    notifyOnJobFailure: boolean("notify_on_job_failure").default(true),
    notifyOnApproval: boolean("notify_on_approval").default(true),
    notifyOnAppLaunched: boolean("notify_on_app_launched").default(true),
    
    // Metadata
    installedBy: integer("installed_by"),
    installedAt: timestamp("installed_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    orgIdx: index("slack_workspaces_org_idx").on(t.organizationId),
    teamIdx: index("slack_workspaces_team_idx").on(t.teamId),
}));

// Slack slash command log
export const slackCommands = pgTable("slack_commands", {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => slackWorkspaces.id).notNull(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id),
    
    // Command details
    command: text("command").notNull(), // /oddjob run, /oddjob status, etc.
    text: text("text"), // Arguments after command
    responseUrl: text("response_url").notNull(),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name"),
    userId: text("user_id").notNull(),
    userName: text("user_name"),
    teamId: text("team_id").notNull(),
    triggerId: text("trigger_id"),
    
    // Response tracking
    responseStatus: text("response_status").default("pending"), // pending, sent, failed
    responseBody: jsonb("response_body"),
    
    // Context
    jobId: integer("job_id"),
    missionId: integer("mission_id"),
    collectionId: integer("collection_id"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    workspaceIdx: index("slack_commands_workspace_idx").on(t.workspaceId),
    orgIdx: index("slack_commands_org_idx").on(t.organizationId),
    commandIdx: index("slack_commands_cmd_idx").on(t.command),
    createdIdx: index("slack_commands_created_idx").on(t.createdAt),
}));

// Slack interactions (button clicks, modal submissions)
export const slackInteractions = pgTable("slack_interactions", {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => slackWorkspaces.id).notNull(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id),
    
    // Interaction details
    type: text("type").notNull(), // block_actions, view_submission, etc.
    actionId: text("action_id"), // Button action ID
    blockId: text("block_id"),
    callbackId: text("callback_id"),
    
    // User context
    userId: text("user_id").notNull(),
    userName: text("user_name"),
    channelId: text("channel_id"),
    channelName: text("channel_name"),
    teamId: text("team_id").notNull(),
    
    // Payload
    payload: jsonb("payload").notNull(),
    
    // Action context
    actionType: text("action_type"), // approve, reject, run_job, etc.
    actionTargetId: integer("action_target_id"), // job_id, approval_id, etc.
    actionValue: text("action_value"),
    
    // Processing
    processedAt: timestamp("processed_at"),
    processedResult: jsonb("processed_result"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    workspaceIdx: index("slack_interactions_workspace_idx").on(t.workspaceId),
    orgIdx: index("slack_interactions_org_idx").on(t.organizationId),
    actionIdx: index("slack_interactions_action_idx").on(t.actionType),
    targetIdx: index("slack_interactions_target_idx").on(t.actionTargetId),
}));

// Slack notification log
export const slackNotifications = pgTable("slack_notifications", {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => slackWorkspaces.id).notNull(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id),
    
    // Notification details
    type: text("type").notNull(), // mission_complete, job_failed, approval_requested, etc.
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts"), // For threaded messages
    
    // Message content
    messageText: text("message_text"),
    messageBlocks: jsonb("message_blocks"),
    
    // Context
    jobId: integer("job_id"),
    missionId: integer("mission_id"),
    missionRunId: integer("mission_run_id"),
    collectionId: integer("collection_id"),
    approvalRequestId: integer("approval_request_id"),
    
    // Delivery tracking
    slackMessageTs: text("slack_message_ts"),
    deliveryStatus: text("delivery_status").default("pending"), // pending, delivered, failed
    errorMessage: text("error_message"),
    
    // Interaction tracking
    hasInteractiveBlocks: boolean("has_interactive_blocks").default(false),
    interactionsCount: integer("interactions_count").default(0),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
}, (t) => ({
    workspaceIdx: index("slack_notifications_workspace_idx").on(t.workspaceId),
    orgIdx: index("slack_notifications_org_idx").on(t.organizationId),
    typeIdx: index("slack_notifications_type_idx").on(t.type),
    jobIdx: index("slack_notifications_job_idx").on(t.jobId),
    missionIdx: index("slack_notifications_mission_idx").on(t.missionId),
    createdIdx: index("slack_notifications_created_idx").on(t.createdAt),
}));

// User-specific context (for switching orgs)
export const slackUserContexts = pgTable("slack_user_contexts", {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(), // Slack User ID
    teamId: text("team_id").notNull(), // Slack Team ID
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    userTeamIdx: index("slack_user_context_user_team_idx").on(t.userId, t.teamId),
}));

// Channel subscriptions (which channels get which notifications)
export const slackChannelSubscriptions = pgTable("slack_channel_subscriptions", {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => slackWorkspaces.id).notNull(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id),
    
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name"),
    
    // Subscription filters
    notifyMissions: boolean("notify_missions").default(true),
    notifyJobs: boolean("notify_jobs").default(true),
    notifyApprovals: boolean("notify_approvals").default(true),
    notifyCollections: boolean("notify_collections").default(true),
    notifyApps: boolean("notify_apps").default(true),
    
    // Filter by specific entities
    subscribedMissionIds: jsonb("subscribed_mission_ids"),
    subscribedJobIds: jsonb("subscribed_job_ids"),
    subscribedCollectionIds: jsonb("subscribed_collection_ids"),
    
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    workspaceIdx: index("slack_subscriptions_workspace_idx").on(t.workspaceId),
    channelIdx: index("slack_subscriptions_channel_idx").on(t.channelId),
    uniqueSub: index("slack_subscriptions_unique_idx").on(t.workspaceId, t.channelId),
}));

// Schemas
export const insertSlackWorkspaceSchema = createInsertSchema(slackWorkspaces).omit({
    id: true,
    installedAt: true,
    updatedAt: true,
});

export const insertSlackCommandSchema = createInsertSchema(slackCommands).omit({
    id: true,
    createdAt: true,
});

export const insertSlackInteractionSchema = createInsertSchema(slackInteractions).omit({
    id: true,
    createdAt: true,
    processedAt: true,
});

export const insertSlackNotificationSchema = createInsertSchema(slackNotifications).omit({
    id: true,
    createdAt: true,
    deliveredAt: true,
});

export const insertSlackChannelSubscriptionSchema = createInsertSchema(slackChannelSubscriptions).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertSlackUserContextSchema = createInsertSchema(slackUserContexts).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

// Types
export type SlackWorkspace = typeof slackWorkspaces.$inferSelect;
export type InsertSlackWorkspace = z.infer<typeof insertSlackWorkspaceSchema>;

export type SlackCommand = typeof slackCommands.$inferSelect;
export type InsertSlackCommand = z.infer<typeof insertSlackCommandSchema>;

export type SlackInteraction = typeof slackInteractions.$inferSelect;
export type InsertSlackInteraction = z.infer<typeof insertSlackInteractionSchema>;

export type SlackNotification = typeof slackNotifications.$inferSelect;
export type InsertSlackNotification = z.infer<typeof insertSlackNotificationSchema>;

export type SlackChannelSubscription = typeof slackChannelSubscriptions.$inferSelect;
export type InsertSlackChannelSubscription = z.infer<typeof insertSlackChannelSubscriptionSchema>;

export type SlackUserContext = typeof slackUserContexts.$inferSelect;
export type InsertSlackUserContext = z.infer<typeof insertSlackUserContextSchema>;


