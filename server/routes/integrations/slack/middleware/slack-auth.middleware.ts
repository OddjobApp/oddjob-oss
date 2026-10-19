/**
 * Slack Authentication Middleware
 * Verifies Slack request signatures
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "@server/utils/logger.js";
import crypto from "crypto";

const logger = createLogger("SlackAuthMiddleware");

/**
 * Verify Slack request signature using raw body
 * Slack signs the raw request body, not the parsed JSON
 */
export function verifySlackRequest(signature: string, timestamp: string, rawBody: Buffer | string): boolean {
    if (!process.env.SLACK_SIGNING_SECRET) {
        // In production, fail if secret is not configured
        if (process.env.NODE_ENV === 'production') {
            logger.error("SLACK_SIGNING_SECRET not set in production - rejecting request");
            return false;
        }
        // In development, warn but allow (for testing without Slack)
        logger.warn("SLACK_SIGNING_SECRET not set, skipping verification (development mode only)");
        return true;
    }

    // Check timestamp (prevent replay attacks) - 5 minute window
    const now = Math.floor(Date.now() / 1000);
    const timestampNum = parseInt(timestamp);
    if (isNaN(timestampNum) || Math.abs(now - timestampNum) > 300) {
        logger.warn(`Slack signature timestamp rejected: ${timestamp} (now: ${now})`);
        return false;
    }

    // Use raw body for signature calculation (critical for correct verification)
    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const sigBaseString = `v0:${timestamp}:${bodyString}`;
    const mySignature = "v0=" + crypto
        .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
        .update(sigBaseString)
        .digest("hex");

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(mySignature)
        );
    } catch {
        return false;
    }
}

/**
 * Express middleware for Slack signature verification
 * Uses rawBody from request (must be captured by body parser middleware)
 */
export function requireSlackSignature(req: Request, res: Response, next: NextFunction): void {
    const signature = req.headers["x-slack-signature"] as string;
    const timestamp = req.headers["x-slack-request-timestamp"] as string;

    if (!signature || !timestamp) {
        res.status(401).send("Unauthorized: Missing signature headers");
        return;
    }

    // Use rawBody for signature verification (set by express.json/urlencoded verify function)
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
        logger.error("rawBody not available - ensure express.json/urlencoded middleware has verify function");
        res.status(500).send("Server configuration error");
        return;
    }

    if (!verifySlackRequest(signature, timestamp, rawBody)) {
        logger.warn(`Invalid Slack signature from ${req.ip} - possible spoofing attempt`);
        res.status(401).send("Unauthorized: Invalid signature");
        return;
    }

    next();
}
