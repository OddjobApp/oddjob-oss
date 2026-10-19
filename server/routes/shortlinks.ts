import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { shortlinks, agentDeployments, type Shortlink } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { NotFoundError, UnauthorizedError } from "@server/utils/errors.js";
import { shortlinkService } from "@server/domain/core/services/shortlink.service.js";
import { qrGenerator } from "@server/utils/qr-generator.js";
import { createRateLimiter } from "@server/middleware/rate-limiter.js";
import { requireAuth } from "@domain/auth/core/security.service.js";

export const shortlinksRouter = Router();

// Rate limiters
const apiRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 100 });
const redirectRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });

// ============================================================================
// PUBLIC REDIRECT ENDPOINT (No auth required)
// ============================================================================

/**
 * GET /s/:code
 * Redirect from short code to target URL
 */
shortlinksRouter.get("/s/:code", redirectRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;

    const shortlink = await shortlinkService.getByCode(code);

    if (!shortlink) {
        return res.status(404).json({ error: "Shortlink not found or expired" });
    }

    // Record the click with request info
    const userAgent = req.headers["user-agent"] || "";
    const referrer = req.headers["referer"] || "";
    const ipAddress = req.ip || req.socket.remoteAddress || "";

    // Simple device detection
    let deviceType = "desktop";
    if (/mobile|android|iphone|ipad|ipod/i.test(userAgent)) {
        deviceType = "mobile";
    } else if (/tablet|ipad/i.test(userAgent)) {
        deviceType = "tablet";
    }

    // Simple browser detection
    let browser = "Unknown";
    if (/chrome/i.test(userAgent)) browser = "Chrome";
    else if (/firefox/i.test(userAgent)) browser = "Firefox";
    else if (/safari/i.test(userAgent)) browser = "Safari";
    else if (/edge/i.test(userAgent)) browser = "Edge";

    // Simple OS detection
    let os = "Unknown";
    if (/windows/i.test(userAgent)) os = "Windows";
    else if (/macintosh|mac os/i.test(userAgent)) os = "macOS";
    else if (/linux/i.test(userAgent)) os = "Linux";
    else if (/android/i.test(userAgent)) os = "Android";
    else if (/ios|iphone|ipad/i.test(userAgent)) os = "iOS";

    // Record click asynchronously (don't wait)
    shortlinkService.recordClick(shortlink.id, {
        ipAddress,
        userAgent,
        referrer,
        deviceType,
        browser,
        os,
    }).catch(err => console.error("Failed to record click:", err));

    // Get target URL
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const targetUrl = shortlinkService.getTargetUrl(shortlink, baseUrl);

    // Redirect
    res.redirect(302, targetUrl);
}));

// ============================================================================
// API ENDPOINTS (Require authentication)
// ============================================================================

/**
 * GET /api/shortlinks
 * List all shortlinks for the user's organization
 */
shortlinksRouter.get("/api/shortlinks", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;

    const links = await db
        .select()
        .from(shortlinks)
        .where(and(
            eq(shortlinks.organizationId, organizationId),
            eq(shortlinks.isActive, true)
        ))
        .orderBy(desc(shortlinks.createdAt));

    // Add full URLs
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const enriched = links.map(link => ({
        ...link,
        shortUrl: `${baseUrl}/s/${link.code}`,
        targetUrl: shortlinkService.getTargetUrl(link, baseUrl),
    }));

    res.json(enriched);
}));

/**
 * GET /api/shortlinks/:id
 * Get a specific shortlink with stats
 */
shortlinksRouter.get("/api/shortlinks/:id", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;
    const shortlinkId = validateIdParam(req.params.id);

    const [shortlink] = await db
        .select()
        .from(shortlinks)
        .where(and(
            eq(shortlinks.id, shortlinkId),
            eq(shortlinks.organizationId, organizationId)
        ))
        .limit(1);

    if (!shortlink) {
        throw new NotFoundError("Shortlink not found");
    }

    // Get stats
    const stats = await shortlinkService.getStats(shortlinkId);

    // Add URLs
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    res.json({
        ...shortlink,
        shortUrl: `${baseUrl}/s/${shortlink.code}`,
        targetUrl: shortlinkService.getTargetUrl(shortlink, baseUrl),
        stats,
    });
}));

