import { Express } from "express";
import {
    registerWebhookRoutes,
    registerSnapshotRoutes,
    registerFineTuningRoutes,
    registerHilRoutes,
    registerGmailRoutes,
    registerTemplateProposalRoutes,
} from "../index.js";

export function registerKnowledgeRoutes(app: Express) {
    // --- Assets & Data ---
    registerSnapshotRoutes(app);

    // --- Training & Loops ---
    registerFineTuningRoutes(app);
    registerHilRoutes(app);
    registerTemplateProposalRoutes(app);

    // --- Integrations (Knowledge-based) ---
    registerWebhookRoutes(app);
    registerGmailRoutes(app);
}

