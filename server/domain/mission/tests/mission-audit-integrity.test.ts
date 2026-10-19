import { describe, expect, it } from "vitest";
import {
  buildEvidenceIntegrityManifest,
  classifyMissionEvidence,
  verifyEvidenceIntegrityManifest,
} from "../core/mission-audit-integrity.js";
import type { MissionEvidenceEvent } from "../core/mission-evidence-timeline.service.js";

const events: MissionEvidenceEvent[] = [
  {
    id: "approval:1",
    missionRunId: 42,
    missionId: 7,
    kind: "approval",
    source: "approval_request",
    event: "approval.approved",
    title: "Approval recorded",
    timestamp: "2026-08-08T10:01:00.000Z",
    sequence: 2,
    status: "approved",
    evidence: { table: "approval_requests", rowId: 1 },
  },
  {
    id: "run:42:created",
    missionRunId: 42,
    missionId: 7,
    kind: "run",
    source: "mission_run",
    event: "run.created",
    title: "Mission run created",
    timestamp: "2026-08-08T10:00:00.000Z",
    sequence: 0,
    status: "active",
    evidence: { table: "mission_runs", rowId: 42 },
  },
];

describe("mission audit integrity", () => {
  it("builds the same chronological chain regardless of display direction", () => {
    const forward = buildEvidenceIntegrityManifest(events);
    const reverse = buildEvidenceIntegrityManifest([...events].reverse());

    expect(forward).toEqual(reverse);
    expect(forward.eventCount).toBe(2);
    expect(forward.chain[1]?.previousHash).toBe(forward.chain[0]?.eventHash);
    expect(verifyEvidenceIntegrityManifest(events, forward)).toBe(true);
  });

  it("detects altered evidence", () => {
    const manifest = buildEvidenceIntegrityManifest(events);
    const altered = events.map((event) => event.id === "approval:1"
      ? { ...event, status: "rejected" }
      : event);

    expect(verifyEvidenceIntegrityManifest(altered, manifest)).toBe(false);
  });

  it("classifies demo execution as integration evidence, never production", () => {
    const provenance = classifyMissionEvidence({
      name: "Golden Path — Governed Support Triage",
      missionContext: { goldenPathFixture: "governed-support-triage" },
      isShadow: false,
    }, "production");

    expect(provenance.level).toBe("integration");
    expect(provenance.syntheticData).toBe(true);
    expect(provenance.claimLimitations).toContain("This bundle is not production-usage evidence.");
  });

  it("requires explicit customer verification above production evidence", () => {
    expect(classifyMissionEvidence({ missionContext: {} }, "production").level).toBe("production");
    expect(classifyMissionEvidence({
      missionContext: { environment: "production", customerVerified: true },
    }, "production").level).toBe("customer_verified");
  });
});
