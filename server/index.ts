import "./utils/dns-order.js"; // must precede any module that opens a socket
import express from "express";
import { setupMiddleware } from "./middleware/index.js";
import { BootstrapService } from "./core/bootstrap.service.js";
import { createLogger } from "./utils/logger.js";
import { kafkaRuntimeService } from "./domain/core/infrastructure/kafka-runtime.service.js";

const logger = createLogger("Server");

/**
 * Exported so the integration suites can mount it with supertest.
 *
 * A dozen of them already imported `app` from here; it was simply never
 * exported, so every one of those files failed to type-check while still
 * running (vitest strips types, so the import resolved at runtime).
 */
export const app = express();

// 1. Uncaught Exception & Rejection Handlers
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception (handled safely):", err?.message || err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection (handled safely):", reason);
});

// 2. Setup Middleware
setupMiddleware(app);

app.get('/test/alerts', async (req, res) => {
    try {
        const alertsRes = await fetch('http://localhost:5000/api/alerts');
        const alerts = await alertsRes.json();
        const historyRes = await fetch('http://localhost:5000/api/alerts/history');
        const history = await historyRes.json();
        res.json({ alerts, history });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Start Bootstrap Sequence
export const serverReady = BootstrapService.initialize(app)
  .then(({ port }) => {
    logger.info(`Server initialization complete. Ready on port ${port}`);
  })
  .catch((error) => {
    logger.error("FATAL: Server failed to start", error);
    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      throw error;
    }
    process.exit(1);
  });

// 4. Graceful Shutdown Handling
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  await kafkaRuntimeService.shutdown();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
