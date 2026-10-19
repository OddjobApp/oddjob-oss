/**
 * Minimal Express app factory for integration tests.
 * Loads only the job-enhancements routes to avoid pulling in the full server graph.
 */
import express from "express";
import session from "express-session";

export async function createApp() {
    const app = express();
    app.use(express.json());

    // Minimal session middleware so requireAuth doesn't crash
    app.use(session({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
    }));

    // Inject a test user session for routes that check req.user
    app.use((req: any, _res, next) => {
        // Simulate an authenticated session for tests
        if (req.headers.authorization === "Bearer test-token") {
            req.user = { id: 1, username: "testuser", defaultOrgId: 1 };
            req.session = req.session || {};
            (req.session as any).user = req.user;
        }
        next();
    });

    // Register only job-enhancement routes
    const { default: jobEnhancementsRouter } = await import("./routes/job-enhancements.js");
    app.use("/api/jobs", jobEnhancementsRouter);

    // Org-level and misc endpoints also referenced in the test
    const { default: orgRouter } = await import("./routes/job-enhancements.js");
    app.use("/api", orgRouter);

    return app;
}
