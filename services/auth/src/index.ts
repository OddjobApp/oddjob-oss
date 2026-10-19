/**
 * Auth Service
 * 
 * Standalone authentication microservice handling:
 * - User login/logout
 * - Registration
 * - Session management
 * - CSRF token generation
 * - Password reset flow
 * 
 * Port: 5001 (configurable via AUTH_SERVICE_PORT)
 */

import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import Redis from "ioredis";
import cors from "cors";
import helmet from "helmet";

import { registerAuthRoutes } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware";

// Configuration
const PORT = parseInt(process.env.AUTH_SERVICE_PORT || "5001", 10);
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const SESSION_SECRET = process.env.SESSION_SECRET || "insecure-dev-secret";
const NODE_ENV = process.env.NODE_ENV || "development";
const SESSION_IDLE_TIMEOUT_MINUTES = 20;
const SESSION_IDLE_TIMEOUT_SECONDS = SESSION_IDLE_TIMEOUT_MINUTES * 60;
const SESSION_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;

// Initialize Express
const app = express();

// Security headers
app.use(helmet());

// CORS - allow API gateway and frontend
app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5000"],
    credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Redis client for sessions
const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
});

// Session configuration with Redis store
app.use(session({
    store: new RedisStore({
        client: redis,
        prefix: "oddjob:sess:",
        ttl: SESSION_IDLE_TIMEOUT_SECONDS, // 20 minutes of inactivity
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: NODE_ENV === "production",
        httpOnly: true,
        sameSite: NODE_ENV === "production" ? "strict" : "lax",
        maxAge: SESSION_IDLE_TIMEOUT_MS,
    },
}));

// Health check (no auth required)
app.get("/health", (req: Request, res: Response) => {
    res.json({
        status: "ok",
        service: "auth-service",
        timestamp: new Date().toISOString(),
    });
});

// Register auth routes
registerAuthRoutes(app);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`[auth-service] Running on port ${PORT}`);
    console.log(`[auth-service] Environment: ${NODE_ENV}`);
    console.log(`[auth-service] Redis: ${REDIS_URL}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("[auth-service] Shutting down...");
    await redis.quit();
    process.exit(0);
});
