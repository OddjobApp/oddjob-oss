/**
 * Routing a "build me something" message to the right creation surface.
 *
 * This was a 180-line cascade of if-return blocks where precedence was decided
 * by where a block happened to sit. It is now a table, and the useful property
 * of a table is that the order is inspectable — so what is pinned here is the
 * order, especially the two places where a message legitimately matches two
 * rules and only one of them is right.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { detectAssemblyIntent, resolveDirectiveForOutputIntent } = await import("../crew-assembly-directives.js");
const detect = (m: string) => detectAssemblyIntent(m);

describe("assembly gate", () => {
    it.each(["Can you help me build a distressed realestate flow?", "Identifying distressed properties?"])(
        "routes the property-discovery request to its domain surface: %s", (message) => {
            expect(detect(message)).toContain("RESIDENTIAL REAL ESTATE DISTRESS ASSEMBLY DIRECTIVE");
            expect(detect(message)).toContain('mount_signal_studio');
            expect(detect(message)).not.toContain('PRIMITIVE MODULE SURFACE DIRECTIVE');
        });
    it("says nothing about a message that is not asking for anything built", () => {
        expect(detect("what do you think about the quarterly numbers?")).toBe("");
        expect(detect("thanks, that helps")).toBe("");
        expect(detect("")).toBe("");
    });

    it("is case-insensitive", () => {
        expect(detect("BUILD ME A MORTGAGE CALCULATOR")).toBe(detect("build me a mortgage calculator"));
    });
});

describe("assembly directive precedence", () => {
    it("sends a form that records to a dataset to Form Studio, not to a dataset pod", () => {
        // "saves to a dataset" also names a dataset. Form Studio records which dataset a
        // form's responses belong to, so the form rule leads; falling through would mount
        // DatasetSchemaPod. (The end-to-end wiring and intake rules this replaced were
        // merged into the Form Studio rule when FullStackAssemblyPod was retired.)
        const out = detect("build a mortgage calculator that saves to a dataset");

        expect(out).toContain("FORM STUDIO DIRECTIVE");
        expect(out).not.toContain("mount_builder_pod(");
    });

    it("sends a pipeline that saves to a dataset, but names no form, to Flow Studio", () => {
        // This used to reach PipelineBuilderPod. That pod's Save button writes a
        // blueprint stage and no pipeline, so the request was answered with a
        // mock-up; propose_flow creates a real one from the org's jobs.
        const out = detect("build a pipeline that saves to a dataset");

        expect(out).toContain("FLOW STUDIO DIRECTIVE");
        expect(out).toContain("propose_flow");
        expect(out).not.toContain("FORM STUDIO DIRECTIVE");
    });

    it("prefers the deck over file generation when both match", () => {
        const out = detect("generate the deck as a pdf");

        expect(out).toContain("PRESENTATION DECK & DELIVERABLE DIRECTIVE");
        expect(out).not.toContain("FILE GENERATION DIRECTIVE");
    });

    it("needs both halves before it calls something full-stack", () => {
        // A dataset goal with nothing to build is not a wiring request.
        const out = detect("show me the dataset");
        expect(out).not.toContain("END-TO-END APPLICATION");
    });
});

describe("assembly directive routing", () => {
    const cases: Array<[string, string]> = [
        ["build a tip calculator", "FORM STUDIO DIRECTIVE"],
        ["mount an intake form", "FORM STUDIO DIRECTIVE"],
        ["build a form and add location to it", "FORM STUDIO DIRECTIVE"],
        ["assemble a slide deck for the board", "PRESENTATION DECK & DELIVERABLE DIRECTIVE"],
        ["build the daily brief", "PRESENTATION DECK & DELIVERABLE DIRECTIVE"],
        ["scaffold a whitepaper", "PRESENTATION DECK & DELIVERABLE DIRECTIVE"],
        ["build it then generate excel", "FILE GENERATION DIRECTIVE"],
        ["mount the x-ray diagram", "WORKFLOW DIAGRAM & X-RAY DIRECTIVE"],
        ["build a mermaid workflow diagram", "WORKFLOW DIAGRAM & X-RAY DIRECTIVE"],
        ["build an h3 hex map of the fleet", "SPATIAL MAP DIRECTIVE"],
        ["assemble a geofence heatmap", "SPATIAL MAP DIRECTIVE"],
        ["mount the starter packs in signal studio", "SIGNAL STUDIO INDUSTRY STARTER PACKS DIRECTIVE"],
        ["how to use industry packs in signal studio", "SIGNAL STUDIO INDUSTRY STARTER PACKS DIRECTIVE"],
        ["Show me weather app on the fly. Use mock data if you need to.", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["build a weather app on the fly", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["create a mortgage calculator on the fly", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        // A computation widget asked to be SHOWN is an instant app — the exact
        // phrasing that used to search the form registry and report "no such
        // form exists" while nothing rendered.
        ["show me a mortgage calculator", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["give me a currency converter", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["mortgage calculator", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["render a tip calculator", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["build an instant app dashboard with mock data", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["render a live data app for crypto", "ON-THE-FLY APP BUILDING DIRECTIVE"],
        ["I want maps to be displayed in CREW chat", "GEOGRAPHIC MAP VISUALIZATION DIRECTIVE"],
        ["show me a map of our facilities", "GEOGRAPHIC MAP VISUALIZATION DIRECTIVE"],
        ["render an interactive map with key locations", "GEOGRAPHIC MAP VISUALIZATION DIRECTIVE"],
    ];

    for (const [message, expected] of cases) {
        it(`routes "${message}"`, () => {
            expect(detect(message)).toContain(expected);
        });
    }
});

describe("output intent resolution for map", () => {
    it("resolves map output intent to GEOGRAPHIC MAP VISUALIZATION DIRECTIVE", () => {
        const out = resolveDirectiveForOutputIntent("map", "here are some locations");
        expect(out).toContain("GEOGRAPHIC MAP VISUALIZATION DIRECTIVE");
        expect(out).toContain("render_map");
    });
});

describe("builder pod fallback", () => {
    const cases: Array<[string, string]> = [
        ["build a new mission", "MissionBriefPod"],
        ["scaffold a campaign", "MissionBriefPod"],
        ["build a new operational cycle", "ScaffoldPackPod"],
        ["build out the agent roster", "AgenticHRPod"],
        ["build a governance policy with a hil gate", "HILGovernancePod"],
    ];

    for (const [message, pod] of cases) {
        it(`suggests ${pod} for "${message}"`, () => {
            const out = detect(message);
            expect(out).toContain("PRIMITIVE MODULE SURFACE DIRECTIVE");
            expect(out).toContain(`mount_builder_pod(podComponent: "${pod}")`);
        });
    }

    it("still reaches the pipeline pod for configuring a stage, which names no build verb", () => {
        const out = detect("configure the pipeline trigger");
        expect(out).toContain('mount_builder_pod(podComponent: "PipelineBuilderPod")');
    });

    it("falls back to the scaffold pod when nothing more specific matches", () => {
        const out = detect("mount the creation studio");
        expect(out).toContain('mount_builder_pod(podComponent: "ScaffoldPackPod")');
    });

    it("names every pod value it will accept, so the model cannot invent one", () => {
        const out = detect("mount the builder pod");
        for (const pod of [
            "MissionBriefPod",
            "ScaffoldPackPod",
            "AgenticHRPod",
            "PipelineBuilderPod",
            "HILGovernancePod",
            "DatasetSchemaPod",
            "DocumentDeckPod",
            "OntologyLinkTypePod",
        ]) {
            expect(out).toContain(pod);
        }
    });
});

describe("planning, decision, upskilling and tool pods", () => {
    // Reported: typing "I want to plan a project" mounted nothing. It failed at
    // three links — the keyword gate had no planning phrase, BUILDER_POD_RULES
    // had no ProjectPlanningPod entry, and the directive's advertised pod list
    // had drifted four pods behind mount_builder_pod's own enum.
    it("routes the reported phrase to ProjectPlanningPod", () => {
        const out = detect("I want to plan a project");
        expect(out).not.toBe("");
        expect(out).toContain("ProjectPlanningPod");
    });

    it("routes the other planning wordings too", () => {
        for (const msg of ["show me the project plan", "let's do project planning", "draft a roadmap", "what is the critical path"]) {
            expect(detect(msg), msg).toContain("ProjectPlanningPod");
        }
    });

    it("routes decision, upskilling and tool requests to their own pods", () => {
        expect(detect("build a decision matrix for the caching options")).toContain("DecisionMatrixPod");
        expect(detect("I want to upskill the data agent")).toContain("AgentUpskillingPod");
        expect(detect("scaffold a tool for the geocoding api")).toContain("ToolScaffoldPod");
    });

    it("does not steal messages the existing rules should win", () => {
        // Phrase-specific matchers: none of these contain a planning phrase.
        expect(detect("create a new mission")).toContain("MissionBriefPod");
        expect(detect("set up an operational cycle")).toContain("ScaffoldPackPod");
        expect(detect("configure the pipeline trigger")).toContain("PipelineBuilderPod");
        expect(detect("add a dataset schema")).toContain("DatasetSchemaPod");
    });

    it("routes Project Studio requests to its own mount tool", () => {
        for (const message of ["Open Project Studio", "Project Studio", "show me the project timeline", "open the project tracker"]) {
            const out = detect(message);
            expect(out, message).toContain("PROJECT STUDIO DIRECTIVE");
            expect(out, message).toContain("Call mount_project_studio");
            // Named only to forbid it.
            expect(out, message).toContain('DO NOT call mount_builder_pod(podComponent: "ProjectStudioPod")');
        }
    });

    it("leaves 'builder studio' and plan drafting to the builder pods", () => {
        expect(detect("builder studio")).toContain('mount_builder_pod(podComponent: "ProjectStudioPod")');
        expect(detect("I want to plan a project")).toContain('mount_builder_pod(podComponent: "ProjectPlanningPod")');
    });

    it("opens the studio rather than drafting a flow when a timeline names an automation", () => {
        expect(detect("create a project timeline for the automation rollout")).toContain("PROJECT STUDIO DIRECTIVE");
    });

    it("advertises every pod mount_builder_pod accepts", () => {
        // The directive is what steers the model; a pod missing here is
        // effectively unreachable even though the tool would accept it.
        const out = detect("I want to plan a project");
        for (const pod of ["ProjectPlanningPod", "ProjectStudioPod", "DecisionMatrixPod", "AgentUpskillingPod", "ToolScaffoldPod"]) {
            expect(out, pod).toContain(pod);
        }
    });
});

/**
 * Building a flow must reach propose_flow, not a builder pod. The pod's Save
 * button writes a blueprint stage and no pipeline, and the builder-pod directive
 * says "DO NOT call propose_*", so without this rule the tool was unreachable
 * for exactly the phrasing that should get it.
 */
