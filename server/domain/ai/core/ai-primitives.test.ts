import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentStateService } from "./agent-state.service.js";
import { contextWindowService } from "./context-window.service.js";
import { structuredOutputService } from "./structured-output.service.js";
import { runtimeEvalGateService } from "./runtime-eval-gate.service.js";
import { canonicalTraceService } from "./canonical-trace.service.js";
import { toolContractService } from "./tool-contract.service.js";
import { createRootTrace } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";

describe("AI primitive services", () => {
    it("creates and updates canonical agent state", () => {
        const state = agentStateService.create({
            id: "agent-run-1",
            goal: "Reconcile invoices",
            organizationId: 7,
            traceContext: { traceId: "a".repeat(32), spanId: "b".repeat(16) },
        });

        const updated = agentStateService.withMemory(state, {
            id: "mem-1",
            role: "memory",
            content: "Vendor A usually sends duplicate reminders.",
            trustLevel: "trusted",
            priority: 0.8,
            evidence: [],
            tainted: false,
        });

        expect(updated.workingMemory).toHaveLength(1);
        expect(updated.workingMemory[0].tokenEstimate).toBeGreaterThan(0);
        expect(updated.organizationId).toBe(7);
    });

    it("packs context by priority and reports dropped items", () => {
        const packet = contextWindowService.pack([
            {
                id: "low",
                role: "retrieval",
                content: "x".repeat(200),
                trustLevel: "retrieved",
                priority: 0.1,
                evidence: [],
                tainted: true,
            },
            {
                id: "high",
                role: "goal",
                content: "Ship the report",
                trustLevel: "trusted",
                priority: 1,
                evidence: [],
                tainted: false,
            },
        ], 20);

        expect(packet.items.map((item) => item.id)).toContain("high");
        expect(packet.dropped.map((item) => item.id)).toContain("low");
    });

    it("parses fenced structured output and validates schema", () => {
        const result = structuredOutputService.parse(
            "```json\n{\"ok\":true,\"score\":0.9}\n```",
            z.object({ ok: z.boolean(), score: z.number() }),
        );

        expect(result.success).toBe(true);
        expect(result.value?.score).toBe(0.9);
    });

    it("evaluates runtime gates with blockers", () => {
        const gate = runtimeEvalGateService.evaluate({
            subject: { type: "mission", id: "mission-1" },
            threshold: 0.8,
            metrics: { correctness: 1, safety: 1 },
            blockers: ["approval_missing"],
        });

        expect(gate.score).toBe(1);
        expect(gate.passed).toBe(false);
    });

    it("creates child canonical trace events", () => {
        const root = createRootTrace();
        const { traceContext, event } = canonicalTraceService.event({
            traceContext: root,
            type: "tool_call",
            status: "started",
            summary: "Calling CRM lookup",
        });

        expect(event.traceId).toBe(root.traceId);
        expect(event.parentSpanId).toBe(root.spanId);
        expect(traceContext.depth).toBe(root.depth + 1);
    });

    it("derives tool contracts from existing tool definitions", () => {
        const definition: ToolDefinition = {
            name: "send_invoice_email",
            description: "Send an invoice email",
            parameters: z.object({ invoiceId: z.string() }),
            execute: async () => "ok",
            riskLevel: "high",
            idempotency: "none",
            sideEffects: ["email", "external-api"],
            approvalPolicy: { requiresApproval: true },
            compensation: { toolName: "void_invoice_email" },
        };

        const envelope = toolContractService.envelope(definition, { invoiceId: "inv_1" });
        expect(envelope.contract.requiresApproval).toBe(true);
        expect(envelope.contract.hasRollback).toBe(true);
        expect(envelope.contract.sideEffects).toContain("email");
    });
});

