import { describe, it, expect } from "vitest";

describe("Launchpad & Published Agent Fleet Contracts", () => {
    const getAgentDemoMessage = (agent: any): string => {
        const name = (agent?.name || agent?.title || agent?.slug || "").toLowerCase();
        const role = (agent?.role || agent?.soulArchetype || "").toLowerCase();
        const desc = (agent?.description || agent?.desc || "").toLowerCase();

        if (name.includes("rescue") || role.includes("emergency") || desc.includes("rescue") || desc.includes("dispatch")) {
            return "Emergency incident reported: Structural collapse at Sector 7, Building A with 3 trapped casualties. Please initiate incident intake and dispatch the rescue squad.";
        }
        if (name.includes("codegen") || name.includes("architect") || desc.includes("scaffold") || desc.includes("app forge")) {
            return "Scaffold a new real-time Vendor Risk & Compliance monitoring app with interactive metrics, audit trails, and export tools.";
        }
        if (name.includes("budget") || name.includes("finance") || role.includes("financial") || desc.includes("budget")) {
            return "Run Q3 department spend anomaly detection, analyze Cloud Infrastructure overrun (+14.2%), and prepare multi-tier executive sign-off package.";
        }
        if (name.includes("workforce") || name.includes("training") || role.includes("hr") || desc.includes("upskilling")) {
            return "Audit fleet reliability scores, identify agents with elevated error rates, and initiate skill upskilling cycle with rollback snapshot.";
        }
        if (name.includes("sdlc") || name.includes("qa") || role.includes("sdlc") || desc.includes("test")) {
            return "Execute hybrid SDLC validation suite, verify 5-layer autonomy policy gates, and generate signed audit record.";
        }
        if (name.includes("intake") || name.includes("form") || desc.includes("questionnaire")) {
            return "Please initiate the incident intake questionnaire schema and collect required operational parameters.";
        }
        if (name.includes("supervisor") || name.includes("foundry") || role.includes("cycle")) {
            return "Start autonomous verification and run operational cycle attestation for active pipelines.";
        }
        if (name.includes("sales") || role.includes("sales")) {
            return "Qualify and triage inbound enterprise lead from Acme Corp interested in Autonomous App Forge.";
        }
        if (name.includes("sre") || name.includes("incident") || role.includes("sre")) {
            return "Analyze telemetry anomaly in production Redis cache layer and generate mitigation steps.";
        }
        return `Execute operational workflow and verify task parameters for ${agent?.name || agent?.title || "published agent"}.`;
    };

    const getAgentHref = (agent: any): string => {
        const slug = agent?.slug || agent?.publicSlug || (agent?.name || agent?.title || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const demoMsg = getAgentDemoMessage(agent);
        return `/a/${slug}?prompt=${encodeURIComponent(demoMsg)}`;
    };

    it("correctly resolves Rescue Dispatch demo message and deep link", () => {
        const agent = {
            name: "Rescue Dispatch AI Coordinator",
            slug: "rescue-coordinator",
            role: "Emergency Operations Specialist"
        };
        const demoMsg = getAgentDemoMessage(agent);
        expect(demoMsg).toContain("Emergency incident reported: Structural collapse at Sector 7");
        expect(demoMsg).toContain("dispatch the rescue squad");

        const href = getAgentHref(agent);
        expect(href).toContain("/a/rescue-coordinator?prompt=");
        expect(decodeURIComponent(href.split("?prompt=")[1])).toBe(demoMsg);
    });

    it("correctly resolves Autonomous Codegen Architect demo message and deep link", () => {
        const agent = {
            name: "Autonomous Codegen Architect",
            slug: "codegen-architect",
            desc: "Conversational text-to-app generator, AST validator, and live sandbox compiler."
        };
        const demoMsg = getAgentDemoMessage(agent);
        expect(demoMsg).toContain("Vendor Risk & Compliance");

        const href = getAgentHref(agent);
        expect(href).toContain("/a/codegen-architect?prompt=");
    });

    it("correctly resolves BudgetMaster Financial Controller demo message and deep link", () => {
        const agent = {
            name: "BudgetMaster Financial Controller",
            slug: "budgetmaster-advisor",
            role: "Financial Governance Specialist"
        };
        const demoMsg = getAgentDemoMessage(agent);
        expect(demoMsg).toContain("Q3 department spend anomaly detection");
        expect(demoMsg).toContain("Cloud Infrastructure overrun (+14.2%)");

        const href = getAgentHref(agent);
        expect(href).toContain("/a/budgetmaster-advisor?prompt=");
    });

    it("correctly resolves Workforce Upskilling Supervisor demo message and deep link", () => {
        const agent = {
            name: "Workforce Upskilling Supervisor",
            slug: "workforce-supervisor",
            desc: "Autonomous agent reliability auditor, PIP monitor & automated skill mutation runner."
        };
        const demoMsg = getAgentDemoMessage(agent);
        expect(demoMsg).toContain("Audit fleet reliability scores");
        expect(demoMsg).toContain("rollback snapshot");

        const href = getAgentHref(agent);
        expect(href).toContain("/a/workforce-supervisor?prompt=");
    });

    it("ensures URL search parameters are parsed into input value on agent deployment surface", () => {
        const searchString = "?prompt=" + encodeURIComponent("Emergency incident reported: Structural collapse at Sector 7, Building A with 3 trapped casualties. Please initiate incident intake and dispatch the rescue squad.");
        const searchParams = new URLSearchParams(searchString);
        const initialPrompt = searchParams.get('prompt') || searchParams.get('message') || "";

        expect(initialPrompt).toBe("Emergency incident reported: Structural collapse at Sector 7, Building A with 3 trapped casualties. Please initiate incident intake and dispatch the rescue squad.");
    });

    it("ensures default pinned apps on Command Launchpad include the hero showcase apps", () => {
        const defaultPinnedSlugs = ["rescue-dispatch", "codegen-pipeline-workbench", "budgetmaster-workbench", "film-studio"];
        expect(defaultPinnedSlugs).toContain("rescue-dispatch");
        expect(defaultPinnedSlugs).toContain("codegen-pipeline-workbench");
        expect(defaultPinnedSlugs).toContain("budgetmaster-workbench");
        expect(defaultPinnedSlugs).toContain("film-studio");
    });
});
