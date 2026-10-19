import { describe, expect, it } from "vitest";
import {
    ARTIFACT_TOOLS,
    PROPOSAL_TOOLS,
    UNIVERSAL_PRESENTATION_TOOLS,
    RICH_PAYLOAD_TYPES,
    detectArtifact,
} from "../crew-tools.service.js";
import { FLOW_CREATED, FLOW_CREATE_PROPOSAL } from "@shared/flow-studio-crew.js";

/**
 * propose_flow is tiered like its siblings, not like a render tool.
 *
 * The tool classifier checks ARTIFACT_TOOLS before PROPOSAL_TOOLS, so a tool in
 * both classifies as "artifact" - which would also put it in FOLLOW_UP_TOOLS and
 * let a speaker draft a flow on the bounded follow-up pass. propose_agent,
 * propose_mission and the rest sit in PROPOSAL_TOOLS alone; propose_flow matches
 * them.
 */
describe("propose_flow is tiered as a proposal", () => {
    it("sits with its siblings, not with the render tools", () => {
        expect(PROPOSAL_TOOLS.has("propose_flow")).toBe(true);
        expect(ARTIFACT_TOOLS.has("propose_flow")).toBe(false);
        // Same placement as the tool it was modelled on.
        expect(PROPOSAL_TOOLS.has("propose_agent")).toBe(true);
        expect(ARTIFACT_TOOLS.has("propose_agent")).toBe(false);
    });

    it("is granted universally, since no synced agent card declares it", () => {
        expect(UNIVERSAL_PRESENTATION_TOOLS).toContain("propose_flow");
    });

    it("still renders as a card, which depends on the payload type and not the tier", () => {
        const payload = { type: FLOW_CREATE_PROPOSAL, proposalId: "flownew_12345678", name: "Lead triage" };
        expect(RICH_PAYLOAD_TYPES.has(FLOW_CREATE_PROPOSAL)).toBe(true);
        expect(detectArtifact("propose_flow", JSON.stringify(payload))?.payload.type).toBe(FLOW_CREATE_PROPOSAL);
    });

    it("detects the created-flow record, which marks a draft as used", () => {
        const payload = { type: FLOW_CREATED, proposalId: "flownew_12345678", pipelineId: 12, name: "Lead triage" };
        expect(detectArtifact("propose_flow", JSON.stringify(payload))?.payload.type).toBe(FLOW_CREATED);
    });
});

/**
 * The two-step contract, pinned.
 *
 * propose_flow needs list_jobs first, so the propose call lands on the bounded
 * follow-up pass. Tiering it as a proposal takes it out of ARTIFACT_TOOLS, which
 * is what FOLLOW_UP_TOOLS is built from — so it has to be named there
 * explicitly. Verified live: without it a room answered "build a flow..." by
 * calling list_jobs and then describing the flow in prose.
 */
describe("propose_flow survives to the follow-up pass", () => {
    it("is reachable after list_jobs returns", async () => {
        const { FOLLOW_UP_TOOLS } = await import("../crew-speaker-turn.service.js");
        expect(FOLLOW_UP_TOOLS.has("propose_flow")).toBe(true);
        // It is there on its own merit, not by riding ARTIFACT_TOOLS.
        expect(ARTIFACT_TOOLS.has("propose_flow")).toBe(false);
    });
});
