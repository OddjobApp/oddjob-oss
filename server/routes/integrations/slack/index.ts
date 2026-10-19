/**
 * Slack Integration Routes - Aggregated Export
 * 
 * This module exports all Slack integration routes as a single router.
 * Routes are organized by concern:
 * - OAuth: Installation and callback
 * - Commands: Slash commands (/oddjob)
 * - Interactions: Button clicks and modals
 * - Events: Slack Events API
 * - Workspaces: Workspace management
 * - Notifications: Manual notifications and history
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import oauthRoutes from "./oauth.routes.js";
import commandRoutes from "./commands.routes.js";
import interactionRoutes from "./interactions.routes.js";
import eventRoutes from "./events.routes.js";
import workspaceRoutes from "./workspace.routes.js";
import notificationRoutes from "./notification.routes.js";
import statusRoutes from "./status.routes.js";

const router = Router();

// Slack webhook rate limiter: 100 requests per minute per IP
// Slack webhooks are bursty but shouldn't exceed this rate
const slackWebhookRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: "Too many requests from this IP, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    // The default key is the client IP (IPv6 collapsed to its /56). Adding the
    // body's team_id let any caller pick a fresh limit by changing that field.
});

// Mount all sub-routers
router.use(oauthRoutes);

// Apply rate limiting to webhook endpoints that receive traffic from Slack
router.use(slackWebhookRateLimit);
router.use(commandRoutes);
router.use(interactionRoutes);
router.use(eventRoutes);

// Routes that don't need rate limiting (admin/internal operations)
router.use(workspaceRoutes);
router.use(notificationRoutes);
router.use("/status", statusRoutes);

export default router;

// Also export individual routers for selective mounting
export {
    oauthRoutes,
    commandRoutes,
    interactionRoutes,
    eventRoutes,
    workspaceRoutes,
    notificationRoutes,
    statusRoutes,
};
