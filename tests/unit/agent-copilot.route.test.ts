import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import agentCopilotRouter from "../../server/domain/ai/routes/agent-copilot.route.js";

describe("Agent Copilot Express Route API Integration Suite", () => {
    const app = express();
    app.use(express.json());
    app.use("/api/agent-copilot", agentCopilotRouter);

    it("POST /api/agent-copilot/chat should process valid chat requests", async () => {
        const res = await request(app)
            .post("/api/agent-copilot/chat")
            .send({
                userId: "user_test",
                userMessage: "What is the status of the dispatch system?",
                mode: "explain"
            });

        expect(res.status).toBe(200);
        expect(res.body.systemPromptUsed).toBeDefined();
        expect(res.body.fingerprintUsed).toBeDefined();
    });

    it("POST /api/agent-copilot/chat should trigger governance block & GQE question on restricted actions", async () => {
        const res = await request(app)
            .post("/api/agent-copilot/chat")
            .send({
                userId: "user_operator",
                userMessage: "Deploy candidate agent to production immediately"
            });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("governance_block");
        expect(res.body.gqeQuestion).toBeDefined();
        expect(res.body.gqeQuestion.formAgentPayload.type).toBe("FormAgent");
    });

    it("GET /api/agent-copilot/state should return live readiness score & fingerprint", async () => {
        const res = await request(app).get("/api/agent-copilot/state");

        expect(res.status).toBe(200);
        expect(res.body.readinessScore).toBeDefined();
        expect(res.body.readinessGaps).toBeDefined();
    });

    it("POST /api/agent-copilot/evaluate-trajectory should return Prediction Engine trajectory score", async () => {
        const res = await request(app)
            .post("/api/agent-copilot/evaluate-trajectory")
            .send({
                currentState: { stage: "Diagnose", targetFileOrNode: "server/routes/dispatch.ts" },
                candidateNextStep: { stage: "Improve", targetFileOrNode: "server/routes/dispatch.ts", confidenceScore: 0.95 }
            });

        expect(res.status).toBe(200);
        expect(res.body.safeTransitionScore).toBeGreaterThan(0.8);
        expect(res.body.recommendedAction).toBe("auto_execute");
    });

    it("POST /api/agent-copilot/attestation should process FormAgent supervisor attestation", async () => {
        const res = await request(app)
            .post("/api/agent-copilot/attestation")
            .send({
                formId: "gqe_form_deploy_99",
                decision: "Approve Patch & Assign Ownership",
                attestationSignature: "sig_supervisor_alice",
                approverRole: "operations-supervisor"
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.unblockedStatus).toBe("unblocked_for_execution");
    });

    it("GET /api/agent-copilot/subgraph/:agentId should return scoped agent subgraph", async () => {
        const res = await request(app)
            .get("/api/agent-copilot/subgraph/emergency_dispatch_coordinator");

        expect(res.status).toBe(200);
        expect(res.body.agentId).toBe("emergency_dispatch_coordinator");
        expect(res.body.warmUpLatencyMs).toBeLessThan(100);
    });
});