/**
 * POST /api/shortlinks
 * Create a new shortlink
 */
shortlinksRouter.post("/api/shortlinks", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;

    const {
        resourceType,
        resourceId,
        targetPath,
        title,
        description,
        expiresAt,
        customCode,
        generateQR = true,
        qrCodeSize = 400,
        qrCodeColor = "#000000",
        qrCodeBgColor = "#FFFFFF",
    } = req.body;

    if (!resourceType || !resourceId) {
        return res.status(400).json({ error: "resourceType and resourceId are required" });
    }

    // Create the shortlink
    const shortlink = await shortlinkService.create({
        resourceType,
        resourceId,
        organizationId,
        targetPath,
        title,
        description,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        customCode,
        qrCodeSize,
        qrCodeColor,
        qrCodeBgColor,
        createdBy: user.id,
    });

    // Generate QR code if requested
    if (generateQR && qrGenerator.isAvailable()) {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const targetUrl = shortlinkService.getTargetUrl(shortlink, baseUrl);

        const qrResult = await qrGenerator.generate(targetUrl, {
            width: qrCodeSize,
            height: qrCodeSize,
            color: {
                dark: qrCodeColor,
                light: qrCodeBgColor,
            },
        });

        if (qrResult) {
            await shortlinkService.updateQRCode(shortlink.id, qrResult.dataUrl);
            shortlink.qrCodeDataUrl = qrResult.dataUrl;
        }
    }

    res.status(201).json({
        ...shortlink,
        shortUrl: `${req.protocol}://${req.get("host")}/s/${shortlink.code}`,
    });
}));

/**
 * POST /api/shortlinks/:id/qr
 * Generate or regenerate QR code
 */
shortlinksRouter.post("/api/shortlinks/:id/qr", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;
    const shortlinkId = validateIdParam(req.params.id);

    const [shortlink] = await db
        .select()
        .from(shortlinks)
        .where(and(
            eq(shortlinks.id, shortlinkId),
            eq(shortlinks.organizationId, organizationId)
        ))
        .limit(1);

    if (!shortlink) {
        throw new NotFoundError("Shortlink not found");
    }

    if (!qrGenerator.isAvailable()) {
        return res.status(503).json({ error: "QR generation not available" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const targetUrl = shortlinkService.getTargetUrl(shortlink, baseUrl);

    const { size, color, bgColor } = req.body;

    const qrResult = await qrGenerator.generate(targetUrl, {
        width: size || shortlink.qrCodeSize || 400,
        height: size || shortlink.qrCodeSize || 400,
        color: {
            dark: color || shortlink.qrCodeColor || "#000000",
            light: bgColor || shortlink.qrCodeBgColor || "#FFFFFF",
        },
    });

    if (!qrResult) {
        return res.status(500).json({ error: "Failed to generate QR code" });
    }

    await shortlinkService.updateQRCode(shortlinkId, qrResult.dataUrl);

    res.json({
        qrCodeDataUrl: qrResult.dataUrl,
        width: qrResult.width,
        height: qrResult.height,
    });
}));

/**
 * DELETE /api/shortlinks/:id
 * Delete a shortlink
 */
shortlinksRouter.delete("/api/shortlinks/:id", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;
    const shortlinkId = validateIdParam(req.params.id);

    const deleted = await shortlinkService.delete(shortlinkId, organizationId);

    if (!deleted) {
        throw new NotFoundError("Shortlink not found");
    }

    res.json({ success: true, message: "Shortlink deleted" });
}));

// ============================================================================
// AGENT-SPECIFIC ENDPOINTS
// ============================================================================

/**
 * GET /api/agents/:slug/shortlinks
 * Get shortlinks for a specific agent
 */
