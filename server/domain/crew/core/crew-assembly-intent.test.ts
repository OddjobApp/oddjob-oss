import { describe, expect, it } from "vitest";
import { detectAssemblyIntent } from "./crew-assembly-directives.js";

/**
 * Tests for the assembly-intent detection that routes build/assemble/scaffold
 * requests to mount_builder_pod instead of list_installed_apps.
 *
 * It used to be a private method reached through `as any` on a freshly
 * constructed service; it is now an exported function, so these call it
 * directly.
 */
const detect = (msg: string): string => detectAssemblyIntent(msg);

describe("detectAssemblyIntent", () => {
    it("returns a routing directive for 'build' messages", () => {
        const result = detect("Can you build an incident response cycle?");
        expect(result).toContain("mount_builder_pod");
        expect(result).toContain("DO NOT call list_installed_apps");
    });

    it("returns a routing directive for 'assemble' messages", () => {
        const result = detect("Assemble an operational workflow for onboarding");
        expect(result).toContain("mount_builder_pod");
    });

    it("returns a routing directive for 'scaffold' messages", () => {
        const result = detect("Scaffold a deployment pipeline");
        expect(result).toContain("ScaffoldPackPod");
    });

    it("returns a routing directive for 'creation studio' messages", () => {
        const result = detect("Open the creation studio for me");
        expect(result).toContain("mount_builder_pod");
    });

    it("detects ScaffoldPackPod component names case-insensitively", () => {
        const result = detect("Mount the ScaffoldPackPod");
        expect(result).toContain("mount_builder_pod");
    });

    it("detects PipelineBuilderPod", () => {
        const result = detect("I need a PipelineBuilderPod for CI/CD");
        expect(result).toContain("mount_builder_pod");
    });

    it("detects 'operational cycle'", () => {
        const result = detect("Create an operational cycle for quarterly review");
        expect(result).toContain("mount_builder_pod");
    });

    it("detects 'workstream'", () => {
        const result = detect("Set up a new workstream for the security initiative");
        expect(result).toContain("mount_builder_pod");
    });

    it("leaves a pipeline-and-dataset request that names no form to the builder pods", () => {
        const result = detect("I now want the pipeline to save to a dataset");
        expect(result).toContain("PipelineBuilderPod");
        expect(result).not.toContain("FullStackAssemblyPod");
    });

    it("sends a calculator that saves to a dataset to Form Studio", () => {
        const result = detect("Can you build a mortgage calculator that save the calculation to a dataset");
        expect(result).toContain("FORM STUDIO DIRECTIVE");
        expect(result).toContain("mount_form_studio");
        // The honesty guard moved: form→dataset writes are now wired, so the
        // directive demands proof from actual submission results instead of
        // disclaiming the capability outright.
        expect(result).toContain("Inspect the saved bindings");
        expect(result).not.toContain("FullStackAssemblyPod");
    });

    it("sends a question about a calculator's pipeline to Form Studio", () => {
        const result = detect("Do the parameters from the tip calculator go to the pipeline?");
        expect(result).toContain("FORM STUDIO DIRECTIVE");
    });

    it("sends a calculator change to Form Studio rather than a throwaway intake card", () => {
        const result = detect("Add a location to the tip calculator");
        expect(result).toContain("FORM STUDIO DIRECTIVE");
        expect(result).toContain("DO NOT call render_intake_form");
    });

    it("routes signal studio starter packs requests to mount_signal_studio with view packs", () => {
        const result = detect("Can you train copilot how to use starter packs in Signal Studio?");
        expect(result).toContain("SIGNAL STUDIO INDUSTRY STARTER PACKS DIRECTIVE");
        expect(result).toContain('mount_signal_studio({ view: "packs", title: "Signal Studio Industry Starter Packs" })');
        expect(result).toContain("Residential Real Estate Distress & Acquisition");
        expect(result).toContain("Global Supply Chain & Logistics");
        expect(result).toContain("Regulatory, Sanctions & Trade Policy");
        expect(result).toContain("Macroeconomic & Central Banking");
        expect(result).toContain("Critical Cloud & Cybersecurity Resilience");
        expect(result).toContain("Severe Weather & Energy Grid Resilience");
        expect(result).toContain("Corporate Filings & Competitor Watchlist");
    });

    it("routes generic starter packs and industry packs queries to mount_signal_studio", () => {
        const result = detect("Show me the industry packs in Signal Studio");
        expect(result).toContain("SIGNAL STUDIO INDUSTRY STARTER PACKS DIRECTIVE");
        expect(result).toContain('mount_signal_studio({ view: "packs"');
    });

    it("routes residential real estate distress assembly requests to mount_signal_studio", () => {
        const result = detect("I want the residential realestate distress built in CREW using an assembly");
        expect(result).toContain("RESIDENTIAL REAL ESTATE DISTRESS");
        // Its own mount tool — mount_builder_pod rejects SignalStudioPod.
        expect(result).toContain("mount_signal_studio");
        expect(result).not.toContain('podComponent: "SignalStudioPod"');
    });

    it("routes signal response playbook and mitigation initiative dispatches to mount_signal_studio", () => {
        const result = detect('Initiate response playbook for signal "Maritime corridor congestion". Spin up mitigation initiative in Project Studio for affected enterprise assets.');
        expect(result).toContain("SIGNAL RESPONSE PLAYBOOK DIRECTIVE");
        expect(result).toContain("mount_signal_studio");
        expect(result).toContain("mount_project_studio");
    });

    it("routes market signal exposure footprint discussions to signal response playbook directive", () => {
        const result = detect('Let\'s analyze Market Signal "Port Congestion" in CA (Severity: High). What is our operational exposure footprint and recommended playbook?');
        expect(result).toContain("SIGNAL RESPONSE PLAYBOOK DIRECTIVE");
        expect(result).toContain("mount_signal_studio");
    });

    it("returns empty string for non-assembly messages", () => {
        expect(detect("What's the weather like today?")).toBe("");
    });

    it("returns empty string for app-launch messages", () => {
        // "Open the SDLC Workbench" should NOT trigger assembly routing
        expect(detect("Open the SDLC Workbench")).toBe("");
    });

    it("returns empty string for search/research messages", () => {
        expect(detect("Search for incidents from last week")).toBe("");
    });

    it("returns empty string for empty messages", () => {
        expect(detect("")).toBe("");
    });
});

