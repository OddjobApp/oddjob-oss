import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    runGovernedSupportTriageContract,
    type GovernedSupportTriageFixture,
} from "../../shared/product/golden-path-contract";

const fixturePath = resolve("fixtures/golden-path/governed-support-triage.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GovernedSupportTriageFixture;
const result = runGovernedSupportTriageContract(fixture);

console.log(`Golden path fixture contract passed: ${result.fixtureId}`);
console.log("- provenance: fixture-derived; no mission, approval, resume, or replay was executed");
console.log(`- artifact kind: ${result.artifactKind}`);
console.log(`- executed mission: ${result.executedMission}`);
console.log(`- status: ${result.status}`);
console.log(`- classification: ${result.classification}`);
console.log(`- policy: ${result.policy.decision} (${result.riskLevel})`);
console.log(`- fixture knowledge sources: ${result.citedKnowledge.length}`);
console.log(`- expected approval decision: ${result.approval.decision}`);
console.log(`- expected timeline event shapes: ${result.timeline.length}`);
console.log(`- expected evidence references: ${result.evidenceRefs.length}`);

