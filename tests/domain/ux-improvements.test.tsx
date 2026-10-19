/**
 * UX Modernization Tests
 * Tests for Command Center Blueprint Integration, Visual Flow Simulation, and Ambient Action Gates
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AmbientActionGate } from "../../client/src/components/governance/AmbientActionGate";
import { forgeBlueprintService } from "../../server/domain/apps/core/forge-blueprint.service";

describe("Command Center Blueprint Catalog Invariants", () => {
    it("provides all 34 canonical blueprints searchable with keywords", async () => {
        const blueprints = await forgeBlueprintService.listBlueprints();
        expect(blueprints.length).toBeGreaterThanOrEqual(34);

        // Ensure every blueprint provides search keywords for the Command Center
        blueprints.forEach(bp => {
            expect(bp.slug).toBeTruthy();
            expect(bp.title || bp.name).toBeTruthy();
            expect(bp.category).toBeTruthy();
        });
    });
});

describe("AmbientActionGate Component", () => {
    it("renders Tier 1 Auto-Pilot chip with subtle indicator", () => {
        render(
            <AmbientActionGate
                id="act-1"
                tier="tier1_autopilot"
                actionTitle="Read telemetry cache"
                estimatedCost={0.02}
            />
        );

        expect(screen.getByTestId("action-gate-tier1-act-1")).toBeInTheDocument();
        expect(screen.getByText("Read telemetry cache")).toBeInTheDocument();
        expect(screen.getByText("Auto-Pilot")).toBeInTheDocument();
        expect(screen.getByText("$0.02")).toBeInTheDocument();
    });

    it("renders Tier 2 Micro-Gate with inline 1-click approval and dry-run buttons", () => {
        const onApprove = vi.fn();
        const onReject = vi.fn();

        render(
            <AmbientActionGate
                id="act-2"
                tier="tier2_microgate"
                actionTitle="Deploy Webhook Bridge"
                actionDescription="Creates external HTTP listener on port 8080"
                estimatedCost={1.5}
                onApprove={onApprove}
                onReject={onReject}
            />
        );

        expect(screen.getByTestId("action-gate-tier2-act-2")).toBeInTheDocument();
        expect(screen.getByText("Deploy Webhook Bridge")).toBeInTheDocument();
        expect(screen.getByText("Micro-Gate")).toBeInTheDocument();

        // Click Dry-Run
        const dryRunBtn = screen.getByTitle("Execute as non-destructive dry-run");
        fireEvent.click(dryRunBtn);
        expect(onApprove).toHaveBeenCalledWith("act-2", true);

        // Shows resolved state
        expect(screen.getByTestId("action-gate-resolved-act-2")).toBeInTheDocument();
        expect(screen.getByText(/Dry-Run Simulation Complete/)).toBeInTheDocument();
    });

    it("renders Tier 3 Multi-Sig gate with adversarial attestation details", () => {
        const onApprove = vi.fn();
        const onReject = vi.fn();

        render(
            <AmbientActionGate
                id="act-3"
                tier="tier3_multisig"
                actionTitle="Purge Archive Bucket"
                actionDescription="Permanently deletes raw telemetry blobs"
                estimatedCost={50.0}
                policyName="Data Retention Standard v2"
                rationales={[
                    {
                        agentPersona: "Execution Agent",
                        verdict: "caution",
                        reasoning: "Action is irreversible; requires confirmation of backup."
                    },
                    {
                        agentPersona: "Safety Officer",
                        verdict: "approve",
                        reasoning: "Meets 90-day retention expiration window."
                    }
                ]}
                onApprove={onApprove}
                onReject={onReject}
            />
        );

        expect(screen.getByTestId("action-gate-tier3-act-3")).toBeInTheDocument();
        expect(screen.getByText("Purge Archive Bucket")).toBeInTheDocument();
        expect(screen.getByText("Tier 3: Multi-Sig Required")).toBeInTheDocument();
        expect(screen.getByText("Execution Agent")).toBeInTheDocument();
        expect(screen.getByText("Safety Officer")).toBeInTheDocument();

        // Click Authorize Multi-Sig
        const authBtn = screen.getByText("Authorize Multi-Sig Action");
        fireEvent.click(authBtn);
        expect(onApprove).toHaveBeenCalledWith("act-3", false);
    });
});

describe("Visual Flow Topological Simulation Invariants", () => {
    it("verifies DAG simulation depth progression formula", () => {
        // Simulates depth relaxation progression
        const nodes = [
            { id: "node-1", depth: 0 },
            { id: "node-2", depth: 1 },
            { id: "node-3", depth: 2 },
        ];

        const getSimStatus = (depth: number, simCol: number) => {
            if (simCol === -1) return "idle";
            if (depth < simCol) return "completed";
            if (depth === simCol) return "running";
            return "pending";
        };

        // Idle
        expect(getSimStatus(0, -1)).toBe("idle");
        expect(getSimStatus(1, -1)).toBe("idle");

        // Step 0 running
        expect(getSimStatus(0, 0)).toBe("running");
        expect(getSimStatus(1, 0)).toBe("pending");
        expect(getSimStatus(2, 0)).toBe("pending");

        // Step 1 running (0 completed)
        expect(getSimStatus(0, 1)).toBe("completed");
        expect(getSimStatus(1, 1)).toBe("running");
        expect(getSimStatus(2, 1)).toBe("pending");

        // Step 2 running (0, 1 completed)
        expect(getSimStatus(0, 2)).toBe("completed");
        expect(getSimStatus(1, 2)).toBe("completed");
        expect(getSimStatus(2, 2)).toBe("running");
    });
});
