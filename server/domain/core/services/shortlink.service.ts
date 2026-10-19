import { db } from "@server/database_service.js";
import { shortlinks, shortlinkClicks, type Shortlink, type InsertShortlink } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import crypto from "crypto";

const logger = createLogger("ShortlinkService");

// ============================================================================
// SHORTLINK SERVICE
// URL Shortening & QR Code Management for Published Agents
// ============================================================================

const CODE_LENGTH = 6;
const MAX_GENERATION_ATTEMPTS = 10;

export interface CreateShortlinkOptions {
    resourceType: string;
    resourceId: string;
    organizationId: number;
    targetPath?: string;
    title?: string;
    description?: string;
    expiresAt?: Date;
    customCode?: string;
    qrCodeSize?: number;
    qrCodeColor?: string;
    qrCodeBgColor?: string;
    createdBy: string;
}

export interface ShortlinkStats {
    totalClicks: number;
    uniqueVisitors: number;
    lastClickedAt?: Date;
    clicksByDay: { date: string; count: number }[];
    topReferrers: { referrer: string; count: number }[];
    deviceBreakdown: { deviceType: string; count: number }[];
}

export const shortlinkService = {
    /**
     * Generate a random short code
     */
    generateCode(length: number = CODE_LENGTH): string {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let code = "";
        for (let i = 0; i < length; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    /**
     * Check if a code is available
     */
    async isCodeAvailable(code: string): Promise<boolean> {
        const existing = await db
            .select({ id: shortlinks.id })
            .from(shortlinks)
            .where(eq(shortlinks.code, code))
            .limit(1);
        return existing.length === 0;
    },

    /**
     * Generate a unique short code
     */
    async generateUniqueCode(): Promise<string> {
        for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i++) {
            const code = this.generateCode();
            if (await this.isCodeAvailable(code)) {
                return code;
            }
        }
        // Fallback: use timestamp + random for collision resistance
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(3).toString("hex").slice(0, 4);
        return `${timestamp}${random}`.slice(0, CODE_LENGTH + 2);
    },

    /**
     * Create a new shortlink
     */
    async create(options: CreateShortlinkOptions): Promise<Shortlink> {
        logger.info(`Creating shortlink for ${options.resourceType}:${options.resourceId}`);

        const code = options.customCode || await this.generateUniqueCode();

        if (options.customCode) {
            const available = await this.isCodeAvailable(code);
            if (!available) {
                throw new Error(`Short code '${code}' is already taken`);
            }
        }

        const [shortlink] = await db
            .insert(shortlinks)
            .values({
                code,
                resourceType: options.resourceType,
                resourceId: options.resourceId,
                organizationId: options.organizationId,
                targetPath: options.targetPath,
                title: options.title,
                description: options.description,
                expiresAt: options.expiresAt,
                qrCodeSize: options.qrCodeSize || 400,
                qrCodeColor: options.qrCodeColor || "#000000",
                qrCodeBgColor: options.qrCodeBgColor || "#FFFFFF",
                createdBy: options.createdBy,
                isActive: true,
                clickCount: 0,
            })
            .returning();

        logger.info(`Created shortlink ${shortlink.code} for ${options.resourceType}:${options.resourceId}`);
        return shortlink;
    },

    /**
     * Get a shortlink by code
     */
    async getByCode(code: string): Promise<Shortlink | null> {
        const [shortlink] = await db
            .select()
            .from(shortlinks)
            .where(and(
                eq(shortlinks.code, code),
                eq(shortlinks.isActive, true)
            ))
            .limit(1);

        if (!shortlink) return null;

        // Check expiration
        if (shortlink.expiresAt && new Date() > shortlink.expiresAt) {
            return null;
        }

        return shortlink;
    },

    /**
     * Get all shortlinks for a resource
     */
    async getByResource(resourceType: string, resourceId: string, organizationId: number): Promise<Shortlink[]> {
        return db
            .select()
            .from(shortlinks)
            .where(and(
                eq(shortlinks.resourceType, resourceType),
                eq(shortlinks.resourceId, resourceId),
                eq(shortlinks.organizationId, organizationId),
                eq(shortlinks.isActive, true)
            ))
            .orderBy(desc(shortlinks.createdAt));
    },

    /**
     * Record a click on a shortlink
     */
    async recordClick(shortlinkId: number, clickData: {
        ipAddress?: string;
        userAgent?: string;
        referrer?: string;
        country?: string;
        city?: string;
        deviceType?: string;
        browser?: string;
        os?: string;
    }): Promise<void> {
        await db.transaction(async (tx) => {
            // Record the click
            await tx.insert(shortlinkClicks).values({
                shortlinkId,
                ...clickData,
            });

            // Update click count and last clicked
            await tx
                .update(shortlinks)
                .set({
                    clickCount: sql`${shortlinks.clickCount} + 1`,
                    lastClickedAt: new Date(),
                })
                .where(eq(shortlinks.id, shortlinkId));
        });
    },

    /**
     * Get shortlink statistics
     */
    async getStats(shortlinkId: number): Promise<ShortlinkStats> {
        const clicks = await db
            .select()
            .from(shortlinkClicks)
            .where(eq(shortlinkClicks.shortlinkId, shortlinkId))
            .orderBy(desc(shortlinkClicks.clickedAt));

        // Calculate unique visitors (by IP)
        const uniqueIps = new Set(clicks.map(c => c.ipAddress).filter(Boolean));

        // Group by day
        const clicksByDay = clicks.reduce((acc, click) => {
            const date = click.clickedAt.toISOString().split("T")[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        // Top referrers
        const referrerCounts = clicks.reduce((acc, click) => {
            const ref = click.referrer || "Direct";
            acc[ref] = (acc[ref] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        // Device breakdown
        const deviceCounts = clicks.reduce((acc, click) => {
            const type = click.deviceType || "Unknown";
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            totalClicks: clicks.length,
            uniqueVisitors: uniqueIps.size,
            lastClickedAt: clicks[0]?.clickedAt,
            clicksByDay: Object.entries(clicksByDay)
                .map(([date, count]) => ({ date, count }))
                .sort((a, b) => a.date.localeCompare(b.date)),
            topReferrers: Object.entries(referrerCounts)
                .map(([referrer, count]) => ({ referrer, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
            deviceBreakdown: Object.entries(deviceCounts)
                .map(([deviceType, count]) => ({ deviceType, count }))
                .sort((a, b) => b.count - a.count),
        };
    },

    /**
     * Update QR code data URL
     */
    async updateQRCode(shortlinkId: number, qrCodeDataUrl: string): Promise<void> {
        await db
            .update(shortlinks)
            .set({
                qrCodeDataUrl,
                qrCodeGeneratedAt: new Date(),
            })
            .where(eq(shortlinks.id, shortlinkId));
    },

    /**
     * Delete a shortlink (soft delete by setting isActive = false)
     */
    async delete(shortlinkId: number, organizationId: number): Promise<boolean> {
        const result = await db
            .update(shortlinks)
            .set({ isActive: false })
            .where(and(
                eq(shortlinks.id, shortlinkId),
                eq(shortlinks.organizationId, organizationId)
            ));

        return (result.rowCount ?? 0) > 0;
    },

    /**
     * Get target URL for a shortlink
     */
    getTargetUrl(shortlink: Shortlink, baseUrl: string): string {
        const path = shortlink.targetPath || "";
        
        switch (shortlink.resourceType) {
            case "agent":
                return `${baseUrl}/a/${shortlink.resourceId}${path}`;
            case "app":
                return `${baseUrl}/app/${shortlink.resourceId}${path}`;
            case "mission":
                return `${baseUrl}/missions/${shortlink.resourceId}${path}`;
            case "pipeline":
                return `${baseUrl}/pipelines/${shortlink.resourceId}${path}`;
            default:
                return `${baseUrl}/${shortlink.resourceType}/${shortlink.resourceId}${path}`;
        }
    },
};

export default shortlinkService;
