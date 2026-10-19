import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    runGovernedSupportTriageContract,
    type GovernedSupportTriageFixture,
} from "./golden-path-contract";

function loadFixture(): GovernedSupportTriageFixture {
    return JSON.parse(readFileSync(
        resolve("fixtures/golden-path/governed-support-triage.json"),
        "utf8",
    )) as GovernedSupportTriageFixture;
}

describe("governed support triage golden path", () => {
    it("validates fixture shape and the real autonomy-policy decision without executing a mission", () => {
        const result = runGovernedSupportTriageContract(loadFixture());

        expect(result.artifactKind).toBe("fixture_contract");
        expect(result.executedMission).toBe(false);
        expect(result.status).toBe("contract_validated");
        expect(result.classification).toBe("workflow_instability");
        expect(result.policy.decision).toBe("review");
        expect(result.policy.flags.map((flag) => flag.code)).toContain("external_commitment");
        expect(result.citedKnowledge).toHaveLength(2);
        expect(result.timeline.map((event) => event.type)).toEqual([
            "mission_created",
            "knowledge_retrieved",
            "issue_classified",
            "action_proposed",
            "approval_requested",
            "approval_recorded",
            "mission_completed",
        ]);
        expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
    });

    it("fails closed when the expected approval policy drifts", () => {
        const fixture = loadFixture();
        fixture.approvalScenario.policyFlag = "missing_policy";
        fixture.mission.requiresApprovalFor = ["missing_policy"];

        expect(() => runGovernedSupportTriageContract(fixture)).toThrow(
            /did not produce required policy flag/,
        );
    });
});

