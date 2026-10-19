import { describe, expect, it } from "vitest";
import {
    buildCopilotActionPreview,
    deriveCopilotEvidence,
    isExplicitAssistantFormRequest,
    isExplicitExternalResearchRequest,
    isReadOnlyAppPresentationRequest,
    normalizeCopilotMode,
} from "./copilot-contract.js";

describe("copilot-contract", () => {
    it("normalizes unknown and legacy planning modes to plan", () => {
        expect(normalizeCopilotMode("execute")).toBe("execute");
        expect(normalizeCopilotMode("planning")).toBe("plan");
        expect(normalizeCopilotMode("unknown")).toBe("plan");
    });

    it("recognizes explicit external research without treating ordinary internal questions as web research", () => {
        expect(isExplicitExternalResearchRequest("Research https://example.com/product and summarize it")).toBe(true);
        expect(isExplicitExternalResearchRequest("Look up this company on the web")).toBe(true);
        expect(isExplicitExternalResearchRequest("Explain the current mission")).toBe(false);
        expect(isExplicitExternalResearchRequest("Open the settings page")).toBe(false);
    });

    it("recognizes explicit inline form construction requests", () => {
        expect(isExplicitAssistantFormRequest("Create an inline assistant form to plan a governed mission")).toBe(true);
        expect(isExplicitAssistantFormRequest("Render an intake form for these missing fields")).toBe(true);
        expect(isExplicitAssistantFormRequest("Explain the existing form configuration")).toBe(false);
    });

    it("builds a governed action preview before live execution", () => {
        const preview = buildCopilotActionPreview("Approve and run this mission pipeline", {
            page: "mission_detail",
            missionId: 42,
        });

        expect(preview.risk).toBe("high");
        expect(preview.requiresApproval).toBe(true);
        expect(preview.targets).toContain("mission detail");
        expect(preview.targets).toContain("Mission 42");
        expect(preview.likelyTools).toContain("pipeline tools");
        expect(preview.likelyTools).toContain("mission tools");
    });

    it("does not require approval for listing or opening app surfaces", () => {
        expect(isReadOnlyAppPresentationRequest("List apps for TECHHEAD7")).toBe(true);
        expect(isReadOnlyAppPresentationRequest("Launch the SDLC workbench app from Assistant Chat")).toBe(true);
        expect(isReadOnlyAppPresentationRequest("List all installed applications to find the 'BudgetMaster App' and retrieve its URL (href).")).toBe(true);

        const preview = buildCopilotActionPreview("Launch workbench apps for TECHHEAD7", {
            page: "assistant_workbench",
        });

        expect(preview.risk).toBe("low");
        expect(preview.requiresApproval).toBe(false);
        expect(preview.likelyTools).toContain("app catalog tools");
        expect(preview.likelyTools).toContain("app card renderer");
    });

    it("does not require approval for installed application URL lookup", () => {
        const preview = buildCopilotActionPreview("List all installed applications to find the 'BudgetMaster App' and retrieve its URL (href).", {
            page: "assistant_workbench",
        });

        expect(preview.risk).toBe("low");
        expect(preview.requiresApproval).toBe(false);
        expect(preview.summary).toContain("read-only");
    });

    it("keeps side-effecting launches governed", () => {
        expect(isReadOnlyAppPresentationRequest("Launch the deployment for the workbench container")).toBe(false);

        const preview = buildCopilotActionPreview("Launch the deployment for the workbench container", {
            page: "appforge",
        });

        expect(preview.risk).toBe("high");
        expect(preview.requiresApproval).toBe(true);
    });

    it("uses provenance hints before derived fallback evidence", () => {
        const evidence = deriveCopilotEvidence({
            page: "cycle_detail",
            currentUrl: "/operations/cycles/7",
            provenanceHint: [{ label: "Cycle 7", source: "Operational cycle record" }],
        }, "EXECUTION_PREVIEW");

        expect(evidence).toEqual([{ label: "Cycle 7", source: "Operational cycle record" }]);
    });

    // --- Regression tests for fixed bugs ---

    it("[Bug 3] multi-clause messages with destructive verbs are not routed as read-only app presentation", () => {
        // The [\s\S]* was greedy and would match 'Delete' in clause 1 + 'app' in clause 2.
        // After fix: [^.!?\n]* is bounded per clause, so the overall match fails.
        expect(isReadOnlyAppPresentationRequest("Delete the mission. Show me the apps.")).toBe(false);
        expect(isReadOnlyAppPresentationRequest("Abort the pipeline. List all installed apps.")).toBe(false);
        expect(isReadOnlyAppPresentationRequest("Run the pipeline and then open the workbench app")).toBe(false);
        // Single-clause with only app-opening intent must still work
        expect(isReadOnlyAppPresentationRequest("Show me the budgetmaster app")).toBe(true);
        expect(isReadOnlyAppPresentationRequest("Open the analytics workbench")).toBe(true);
    });

    it("[Bug 4] infrastructure ops on 'app' are governed, not treated as read-only presentation", () => {
        // deploy/build/restart + app = infrastructure side effect
        expect(isReadOnlyAppPresentationRequest("Deploy the app")).toBe(false);
        expect(isReadOnlyAppPresentationRequest("Build the app")).toBe(false);
        expect(isReadOnlyAppPresentationRequest("Restart the application")).toBe(false);
        expect(isReadOnlyAppPresentationRequest("Stop the app")).toBe(false);
        expect(isReadOnlyAppPresentationRequest("Publish the app")).toBe(false);
        // plain launch/open the app must remain read-only
        expect(isReadOnlyAppPresentationRequest("Launch the budgetmaster app")).toBe(true);
        expect(isReadOnlyAppPresentationRequest("Open the app")).toBe(true);
    });

    it("[Bug 4] deploy/build/restart app produces high-risk action preview", () => {
        const preview = buildCopilotActionPreview("Deploy the app to production");
        expect(preview.risk).toBe("high");
        expect(preview.requiresApproval).toBe(true);
    });

    it("[Bug 5] high-risk verbs paired with side-effecting launches remain high-risk", () => {
        // launch + pipeline = high risk (not overridden by isReadOnlyAppPresentation)
        const preview = buildCopilotActionPreview("Launch the CI/CD pipeline");
        expect(preview.risk).toBe("high");
        // launch + app (read-only card) = correctly low risk
        const appPreview = buildCopilotActionPreview("Launch the budgetmaster app");
        expect(appPreview.risk).toBe("low");
        expect(appPreview.requiresApproval).toBe(false);
    });
});