shortlinksRouter.get("/api/agents/:slug/shortlinks", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;
    const { slug } = req.params;

    // Verify agent exists
    const [deployment] = await db
        .select()
        .from(agentDeployments)
        .where(and(
            eq(agentDeployments.slug, slug),
            eq(agentDeployments.organizationId, organizationId)
        ))
        .limit(1);

    if (!deployment) {
        throw new NotFoundError("Agent deployment not found");
    }

    const links = await shortlinkService.getByResource("agent", slug, organizationId);

    // Add full URLs
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const enriched = links.map(link => ({
        ...link,
        shortUrl: `${baseUrl}/s/${link.code}`,
        targetUrl: shortlinkService.getTargetUrl(link, baseUrl),
    }));

    res.json(enriched);
}));

/**
 * POST /api/agents/:slug/shortlinks
 * Create a shortlink for an agent
 */
shortlinksRouter.post("/api/agents/:slug/shortlinks", requireAuth, apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const organizationId = user.organizationId;
    const { slug } = req.params;

    // Verify agent exists
    const [deployment] = await db
        .select()
        .from(agentDeployments)
        .where(and(
            eq(agentDeployments.slug, slug),
            eq(agentDeployments.organizationId, organizationId)
        ))
        .limit(1);

    if (!deployment) {
        throw new NotFoundError("Agent deployment not found");
    }

    const {
        targetPath,
        title,
        description,
        expiresAt,
        customCode,
        generateQR = true,
        qrCodeSize = 400,
        qrCodeColor = "#000000",
        qrCodeBgColor = "#FFFFFF",
    } = req.body;

    // Create the shortlink
    const shortlink = await shortlinkService.create({
        resourceType: "agent",
        resourceId: slug,
        organizationId,
        targetPath,
        title: title || deployment.title,
        description: description || deployment.description,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        customCode,
        qrCodeSize,
        qrCodeColor,
        qrCodeBgColor,
        createdBy: user.id,
    });

    // Generate QR code if requested
    if (generateQR && qrGenerator.isAvailable()) {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const targetUrl = shortlinkService.getTargetUrl(shortlink, baseUrl);

        const qrResult = await qrGenerator.generate(targetUrl, {
            width: qrCodeSize,
            height: qrCodeSize,
            color: {
                dark: qrCodeColor,
                light: qrCodeBgColor,
            },
        });

        if (qrResult) {
            await shortlinkService.updateQRCode(shortlink.id, qrResult.dataUrl);
            shortlink.qrCodeDataUrl = qrResult.dataUrl;
        }
    }

    res.status(201).json({
        ...shortlink,
        shortUrl: `${req.protocol}://${req.get("host")}/s/${shortlink.code}`,
    });
}));

/**
 * GET /api/agents/:slug/qr
 * Get or generate QR code directly for an agent
 */
shortlinksRouter.get("/api/agents/:slug/qr", apiRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const {
        size = 400,
        color = "#000000",
        bgColor = "#FFFFFF",
        redirect = "/chat", // Default redirect path
    } = req.query;

    if (!qrGenerator.isAvailable()) {
        return res.status(503).json({ error: "QR generation not available" });
    }

    // Verify agent exists
    const [deployment] = await db
        .select()
        .from(agentDeployments)
        .where(and(
            eq(agentDeployments.slug, slug),
            eq(agentDeployments.isActive, true)
        ))
        .limit(1);

    if (!deployment) {
        throw new NotFoundError("Agent deployment not found");
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const targetUrl = redirect
        ? `${baseUrl}/a/${slug}${redirect}`
        : `${baseUrl}/a/${slug}`;

    const qrResult = await qrGenerator.generate(targetUrl, {
        width: parseInt(size as string),
        height: parseInt(size as string),
        color: {
            dark: color as string,
            light: bgColor as string,
        },
    });

    if (!qrResult) {
        return res.status(500).json({ error: "Failed to generate QR code" });
    }

    res.json({
        qrCodeDataUrl: qrResult.dataUrl,
        width: qrResult.width,
        height: qrResult.height,
        targetUrl,
    });
}));

export default shortlinksRouter;
