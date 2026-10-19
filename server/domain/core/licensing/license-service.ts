
import jwt from "jsonwebtoken";
import { db } from "@server/database_service.js";
import { systemLicenses, type LicensePayload, licensePayloadSchema } from "@shared/schema/licensing.js";
import { eq, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LicenseService");

// HARDCODED PUBLIC KEY (For MVP - verify signature)
// In production, this should be loaded from ENV or a file
const PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq8...PLACEHOLDER_KEY...
-----END PUBLIC KEY-----`;

export interface LicenseStatus {
    type: "community" | "trial" | "enterprise" | "expired";
    plan: string;
    seats: number;
    features: string[];
    isActive: boolean;
    expiresAt?: Date;
    daysRemaining: number | null;
    message?: string;
    customerName?: string;
}

// Cache for license status to avoid excessive DB lookups
let licenseCache: { status: LicenseStatus; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const licenseService = {
    /**
     * Clear the license cache
     */
    clearCache() {
        licenseCache = null;
    },

    /**
     * Validate and Activate a License Key
     */
    async activateLicense(key: string): Promise<{ success: boolean; message: string; license?: any }> {
        try {
            // 1. Verify Signature & Expiration
            // We use 'any' cast because verify throws on invalid signature, but returns decoded payload
            const payload = jwt.verify(key, PUBLIC_KEY, {
                algorithms: ["RS256"],
                audience: "oddjob-app",
                issuer: "oddjob-licensing-authority"
            }) as unknown;

            // 2. Validate Payload Structure
            const verifiedPayload = licensePayloadSchema.parse(payload);

            // 3. Store in DB
            const [license] = await db.insert(systemLicenses).values({
                key,
                planType: verifiedPayload.data.plan,
                seats: String(verifiedPayload.data.seats),
                features: verifiedPayload.data.features,
                customerName: verifiedPayload.data.customerName,
                issuedAt: new Date(verifiedPayload.iat * 1000),
                expiresAt: verifiedPayload.exp ? new Date(verifiedPayload.exp * 1000) : undefined,
                isActive: true
            }).returning();

            logger.info(`License activated for ${verifiedPayload.data.customerName || "Unknown Customer"}`);
            const result = { success: true, message: "License activated successfully.", license };
            this.clearCache(); // Invalidate cache on change
            return result;

        } catch (error: any) {
            logger.warn(`License activation failed: ${error.message}`);
            return { success: false, message: `Invalid License: ${error.message}` };
        }
    },

    /**
     * Get the currently active effective license
     */
    async getEffectiveLicense(): Promise<LicenseStatus> {
        // 1. Check Cache
        const now = Date.now();
        if (licenseCache && (now - licenseCache.timestamp < CACHE_TTL)) {
            logger.debug("Returning cached license status");
            return licenseCache.status;
        }

        // 2. Cache miss - Get the latest active license
        const [license] = await db.select()
            .from(systemLicenses)
            .where(eq(systemLicenses.isActive, true))
            .orderBy(desc(systemLicenses.createdAt))
            .limit(1);

        let effective: LicenseStatus;

        if (!license) {
            effective = {
                type: "community",
                plan: "Community Edition",
                seats: 1000000, // Unlimited-ish
                features: [], // Basic features only
                isActive: true,
                daysRemaining: null
            };
        } else if (license.expiresAt && license.expiresAt < new Date()) {
            effective = {
                type: "expired",
                plan: license.planType,
                seats: 0,
                features: [],
                isActive: false,
                daysRemaining: 0,
                message: "License Expired",
                customerName: license.customerName || undefined
            };
        } else {
            const daysRemaining = license.expiresAt
                ? Math.max(0, Math.ceil((license.expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
                : null;

            if (license.planType === 'trial') {
                effective = {
                    type: "trial",
                    plan: "30-Day Trial",
                    seats: Number(license.seats),
                    features: license.features as string[],
                    isActive: true,
                    expiresAt: license.expiresAt || undefined,
                    daysRemaining,
                    customerName: license.customerName || undefined
                };
            } else {
                effective = {
                    type: "enterprise",
                    plan: license.planType,
                    seats: license.seats === "unlimited" ? Infinity : Number(license.seats),
                    features: license.features as string[],
                    isActive: true,
                    daysRemaining,
                    customerName: license.customerName || undefined
                };
            }
        }

        // Update cache before returning
        licenseCache = { status: effective, timestamp: now };
        return effective;
    },

    /**
     * Start a 30-Day Trial
     */
    async startTrial(): Promise<{ success: boolean; message: string; license?: any }> {
        // Check if any license already exists (trial or otherwise)
        const [existing] = await db.select()
            .from(systemLicenses)
            .limit(1);

        if (existing) {
            return { success: false, message: "A license or trial has already been activated." };
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const [license] = await db.insert(systemLicenses).values({
            key: `trial-${Math.random().toString(36).substring(7)}`,
            planType: 'trial',
            seats: "10",
            features: ["*"], // Trial gets full access
            customerName: "Trial Organization",
            issuedAt: new Date(),
            expiresAt,
            isActive: true
        }).returning();

        logger.info("30-day trial started.");
        const result = { success: true, message: "Trial started successfully.", license };
        this.clearCache(); // Invalidate cache on change
        return result;
    },

    /**
     * Check if a feature is enabled
     */
    async checkFeatureAccess(feature: string): Promise<boolean> {
        const license = await this.getEffectiveLicense();
        if (license.type === "community") return false; // Or default features
        if (!license.isActive) return false;

        // Super admin feature bypass could go here

        return license.features.includes(feature) || license.features.includes("*");
    }
};




