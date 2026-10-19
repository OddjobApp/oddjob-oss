import { describe, expect, it } from "vitest";
import { processSynthesisService } from "../process-synthesis.service.js";

/**
 * The reason the BPMN extractor was widened to flows and gateways: without
 * them a synthesiser has a bag of task names and has to INVENT the process.
 * These pin that the order and the branch rules actually survive into the draft.
 */

const invoiceGraph = {
    processName: "Invoice Approval",
    tasks: [
        { id: "t_pay", name: "Pay invoice", kind: "serviceTask", lane: "Finance" },
        { id: "t_review", name: "Review invoice", kind: "userTask", lane: "Finance" },
        { id: "t_log", name: "Write audit entry", kind: "scriptTask", lane: null },
    ],
    gateways: [{ id: "g1", name: "Over threshold?", kind: "exclusiveGateway", default: "f_log" }],
    flows: [
        { id: "f1", from: "start", to: "t_review", name: null, condition: null },
        { id: "f2", from: "t_review", to: "g1", name: null, condition: null },
        { id: "f_pay", from: "g1", to: "t_pay", name: "over", condition: "amount > 1000" },
        { id: "f_log", from: "g1", to: "t_log", name: null, condition: null },
    ],
    dataObjects: [{ id: "d1", name: "Invoice" }],
    events: [{ id: "start", name: "Invoice received", kind: "startEvent" }],
    lanes: [{ id: "l1", name: "Finance" }],
    entryPoints: ["start"],
    danglingFlows: [],
};

describe("processSynthesisService", () => {
    it("orders steps by following the flows, not by declaration order", () => {
        // Declared LAST-to-FIRST on purpose: only a flow traversal recovers the
        // real order, which is exactly what the old task-only extractor lost.
        const draft = processSynthesisService.synthesize({
            processName: "Onboarding",
            tasks: [
                { id: "c", name: "Provision access", kind: "serviceTask" },
                { id: "b", name: "Verify identity", kind: "scriptTask" },
                { id: "a", name: "Ingest application", kind: "receiveTask" },
            ],
            flows: [
                { id: "f1", from: "a", to: "b", name: null, condition: null },
                { id: "f2", from: "b", to: "c", name: null, condition: null },
            ],
            dataObjects: [{ id: "d", name: "Applicant" }],
        });

        expect(draft.steps.map((s) => s.name)).toEqual([
            "Ingest application",
            "Verify identity",
            "Provision access",
        ]);
    });

    it("turns a gateway condition into a condition on the step it gates", () => {
        const draft = processSynthesisService.synthesize(invoiceGraph);

        const pay = draft.steps.find((s) => s.name === "Pay invoice");
        expect(pay?.celCondition).toBe("amount > 1000");
        // The default path is genuinely unconditional.
        expect(draft.steps.find((s) => s.name === "Write audit entry")?.celCondition).toBeNull();
    });

    it("separates human work from automated work", () => {
        const draft = processSynthesisService.synthesize(invoiceGraph);

        // A userTask is someone supplying information — an input, not a step
        // the pipeline runs unattended.
        expect(draft.uiFields.map((f) => f.label)).toEqual(["Review invoice"]);
        expect(draft.steps.map((s) => s.name)).not.toContain("Review invoice");
    });

    it("maps task kinds onto job types the pipeline actually has", () => {
        const draft = processSynthesisService.synthesize(invoiceGraph);

        expect(draft.steps.find((s) => s.name === "Pay invoice")?.type).toBe("action_dispatch");
        expect(draft.steps.find((s) => s.name === "Write audit entry")?.type).toBe("transform");
    });

    it("carries the lane through as the step's agent", () => {
        const draft = processSynthesisService.synthesize(invoiceGraph);

        expect(draft.steps.find((s) => s.name === "Pay invoice")?.agent).toBe("Finance");
    });

    it("derives a DNS-safe app name, since it becomes a directory and a label", () => {
        const draft = processSynthesisService.synthesize(invoiceGraph);

        expect(draft.appName).toBe("invoice-approval");
        expect(draft.appName).toMatch(/^[a-z0-9-]+$/);
    });

    it("says when it could derive no schema rather than inventing columns", () => {
        const draft = processSynthesisService.synthesize({ ...invoiceGraph, dataObjects: [] });

        expect(draft.datasetFields).toEqual([]);
        expect(draft.warnings.join(" ")).toMatch(/no data objects/i);
    });

    it("reports an unconditioned branch instead of pretending the rule exists", () => {
        const draft = processSynthesisService.synthesize({
            ...invoiceGraph,
            gateways: [{ id: "g1", name: "Over threshold?", kind: "exclusiveGateway", default: null }],
        });

        expect(draft.warnings.join(" ")).toMatch(/no condition/i);
    });

    it("keeps every task when the process loops, rather than dropping the cycle", () => {
        const draft = processSynthesisService.synthesize({
            processName: "Rework Loop",
            tasks: [
                { id: "a", name: "Draft", kind: "scriptTask" },
                { id: "b", name: "Review", kind: "serviceTask" },
            ],
            // A rework loop is normal BPMN and has no topological order.
            flows: [
                { id: "f1", from: "a", to: "b", name: null, condition: null },
                { id: "f2", from: "b", to: "a", name: null, condition: null },
            ],
            dataObjects: [],
        });

        expect(draft.steps.map((s) => s.name).sort()).toEqual(["Draft", "Review"]);
        expect(draft.warnings.join(" ")).toMatch(/loop|order/i);
    });

    it("passes an incomplete diagram's dangling flows through as a warning", () => {
        const draft = processSynthesisService.synthesize({
            ...invoiceGraph,
            danglingFlows: [{ id: "fx", from: "t_pay", to: "missing" }],
        });

        expect(draft.warnings.join(" ")).toMatch(/incomplete/i);
    });

    it("keeps inferred provenance and its uncertainties in the draft", () => {
        const draft = processSynthesisService.synthesize({
            ...invoiceGraph,
            provenance: "inferred",
            uncertainties: ["The arrow after Review is ambiguous"],
        });

        // A process read from a picture must never look like a parsed one.
        expect(draft.provenance).toBe("inferred");
        expect(draft.warnings).toContain("The arrow after Review is ambiguous");
    });

    it("defaults to parsed provenance when none is stated", () => {
        expect(processSynthesisService.synthesize(invoiceGraph).provenance).toBe("parsed");
    });
});
