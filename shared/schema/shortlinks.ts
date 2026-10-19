import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    boolean,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

// ============================================================================
// SHORTLINKS (URL Shortening & QR Codes for Published Agents)
// ============================================================================

export const shortlinks = pgTable("shortlinks", {
    id: serial("id").primaryKey(),
    
    // The short code (e.g., "a1b2c3")
    code: text("code").notNull(),
    
    // What type of resource this links to
    resourceType: text("resource_type").notNull().default("agent"), // 'agent', 'form', 'chat', 'app'
    
    // The target resource identifier (e.g., agent slug)
    resourceId: text("resource_id").notNull(),
    
    // Organization context
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    
    // Optional: specific page/mode within the resource
    targetPath: text("target_path"), // e.g., "/chat", "/form", null for main page
    
    // Metadata
    title: text("title"), // Display title for the link
    description: text("description"),
    
    // QR Code
    qrCodeDataUrl: text("qr_code_data_url"), // Base64 PNG data URL
    qrCodeGeneratedAt: timestamp("qr_code_generated_at"),
    
    // Analytics
    clickCount: integer("click_count").default(0),
    lastClickedAt: timestamp("last_clicked_at"),
    
    // Expiration
    expiresAt: timestamp("expires_at"),
    
    // Status
    isActive: boolean("is_active").default(true),
    
    // Custom branding for QR code
    qrCodeColor: text("qr_code_color").default("#000000"),
    qrCodeBgColor: text("qr_code_bg_color").default("#FFFFFF"),
    qrCodeSize: integer("qr_code_size").default(400),
    
    // Tracking
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    codeUnique: uniqueIndex("shortlinks_code_unique").on(table.code),
    resourceIdx: index("shortlinks_resource_idx").on(table.resourceType, table.resourceId),
    orgIdx: index("shortlinks_org_idx").on(table.organizationId),
    expiresIdx: index("shortlinks_expires_idx").on(table.expiresAt),
}));

export const insertShortlinkSchema = createInsertSchema(shortlinks, {
    code: z.string().min(4).max(16).regex(/^[a-zA-Z0-9_-]+$/, "Code must be alphanumeric with hyphens/underscores"),
    resourceType: z.enum(["agent", "form", "chat", "app", "mission", "pipeline"]),
    resourceId: z.string().min(1),
    targetPath: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    qrCodeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    qrCodeBgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    qrCodeSize: z.number().int().min(100).max(1000).optional(),
    expiresAt: z.date().optional(),
}).omit({
    id: true,
    clickCount: true,
    lastClickedAt: true,
    qrCodeDataUrl: true,
    qrCodeGeneratedAt: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    organizationId: true,
    isActive: true,
});

export type Shortlink = typeof shortlinks.$inferSelect;
export type InsertShortlink = z.infer<typeof insertShortlinkSchema>;

// ============================================================================
// SHORTLINK ANALYTICS (Click tracking)
// ============================================================================

export const shortlinkClicks = pgTable("shortlink_clicks", {
    id: serial("id").primaryKey(),
    shortlinkId: integer("shortlink_id").notNull().references(() => shortlinks.id, { onDelete: "cascade" }),
    
    // Click metadata
    clickedAt: timestamp("clicked_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    country: text("country"),
    city: text("city"),
    
    // Device info (parsed from user agent)
    deviceType: text("device_type"), // 'mobile', 'tablet', 'desktop'
    browser: text("browser"),
    os: text("os"),
}, (table) => ({
    shortlinkIdx: index("shortlink_clicks_shortlink_idx").on(table.shortlinkId),
    clickedAtIdx: index("shortlink_clicks_time_idx").on(table.clickedAt),
}));

export type ShortlinkClick = typeof shortlinkClicks.$inferSelect;


