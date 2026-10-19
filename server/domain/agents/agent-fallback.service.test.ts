/**
 * Fallback derivation rules.
 *
 * These assert the two properties the whole limp-mode design rests on:
 *   - EVERY agent gets at least one route, whatever it declares. An agent with
 *     no forms, no pipelines and no tools still answers under an outage.
 *   - invoke_tool routes are only ever derived for tools that cannot act. With
 *     no model in the loop nothing is choosing arguments, so anything that
 *     mutates state or needs input must not be reachable this way.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { agentFallbackService, type DerivationInput } from "./agent-fallback.service.js";

const bareAgent: DerivationInput = {
    slug: "bare-agent",
    title: "Bare Agent",
    formManifest: {},
    allowedPipelineIds: [],
    allowedTools: [],
};

const withForms: DerivationInput = {
    ...bareAgent,
    slug: "dispatch-agent",
    title: "Dispatch Agent",
    formManifest: {
        "19": {
            pipelineName: "Service Dispatch Pipeline — Process Incident Intake",
            fields: [{ name: "address", label: "Incident Address", type: "location", required: true }],
        },
    },
    allowedPipelineIds: [19],
};

const TOOL_REGISTRY = {
    list_missions: {
        name: "list_missions",
        label: "List Missions",
        idempotency: "read-safe",
        parameters: z.object({ limit: z.number().optional() }),
    },
    get_asset_specs: {
        name: "get_asset_specs",
        label: "Get Asset Specs",
        // Required arg — nothing can supply it without a model.
        parameters: z.object({ serialNumber: z.string() }),
    },
    delete_dataset: {
        name: "delete_dataset",
        label: "Delete Dataset",
        riskLevel: "high",
        parameters: z.object({ id: z.number().optional() }),
    },
    approve_payment: {
        name: "approve_payment",
        label: "Approve Payment",
        approvalPolicy: { requiresApproval: true },
        parameters: z.object({}),
    },
};

describe("agentFallbackService.buildManifest", () => {
    it("always produces a terminal route, even for an agent that declares nothing", () => {
        const manifest = agentFallbackService.buildManifest(bareAgent);

        expect(manifest.routes.length).toBeGreaterThan(0);
        const terminal = manifest.routes.at(-1)!;
        expect(terminal.kind).toBe("static_reply");
        expect(terminal.match.always).toBe(true);
        expect(terminal.message).toContain("Bare Agent");
    });

    it("derives a form route and a submission route from an agent's own declarations", () => {
        const manifest = agentFallbackService.buildManifest(withForms);

        const submission = manifest.routes.find(r => r.kind === "run_pipeline");
        expect(submission?.match.onFormSubmission).toBe(true);

        const form = manifest.routes.find(r => r.kind === "serve_form");
        expect(form?.formId).toBe("19");
        // Keywords come from the pipeline name, minus stopwords like "pipeline".
        expect(form?.match.keywords).toContain("dispatch");
        expect(form?.match.keywords).not.toContain("pipeline");
    });

    it("derives invoke_tool ONLY for read-safe, argument-free, low-risk tools", () => {
        const manifest = agentFallbackService.buildManifest(
            { ...bareAgent, allowedTools: Object.keys(TOOL_REGISTRY) },
            TOOL_REGISTRY,
        );

        const toolRoutes = manifest.routes.filter(r => r.kind === "invoke_tool").map(r => r.tool);

        expect(toolRoutes).toEqual(["list_missions"]);
        expect(toolRoutes).not.toContain("get_asset_specs");  // required argument
        expect(toolRoutes).not.toContain("delete_dataset");   // high risk
        expect(toolRoutes).not.toContain("approve_payment");  // needs approval
    });

    it("marks every derived route as derived so redeploys can regenerate safely", () => {
        const manifest = agentFallbackService.buildManifest(withForms, TOOL_REGISTRY);
        expect(manifest.routes.every(r => r.source === "derived")).toBe(true);
        expect(manifest.version).toBe(1);
    });
});

describe("agentFallbackService.selectRoute", () => {
    const manifest = agentFallbackService.buildManifest(withForms, TOOL_REGISTRY);

    it("binds form submissions to the submission route, ignoring message text", () => {
        const route = agentFallbackService.selectRoute(manifest, "[FORM_SUBMISSION] anything at all", {
            isFormSubmission: true,
        });
        expect(route?.kind).toBe("run_pipeline");
    });

    it("matches a form by keyword for a free-text turn", () => {
        const route = agentFallbackService.selectRoute(manifest, "I need a service dispatch for my generator", {
            isFormSubmission: false,
        });
        expect(route?.kind).toBe("serve_form");
        expect(route?.formId).toBe("19");
    });

    it("falls to the terminal route when nothing matches", () => {
        const route = agentFallbackService.selectRoute(manifest, "what is the weather like", {
            isFormSubmission: false,
        });
        expect(route?.kind).toBe("static_reply");
    });

    it("returns null for an agent with no manifest, so callers can still try the model", () => {
        expect(agentFallbackService.selectRoute(null, "hello", { isFormSubmission: false })).toBeNull();
        expect(
            agentFallbackService.selectRoute({ version: 1, generatedAt: "", degradedNotice: "", routes: [] }, "hello", {
                isFormSubmission: false,
            }),
        ).toBeNull();
    });
});
