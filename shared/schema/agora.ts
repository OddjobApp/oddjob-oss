import { pgTable, serial, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { missions } from './missions/index.js'; // Assuming missions schema exists

export const agoraSessions = pgTable("agora_sessions", {
    id: serial("id").primaryKey(),
    missionId: integer("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
    canvasState: jsonb("canvas_state").default({ objects: [] }), // Store canvas objects, positions, etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    missionIdx: index("agora_mission_idx").on(table.missionId),
}));

export type AgoraSession = typeof agoraSessions.$inferSelect;