describe("flow studio directive", () => {
    const reachesFlowStudio = (message: string) => {
        const out = detect(message);
        expect(out).toContain("FLOW STUDIO DIRECTIVE");
        expect(out).toContain("propose_flow");
        expect(out).toContain("list_jobs");
        // The directive names the pod in order to forbid it, so assert the
        // instruction rather than the absence of the string.
        expect(out).toContain('DO NOT call mount_builder_pod(podComponent: "PipelineBuilderPod")');
        expect(out).not.toContain("PRIMITIVE MODULE SURFACE DIRECTIVE");
    };

    it("claims a request to build a flow", () => reachesFlowStudio("build a flow that scores leads and emails the owner"));
    it("claims a workstream", () => reachesFlowStudio("assemble a workstream for onboarding"));
    it("claims an automation", () => reachesFlowStudio("set up an automation that syncs jira nightly"));

    it("leaves a form to Form Studio even when it names a pipeline", () => {
        // The Form Studio rule leads deliberately: this is a form, not a flow.
        const out = detect("build a calculator that saves to a pipeline");
        expect(out).not.toContain("FLOW STUDIO DIRECTIVE");
    });

    it("does not claim a message with no build verb", () => {
        expect(detect("configure the pipeline trigger")).not.toContain("FLOW STUDIO DIRECTIVE");
    });

    it("does not claim a request to run one", () => {
        // "run the lead pipeline" has no build verb, so it is not an assembly request.
        expect(detect("run the lead pipeline")).not.toContain("FLOW STUDIO DIRECTIVE");
    });
});