describe("resolveDirectiveForOutputIntent", () => {
    it("falls back to detectAssemblyIntent when intent is auto or undefined", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        expect(resolveDirectiveForOutputIntent("auto", "Can you build an incident response cycle?")).toContain("mount_builder_pod");
        expect(resolveDirectiveForOutputIntent(undefined, "What's the weather like today?")).toBe("");
    });

    it("suppresses builder directives when intent is deliberate", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        const directive = resolveDirectiveForOutputIntent("deliberate", "Can you build an incident response cycle?");
        expect(directive).toBe("");
    });

    it("injects presentation deck directive for present intent", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        const directive = resolveDirectiveForOutputIntent("present", "Incident review");
        expect(directive).toContain("PRESENTATION DECK & DELIVERABLE DIRECTIVE");
        expect(directive).toContain("generate_presentation_deck");
    });

    it("injects on-the-fly app directive for build_app intent", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        const directive = resolveDirectiveForOutputIntent("build_app", "Mortgage calculator");
        expect(directive).toContain("ON-THE-FLY APP BUILDING DIRECTIVE");
        expect(directive).toContain("render_intake_form");
    });

    it("injects workflow diagram directive for diagram intent", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        const directive = resolveDirectiveForOutputIntent("diagram", "Architecture overview");
        expect(directive).toContain("WORKFLOW DIAGRAM & X-RAY DIRECTIVE");
        expect(directive).toContain("render_workflow_diagram");
    });

    it("injects scribe authoring directive for author_document intent", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        const directive = resolveDirectiveForOutputIntent("author_document", "Incident Postmortem PRD");
        expect(directive).toContain("SCRIBE STUDIO AUTHORING");
        expect(directive).toContain("mount_scribe_studio");
    });

    it("injects governance directive for audit_governance intent", async () => {
        const { resolveDirectiveForOutputIntent } = await import("./crew-assembly-directives.js");
        const directive = resolveDirectiveForOutputIntent("audit_governance", "Review security sign-offs");
        expect(directive).toContain("GOVERNANCE & HIL AUDIT DIRECTIVE");
    });
});
