import { Express } from "express";
import { registerDiagnosisRoutes } from "../diagnoses.js";
import scoringRouter from "../scoring.js";
import usersRouter from "../users.js";
import alertsRouter from "../alerts.js";
import ollamaRouter from "../ollama.js";
import evaluationStudioRouter from "../evaluation-studio.js";
import dbMetricsRouter from "../db-metrics.js";
import adminSystemRouter from "../admin-system.js";
import documentationRouter from "../../domain/admin/documentation.route.js";
import chaosRouter from "../chaos.js";
import e2eTestsRouter from "../../domain/sdlc-pipeline/routes/e2e-tests.route.js";
import knowledgePacksRouter from "../../domain/knowledge-packs/knowledge-packs.route.js";


export async function registerAdminRoutesHub(app: Express) {
    // --- Management & Users ---
    const { default: adminRouter } = await import("../../domain/admin/admin.route.js");
    const { default: settingsRouter } = await import("../../domain/admin/settings.route.js");
    const { default: skillsRouter } = await import("../skills.js");
    
    app.use("/api/users", usersRouter);
    app.use("/api/admin", adminRouter);
    app.use("/api/admin", skillsRouter);
    app.use("/api", settingsRouter);

    // --- System Health & Diagnostics ---
    registerDiagnosisRoutes(app);
    app.use("/api/scoring", scoringRouter);
    app.use("/api/evaluation-studio", evaluationStudioRouter);
    app.use("/api/admin/alerts", alertsRouter);
    app.use("/api/admin/db-metrics", dbMetricsRouter);
    app.use("/api/system-admin-graph", adminSystemRouter);
    app.use("/api/documentation", documentationRouter);
    app.use("/api/knowledge-packs", knowledgePacksRouter);
    app.use("/api/health/e2e-tests", e2eTestsRouter);


    // Dependencies mount
    console.log("[AdminHub] Attempting to import admin-dependencies...");
    try {
        const { default: adminDependenciesRouter } = await import("../admin-dependencies.js");
        app.use("/api/admin/system/dependencies", adminDependenciesRouter);
        console.log("[AdminHub] admin-dependencies mounted.");
    } catch (err: any) {
        console.error("[AdminHub] Failed to load admin-dependencies:", err.message);
    }

    // --- AI Infrastructure ---
    app.use("/api/ollama", ollamaRouter);
    app.use("/api/chaos", chaosRouter);
}