/**
 * Operating a browser is Computer Use Studio's. Without a rule, "automate the
 * browser" passed the gate on "automate", missed the flow rule and fell
 * through to the ScaffoldPackPod default.
 */
describe("computer use studio directive", () => {
    const reachesComputerStudio = (message: string) => {
        const out = detect(message);
        expect(out, message).toContain("COMPUTER USE STUDIO DIRECTIVE");
        expect(out, message).toContain("mount_computer_studio({ goal:");
        expect(out, message).not.toContain("PRIMITIVE MODULE SURFACE DIRECTIVE");
    };

    it("claims the named phrases", () => {
        for (const message of ["can you automate the browser to check our status page", "open computer use", "run this in a headless browser", "set up browser automation for the vendor portal", "use trycua for this"]) {
            reachesComputerStudio(message);
        }
    });

    it("claims a website paired with an operating verb", () => {
        reachesComputerStudio("automate filling in the supplier website every morning");
        reachesComputerStudio("automate: navigate to the carrier website and download the invoice");
    });

    it("leaves building a site to the other rules", () => {
        expect(detect("build a website where users fill out a form")).not.toContain("COMPUTER USE STUDIO DIRECTIVE");
    });

    it("leaves an automation with no browser to Flow Studio", () => {
        expect(detect("build an automation that updates the website nightly")).toContain("FLOW STUDIO DIRECTIVE");
        expect(detect("set up an automation that syncs jira nightly")).toContain("FLOW STUDIO DIRECTIVE");
    });

    it("does not open the gate on an ordinary mention of a browser", () => {
        expect(detect("the page works in my browser but not on mobile")).toBe("");
    });
});

/**
 * Map words open the gate only when the map rule claims the message. Bare
 * "map" was a substring gate keyword, so "sitemap", "bitmap" and "map out our
 * options" passed the gate, matched no rule, and got a ScaffoldPackPod directive.
 */
describe("map words and the gate", () => {
    it("does not treat words that merely contain 'map' as assembly requests", () => {
        for (const message of ["update the sitemap", "the bitmap looks blurry", "map out our options for Q3"]) {
            expect(detect(message), message).toBe("");
        }
    });

    it("still routes real map requests, including ones no gate keyword names", () => {
        for (const message of ["show a map of our offices", "plot the delivery locations", "store locator for our branches"]) {
            expect(detect(message), message).toContain("GEOGRAPHIC MAP VISUALIZATION DIRECTIVE");
        }
    });
});
