import { pgTable, text, integer, timestamp, serial, jsonb, boolean } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const videoCritiques = pgTable("video_critiques", {
    id: serial("id").primaryKey(),
    videoId: text("video_id").notNull(),
    segmentId: integer("segment_id"), // Index of the transcript segment
    topic: text("topic"), // The topic/intent that triggered this video
    rating: integer("rating").notNull(), // -1 (bad), 1 (good)
    feedback: text("feedback"),
    feedbackReason: text("feedback_reason"), // e.g., "Out of date", "Too basic"

    // Lineage & Context
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    messageId: integer("message_id"), // Linked chat message

    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVideoCritiqueSchema = createInsertSchema(videoCritiques).omit({
    id: true,
    createdAt: true,
});

export type VideoCritique = typeof videoCritiques.$inferSelect;
export type InsertVideoCritique = typeof videoCritiques.$inferInsert;



