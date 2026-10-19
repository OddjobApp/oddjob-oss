import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePath = resolve("fixtures/golden-path/technical-research-rfc-synthesis.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as any;
const errors: string[] = [];

// ─── 1. Top-level fields ───────────────────────────────────────────────────────

requiredString("id", fixture.id);
requiredString("title", fixture.title);
requiredString("buyerQuestion", fixture.buyerQuestion);
requiredString("researchTopic.title", fixture.researchTopic?.title);
requiredString("researchTopic.description", fixture.researchTopic?.description);
requiredString("researchTopic.rationale", fixture.researchTopic?.rationale);

// ─── 2. Missions array ─────────────────────────────────────────────────────────

if (!Array.isArray(fixture.missions) || fixture.missions.length !== 6) {
    errors.push(`missions must be an array with exactly 6 entries (got ${fixture.missions?.length ?? 0})`);
} else {
    const missionIds = new Set<string>();
    const missionOrder: string[] = [];

    for (let i = 0; i < fixture.missions.length; i++) {
        const m = fixture.missions[i];
        const prefix = `missions[${i}]`;

        requiredString(`${prefix}.id`, m.id);
        requiredString(`${prefix}.name`, m.name);
        requiredString(`${prefix}.objective`, m.objective);
        requiredString(`${prefix}.phase`, m.phase);
        requiredString(`${prefix}.type`, m.type);

        if (!Array.isArray(m.inputs) || m.inputs.length === 0) {
            errors.push(`${prefix}.inputs must be a non-empty array`);
        }
        if (!Array.isArray(m.outputs) || m.outputs.length === 0) {
            errors.push(`${prefix}.outputs must be a non-empty array`);
        }

        // DAG integrity: dependsOn must reference an earlier mission or be null for first
        if (i === 0) {
            if (m.dependsOn !== null) {
                errors.push(`${prefix}.dependsOn must be null for the first mission`);
            }
        } else {
            if (m.dependsOn === null || !missionIds.has(m.dependsOn)) {
                errors.push(`${prefix}.dependsOn must reference an existing earlier mission ID (got "${m.dependsOn}")`);
            }
        }

        // HIL gate check
        if (m.type === "hil") {
            if (!m.hilGate) {
                errors.push(`${prefix}.hilGate must be present for hil-type missions`);
            } else {
                requiredString(`${prefix}.hilGate.formRef`, m.hilGate.formRef);
                requiredString(`${prefix}.hilGate.expectedDecision`, m.hilGate.expectedDecision);
            }
        }

        if (m.id) {
            missionIds.add(m.id);
            missionOrder.push(m.id);
        }
    }

    // DAG cycle check: since dependsOn must reference an earlier mission, any valid
    // ordering where dependsOn only points backward is acyclic by construction.
    // We verify no forward references exist (already done above) and no self-references.
    for (let i = 0; i < fixture.missions.length; i++) {
        const m = fixture.missions[i];
        if (m.dependsOn && m.dependsOn === m.id) {
            errors.push(`missions[${i}].dependsOn must not reference itself`);
        }
    }
}

// ─── 3. HIL Decisions ──────────────────────────────────────────────────────────

const validTriageOptions = [
    "Option A - High Performance",
    "Option B - Low Complexity / Reusable",
    "Option C - Hybrid Approach",
];
const validPocDecisions = [
    "Approve & Generate RFC",
    "Reject / Request Architectural Rework",
];

// technologyTriageDecision
if (!fixture.technologyTriageDecision) {
    errors.push("technologyTriageDecision must be present");
} else {
    const ttd = fixture.technologyTriageDecision;
    requiredString("technologyTriageDecision.formRef", ttd.formRef);
    requiredString("technologyTriageDecision.selectedOption", ttd.selectedOption);
    requiredString("technologyTriageDecision.approver", ttd.approver);
    requiredString("technologyTriageDecision.timestamp", ttd.timestamp);

    if (ttd.selectedOption && !validTriageOptions.includes(ttd.selectedOption)) {
        errors.push(
            `technologyTriageDecision.selectedOption must be one of: ${validTriageOptions.join(", ")} (got "${ttd.selectedOption}")`,
        );
    }
}

// pocSignoffDecision
if (!fixture.pocSignoffDecision) {
    errors.push("pocSignoffDecision must be present");
} else {
    const psd = fixture.pocSignoffDecision;
    requiredString("pocSignoffDecision.formRef", psd.formRef);
    requiredString("pocSignoffDecision.decision", psd.decision);
    requiredString("pocSignoffDecision.approver", psd.approver);
    requiredString("pocSignoffDecision.timestamp", psd.timestamp);

    if (psd.decision && !validPocDecisions.includes(psd.decision)) {
        errors.push(
            `pocSignoffDecision.decision must be one of: ${validPocDecisions.join(", ")} (got "${psd.decision}")`,
        );
    }
}

// ─── 4. Knowledge array ────────────────────────────────────────────────────────

const requiredSourceTypes = ["academic_paper", "architecture_doc", "codebase_context", "integration_pattern"];

if (!Array.isArray(fixture.knowledge) || fixture.knowledge.length < 4) {
    errors.push(`knowledge must include at least 4 documents (got ${fixture.knowledge?.length ?? 0})`);
} else {
    const foundSourceTypes = new Set<string>();

    for (let i = 0; i < fixture.knowledge.length; i++) {
        const k = fixture.knowledge[i];
        const prefix = `knowledge[${i}]`;

        requiredString(`${prefix}.id`, k.id);
        requiredString(`${prefix}.title`, k.title);
        requiredString(`${prefix}.sourceType`, k.sourceType);
        requiredString(`${prefix}.content`, k.content);

        if (typeof k.sourceConfidence !== "number" || k.sourceConfidence < 0 || k.sourceConfidence > 1) {
            errors.push(`${prefix}.sourceConfidence must be a number between 0 and 1`);
        }

        if (k.sourceType) {
            foundSourceTypes.add(k.sourceType);
        }
    }

    for (const st of requiredSourceTypes) {
        if (!foundSourceTypes.has(st)) {
            errors.push(`knowledge must include at least one document with sourceType "${st}"`);
        }
    }
}

// ─── 5. WorkbenchData ──────────────────────────────────────────────────────────

const requiredWorkbenchKeys = ["ingestionHub", "decisionPanel", "draftSandbox", "memoryLibrary", "backlogProvisioner"];

if (!fixture.workbenchData || typeof fixture.workbenchData !== "object") {
    errors.push("workbenchData must be a non-null object");
} else {
    for (const key of requiredWorkbenchKeys) {
        if (!fixture.workbenchData[key]) {
            errors.push(`workbenchData.${key} must be present`);
        }
    }

    // ingestionHub
    const ih = fixture.workbenchData.ingestionHub;
    if (ih) {
        if (!Array.isArray(ih.researchSources) || ih.researchSources.length < 3) {
            errors.push(`workbenchData.ingestionHub.researchSources must have at least 3 entries (got ${ih.researchSources?.length ?? 0})`);
        }
        if (!Array.isArray(ih.synthesisMatrix) || ih.synthesisMatrix.length === 0) {
            errors.push("workbenchData.ingestionHub.synthesisMatrix must be a non-empty array");
        }
    }

    // decisionPanel
    const dp = fixture.workbenchData.decisionPanel;
    if (dp) {
        if (!Array.isArray(dp.formSubmissions) || dp.formSubmissions.length < 2) {
            errors.push(`workbenchData.decisionPanel.formSubmissions must have at least 2 entries (got ${dp.formSubmissions?.length ?? 0})`);
        }
    }

    // draftSandbox
    const ds = fixture.workbenchData.draftSandbox;
    if (ds) {
        if (!Array.isArray(ds.artifacts) || ds.artifacts.length < 2) {
            errors.push(`workbenchData.draftSandbox.artifacts must have at least 2 entries (got ${ds.artifacts?.length ?? 0})`);
        } else {
            const types = ds.artifacts.map((a: any) => a.type);
            if (!types.includes("poc_snippet")) {
                errors.push("workbenchData.draftSandbox.artifacts must include at least one artifact with type 'poc_snippet'");
            }
            if (!types.includes("rfc_draft")) {
                errors.push("workbenchData.draftSandbox.artifacts must include at least one artifact with type 'rfc_draft'");
            }
        }
    }

    // memoryLibrary
    const ml = fixture.workbenchData.memoryLibrary;
    if (ml) {
        if (!Array.isArray(ml.documents) || ml.documents.length < 1) {
            errors.push(`workbenchData.memoryLibrary.documents must have at least 1 entry (got ${ml.documents?.length ?? 0})`);
        }
    }

    // backlogProvisioner
    const bp = fixture.workbenchData.backlogProvisioner;
    if (bp) {
        if (!Array.isArray(bp.tasks) || bp.tasks.length < 3) {
            errors.push(`workbenchData.backlogProvisioner.tasks must have at least 3 entries (got ${bp.tasks?.length ?? 0})`);
        }
    }
}

// ─── 6. Phase boundaries ───────────────────────────────────────────────────────

if (!Array.isArray(fixture.phaseBoundaries) || fixture.phaseBoundaries.length !== 5) {
    errors.push(`phaseBoundaries must have exactly 5 entries (got ${fixture.phaseBoundaries?.length ?? 0})`);
} else {
    for (let i = 0; i < fixture.phaseBoundaries.length; i++) {
        const pb = fixture.phaseBoundaries[i];
        const prefix = `phaseBoundaries[${i}]`;

        requiredString(`${prefix}.fromMission`, pb.fromMission);
        requiredString(`${prefix}.toMission`, pb.toMission);
        requiredString(`${prefix}.expectedArtifact`, pb.expectedArtifact);

        if (!pb.contractShape || typeof pb.contractShape !== "object") {
            errors.push(`${prefix}.contractShape must be a non-null object`);
        }

        // Boundaries that cross HIL gates must have hilDecisionRef
        if (pb.hilDecisionRef !== undefined) {
            requiredString(`${prefix}.hilDecisionRef`, pb.hilDecisionRef);
        }
    }

    // Verify boundaries crossing HIL gates have hilDecisionRef
    // HIL gates are at mission-research-2 (triage) and mission-feasibility-2 (poc signoff)
    // The boundary leading OUT of a HIL mission carries the decision reference
    for (let i = 0; i < fixture.phaseBoundaries.length; i++) {
        const pb = fixture.phaseBoundaries[i];
        const fromMission = fixture.missions?.find((m: any) => m.id === pb.fromMission);
        if (fromMission?.type === "hil" && !pb.hilDecisionRef) {
            errors.push(`phaseBoundaries[${i}] crosses a HIL gate (fromMission=${pb.fromMission}) and must have hilDecisionRef`);
        }
    }
}

// ─── 7. Success criteria and evidence ──────────────────────────────────────────

if (!Array.isArray(fixture.successCriteria) || fixture.successCriteria.length < 6) {
    errors.push(`successCriteria must have at least 6 entries (got ${fixture.successCriteria?.length ?? 0})`);
} else {
    for (let i = 0; i < fixture.successCriteria.length; i++) {
        const sc = fixture.successCriteria[i];
        const prefix = `successCriteria[${i}]`;

        requiredString(`${prefix}.id`, sc.id);
        requiredString(`${prefix}.description`, sc.description);
        requiredString(`${prefix}.phase`, sc.phase);
    }
}

if (!Array.isArray(fixture.expectedEvidence) || fixture.expectedEvidence.length < 6) {
    errors.push(`expectedEvidence must have at least 6 entries (got ${fixture.expectedEvidence?.length ?? 0})`);
} else {
    for (let i = 0; i < fixture.expectedEvidence.length; i++) {
        requiredString(`expectedEvidence[${i}]`, fixture.expectedEvidence[i]);
    }
}

// ─── Report results ────────────────────────────────────────────────────────────

if (errors.length > 0) {
    console.error("Golden path fixture validation failed:");
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log(
    `Golden path fixture valid: ${fixture.id} with ${fixture.knowledge.length} knowledge documents, ${fixture.missions.length} missions, ${fixture.phaseBoundaries.length} phase boundaries.`,
);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function requiredString(path: string, value: unknown) {
    if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`${path} must be a non-empty string`);
    }
}
