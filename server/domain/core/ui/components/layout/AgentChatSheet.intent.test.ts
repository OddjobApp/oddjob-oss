import { describe, expect, it } from "vitest";
import {
    buildEphemeralCopilotContext,
    buildIntentWelcomeContent,
    captureSelectedUiContext,
    derivePage,
    deriveSubPageContext,
    getCopilotContextSummary,
    getPageActions,
    parseAssistantRichResponse,
} from "./AgentChatSheet";

describe("AgentChatSheet intent context", () => {
    it("derives workstream screens and contextual actions", () => {
        const page = derivePage("/operations/workstreams/42");
        expect(page).toBe("pipeline_detail");
        expect(getPageActions(page)).toHaveLength(3);
    });

    it("builds an intent-first welcome from a prediction signal", () => {
        const content = buildIntentWelcomeContent(
            "mission_detail",
            getPageActions("mission_detail"),
            {
                title: "Investigate the blocked mission",
                description: "A recent workstream event indicates the mission is waiting on a decision.",
                confidence: 0.78,
            },
        );

        expect(content).toContain("Likely intent");
        expect(content).toContain("78% confidence");
        expect(content).toContain("Should I continue");
    });

    it("falls back to screen-relevant choices without claiming an inferred intent", () => {
        const content = buildIntentWelcomeContent("approvals", getPageActions("approvals"));
        expect(content).toContain("Decision inbox");
        expect(content).not.toContain("Likely intent");
        expect(content).toContain("Decision brief");
    });

    it("bounds ephemeral context before sending it to Copilot", () => {
        const context = buildEphemeralCopilotContext(
            {
                id: "signal-1",
                title: "T".repeat(300),
                description: "D".repeat(800),
                priority: "high",
                confidence: 0.82,
                vector: "C",
                context: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`key${index}`, index])),
            },
            [],
            [],
        );

        expect(context.activeIntervention?.title).toHaveLength(160);
        expect(context.activeIntervention?.description).toHaveLength(500);
        expect(Object.keys(context.activeIntervention?.context || {})).toHaveLength(8);
    });

    it("makes tenant, screen, and mode scope visible", () => {
        expect(getCopilotContextSummary("mission_detail", "/missions/9", "audit", 3)).toEqual([
            { label: "Org 3", detail: "Tenant scope" },
            { label: "Mission detail #9", detail: "/missions/9" },
            { label: "Mission detail", detail: "missions #9" },
            { label: "Audit", detail: "Review evidence, risks, policy gates, and traceability." },
        ]);
    });

    it("derives a named sub-page, active tab, and entity from the route", () => {
        expect(deriveSubPageContext("/platform-maintenance/documentation?tab=modules")).toEqual({
            key: "feature_documentation",
            label: "Feature documentation · modules",
            pathname: "/platform-maintenance/documentation",
            section: "platform-maintenance",
            tab: "modules",
            entityType: undefined,
            entityId: undefined,
        });

        expect(deriveSubPageContext("/knowledge/datasets/42")).toMatchObject({
            key: "dataset_detail",
            label: "Dataset detail",
            entityType: "datasets",
            entityId: "42",
        });
    });

    it("uses sub-page context in the intent-first opening", () => {
        const content = buildIntentWelcomeContent(
            "platform_maintenance",
            getPageActions("platform_maintenance"),
            null,
            "Feature documentation · modules",
        );
        expect(content).toContain("Feature documentation · modules");
    });

    it("prefers sub-page-specific prompt suggestions", () => {
        const subPage = deriveSubPageContext("/platform-maintenance/documentation?tab=modules");
        const actions = getPageActions("platform_maintenance", subPage);

        expect(actions.map(action => action.label)).toEqual([
            "Explain this module",
            "Find documentation gaps",
            "Plan documentation update",
        ]);
        expect(actions[0].prompt).toContain("Feature documentation · modules");
        expect(actions[0].prompt).not.toContain("{subPage}");
    });

    it("interpolates entity context into sub-page prompts", () => {
        const actions = getPageActions("knowledge_store", deriveSubPageContext("/knowledge/datasets/42"));
        expect(actions[0].prompt).toContain("datasets #42");
        expect(actions[1].label).toBe("Audit data quality");
    });

    it("falls back to parent-page prompts for uncatalogued sub-pages", () => {
        const actions = getPageActions("knowledge_store", deriveSubPageContext("/knowledge/custom-view"));
        expect(actions.map(action => action.label)).toEqual(["Find source", "Gap audit", "Attach context"]);
    });

    it("captures bounded selected UI entity context", () => {
        const row = document.createElement("button");
        row.dataset.entityType = "mission";
        row.dataset.entityId = "42";
        row.setAttribute("aria-label", "Blocked mission");
        document.body.appendChild(row);
        row.focus();

        expect(captureSelectedUiContext()).toMatchObject({
            elementLabel: "Blocked mission",
            elementRole: "button",
            entityType: "mission",
            entityId: "42",
        });
        row.remove();
    });

    it("recognizes an assembled instant-app surface returned by Copilot", () => {
        const response = JSON.stringify({
            type: "instant_app_surface",
            title: "Mission Dashboard",
            note: "",
            layout: "grid",
            blocks: [
                { module: "PlatformMissionsBlock", componentName: "Platform Missions Table (Self-Wiring)", props: {} },
                { module: "PlatformPipelineStatusBlock", componentName: "Platform Pipeline Status (Self-Wiring)", props: {} },
                { module: "PlatformDatasetTableBlock", componentName: "Platform Dataset Table (Self-Wiring)", props: {} },
            ],
        });

        const parsed = parseAssistantRichResponse(response);
        expect(parsed?.type).toBe("instant_app_surface");
        if (parsed?.type === "instant_app_surface") {
            expect(parsed.data.blocks).toHaveLength(3);
            expect(parsed.data.blocks.map(block => block.module)).toEqual([
                "PlatformMissionsBlock",
                "PlatformPipelineStatusBlock",
                "PlatformDatasetTableBlock",
            ]);
        }
    });

    it("parses single instant_app when module is provided via component or componentName fallback", () => {
        const response = JSON.stringify({
            type: "instant_app",
            component: "MissionControlTable",
            title: "Mission Control Table",
        });

        const parsed = parseAssistantRichResponse(response);
        expect(parsed?.type).toBe("instant_app");
        if (parsed?.type === "instant_app") {
            expect(parsed.data.module).toBe("MissionControlTable");
            expect(parsed.data.title).toBe("Mission Control Table");
        }
    });

    it("parses instant_app payload embedded within conversational markdown prose", () => {
        const prose = `Here is the Mission Control Table instant app you requested:

\`\`\`json
{
  "type": "instant_app",
  "componentName": "PlatformMissionsTable",
  "title": "Platform Missions"
}
\`\`\`

Hope this helps!`;

        const parsed = parseAssistantRichResponse(prose);
        expect(parsed?.type).toBe("instant_app");
        if (parsed?.type === "instant_app") {
            expect(parsed.data.module).toBe("PlatformMissionsTable");
            expect(parsed.data.title).toBe("Platform Missions");
        }
    });

    it("parses launch_tutorial payload returned by LLM or launch_score_tutorial tool", () => {
        const payload = JSON.stringify({
            type: "launch_tutorial",
            trackId: "operations-hub",
            title: "Guided Walkthrough: operations-hub",
            description: "Step-by-step tour of Operations Hub and Workstreams",
        });

        const parsed = parseAssistantRichResponse(payload);
        expect(parsed?.type).toBe("launch_tutorial");
        if (parsed?.type === "launch_tutorial") {
            expect(parsed.data.trackId).toBe("operations-hub");
            expect(parsed.data.title).toBe("Guided Walkthrough: operations-hub");
            expect(parsed.data.description).toBe("Step-by-step tour of Operations Hub and Workstreams");
        }
    });
});
