import http from "node:http";
import { createLogger } from "@server/utils/logger.js";
import { previewProxy } from "../../../../middleware/preview-proxy.js";
import express from "express";

import { bindPortWithRetry } from "@server/utils/network-utils.js";

const logger = createLogger("DeploymentGateway");

/**
 * Mach 3: The Deployment Gateway Service
 * 
 * In a fully distributed environment, this service runs as a standalone
 * entry point specifically for forged applications.
 */
export const deploymentGatewayService = {
    server: null as http.Server | null,

    async start(port: number = 5005) {
        const app = express();

        // 1. Health checks
        app.get("/health", (req, res) => res.status(200).send("Gateway Operational"));

        // 2. The Deployment Bridge
        // This middleware handles the resolution of app slugs to internal container ports
        app.use(previewProxy);

        // 3. Fallback
        app.use((req, res) => {
            res.status(404).json({
                error: "Deployment Gateway: Route not handled.",
                path: req.path,
                tip: "Ensure your request starts with /forged/:slug/"
            });
        });

        const server = http.createServer(app);
        this.server = server;

        try {
            await bindPortWithRetry(server, port, {
                maxRetries: 5,
                retryDelayMs: 3000
            });
            logger.info(`[Mach 3] Deployment Gateway LIVE on port ${port}`);
        } catch (err: any) {
            logger.error(`[Mach 3] Failed to start Deployment Gateway (non-fatal): ${err.message}`, { port });
            // process.exit(1); // Do not crash the whole server if the gateway fails
        }
    },

    async shutdown() {
        if (this.server) {
            return new Promise<void>((resolve) => {
                this.server?.close(() => {
                    logger.info("Deployment Gateway shutdown complete.");
                    resolve();
                });
            });
        }
    }
};
