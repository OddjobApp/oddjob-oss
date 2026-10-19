import { Express } from "express";
import {
    registerAnalyticsRoutes,
    registerMonitoringRoutes,
    agentAnalyticsRouter,
    predictiveRouter,
    agentCritiquesRouter,
} from "../index.js";
import observabilityRouter from "../observability.js";
import analyticsRouter from "../analytics/index.js";
import { biManagementApiRouter } from "../../domain/behavioral-intelligence/external/management-api.route.js";
import cycleAnalyticsRouter from "../cycle-analytics.js";

export function registerAnalyticsRoutesHub(app: Express) {
    // --- General Analytics ---
    registerAnalyticsRoutes(app);
    registerMonitoringRoutes(app);
    app.use("/api/observability", observabilityRouter); // W3C Tracing

    // --- Specialized Analytics ---
    app.use("/api/agent", agentAnalyticsRouter);
    app.use("/api/predictive", predictiveRouter);
    app.use("/api/agent-critiques", agentCritiquesRouter);
    app.use("/api/behavioral", biManagementApiRouter);

    // --- Specialized Analytics & Local Predictions ---
    app.use("/api", cycleAnalyticsRouter);

    // --- Latent Feature Analytics (New) ---
    app.use("/api/analytics", analyticsRouter);
}


