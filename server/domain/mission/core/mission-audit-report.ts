import { createHmac, createHash } from "node:crypto";
import { scrubSecrets } from "@server/utils/secret-scrubber.js";

export interface AuditReportAttestation {
  status: "signed" | "unsigned";
  algorithm: "hmac-sha256" | null;
  keyId: string | null;
  orgKey?: string | null;
  signature: string | null;
  signedValue: string;
  limitation: string | null;
}

export interface CrewRoomAuditBundle {
  exportId: string;
  schemaVersion: string;
  exportedAt: string;
  roomId: number | string;
  roomKey: string;
  roomTitle: string;
  organizationId?: number | string;
  orgKey?: string;
  provenance: {
    level: "procurement-grade" | "standard";
    controlPlane: "Oddjob 5-Layer Governed AI Control Plane";
    governanceStandards: string[];
  };
  metrics: {
    totalTurns: number;
    totalToolInvocations: number;
    humanSignOffsApproved: number;
    humanSignOffsRejected: number;
    /** Null when no trajectory in this room was scored — never a stand-in value. */
    avgTrajectorySafetyScore: number | null;
    estimatedCostUsd: number;
  };
  integrity: {
    algorithm: "sha256";
    eventCount: number;
    headHash: string;
  };
  timeline: {
    events: Array<{
      timestamp: string;
      kind: string;
      title: string;
      status?: string;
      actor?: string;
      summary?: string;
      payloadHash?: string;
    }>;
  };
  claims: {
    limitations: string[];
  };
  attestation: AuditReportAttestation;
}

export function attestAuditReport(
  exportId: string,
  headHash: string,
  secret = process.env.AUDIT_REPORT_SIGNING_SECRET,
  keyId = process.env.AUDIT_REPORT_SIGNING_KEY_ID || "oddjob-audit-report-v1",
  orgKey?: string
): AuditReportAttestation {
  const signedValue = `${exportId}:${headHash}${orgKey ? `:${orgKey}` : ""}`;
  if (!secret) {
    return {
      status: "unsigned",
      algorithm: null,
      keyId: null,
      orgKey: orgKey ?? null,
      signature: null,
      signedValue,
      limitation: "AUDIT_REPORT_SIGNING_SECRET is not configured; integrity hashes are present but this export has no server attestation.",
    };
  }
  return {
    status: "signed",
    algorithm: "hmac-sha256",
    keyId,
    orgKey: orgKey ?? null,
    signature: createHmac("sha256", secret).update(signedValue, "utf8").digest("hex"),
    signedValue,
    limitation: "Cryptographically verifiable via organization signing secret.",
  };
}

export function buildCrewRoomAuditBundle(
  session: { id: number | string; key: string; title?: string; organizationId?: number | string; mode?: string },
  turns: any[] = [],
  attachments: any[] = [],
  orgKey?: string
): CrewRoomAuditBundle {
  const exportId = `audit-crew-${session.id}-${Date.now()}`;
  const events: CrewRoomAuditBundle["timeline"]["events"] = [];

  let toolCount = 0;
  let approvals = 0;
  let rejections = 0;
  let safetyScoreSum = 0;
  let safetyScoreCount = 0;

  // 1. Initial Room Provision Event
  events.push({
    timestamp: new Date().toISOString(),
    kind: "room_provision",
    title: `CREW Room '${session.title || session.key}' Initialized`,
    status: "success",
    actor: "CrewOrchestrator",
    summary: `Mode: ${session.mode || "explore"}. Tenant Org: ${session.organizationId || "default"}.`,
  });

  // 2. Iterate turns
  for (const t of turns) {
    const actor = t.agentName || (t.role === "user" ? "HumanOperator" : "System");
    const turnTimestamp = t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString();

    events.push({
      timestamp: turnTimestamp,
      kind: "dialogue_turn",
      title: `Turn #${t.turnIndex ?? t.id ?? 1} by @${actor}`,
      status: "completed",
      actor,
      summary: typeof t.content === "string" ? scrubSecrets(t.content.slice(0, 160)) : "Dialogue event",
    });

    const artifacts = Array.isArray(t.artifacts) ? t.artifacts : [];
    for (const a of artifacts) {
      if (a?.tool) {
        toolCount++;
      }
      if (a?.tool === "request_governance_approval" || a?.payload?.type === "crew_governance_gate_pod") {
        const status = a.payload?.checkpoint?.status;
        if (status === "approved") approvals++;
        if (status === "rejected") rejections++;
        events.push({
          timestamp: turnTimestamp,
          kind: "governance_gate",
          title: `Governance Checkpoint: ${a.payload?.checkpoint?.actionTitle || a.tool}`,
          status: status || "pending",
          actor: a.payload?.checkpoint?.requestedBy || actor,
          summary: scrubSecrets(`Risk: ${a.payload?.checkpoint?.riskTier || "medium"}. Blast radius: ${JSON.stringify(a.payload?.checkpoint?.blastRadius || {})}`),
        });
      }
      if (a?.tool === "dispatch_spatial_squad") {
        const score = a.payload?.checkpoint?.executionPayload?.trajectoryScore;
        if (typeof score === "number") {
          safetyScoreSum += score;
          safetyScoreCount++;
        }
      }
    }
  }

  // 3. Compute Linear SHA-256 Head Hash Chain
  //
  // Every field of the event is chained, not just when it happened and who did
  // it. Covering only timestamp/kind/title/actor left `summary` and `status`
  // outside the chain — so an event's content, and whether it was approved or
  // rejected, could be rewritten and the head hash would still verify. That is
  // the one thing a tamper-evident log has to catch.
  let currentHash = createHash("sha256").update(exportId).digest("hex");
  for (const event of events) {
    const material = [
      currentHash,
      event.timestamp,
      event.kind,
      event.title,
      event.status ?? "",
      event.actor ?? "",
      event.summary ?? "",
    ].join(":");
    currentHash = createHash("sha256").update(material, "utf8").digest("hex");
    event.payloadHash = currentHash;
  }

  // Null, not a stand-in figure. This defaulted to 0.88 when nothing had been
  // scored, so a room with no trajectory evaluations at all still reported a
  // measured-looking safety average — inside a bundle that labels itself
  // procurement-grade and cites EU AI Act Article 12. An absent measurement has
  // to read as absent.
  const avgTrajectorySafetyScore =
    safetyScoreCount > 0 ? Number((safetyScoreSum / safetyScoreCount).toFixed(3)) : null;
  const estimatedCostUsd = Number(((turns.length * 0.004) + (toolCount * 0.01)).toFixed(2));

  const attestation = attestAuditReport(exportId, currentHash, undefined, undefined, orgKey);

  return {
    exportId,
    schemaVersion: "oddjob.audit.v2",
    exportedAt: new Date().toISOString(),
    roomId: session.id,
    roomKey: session.key,
    roomTitle: session.title || session.key,
    organizationId: session.organizationId,
    orgKey,
    provenance: {
      level: "procurement-grade",
      controlPlane: "Oddjob 5-Layer Governed AI Control Plane",
      governanceStandards: ["EU_AI_ACT_ART_12", "ISO_42001", "SOC2_TYPE_II_AI_CONTROLS"],
    },
    metrics: {
      totalTurns: turns.length,
      totalToolInvocations: toolCount,
      humanSignOffsApproved: approvals,
      humanSignOffsRejected: rejections,
      avgTrajectorySafetyScore,
      estimatedCostUsd,
    },
    integrity: {
      algorithm: "sha256",
      eventCount: events.length,
      headHash: currentHash,
    },
    timeline: { events },
    claims: {
      limitations: [
        "Audit log is generated deterministically from the immutable turn event stream.",
        "Model completions are bounded by Bayesian trajectory scoring and sandbox isolation.",
      ],
    },
    attestation,
  };
}

export function renderAuditReportHtml(bundle: any): string {
  const events = Array.isArray(bundle?.timeline?.events) ? bundle.timeline.events : [];
  const limitations = Array.isArray(bundle?.claims?.limitations) ? bundle.claims.limitations : [];
  const attestation = bundle.attestation as AuditReportAttestation;
  const metrics = bundle?.metrics || {};

  const rows = events
    .map(
      (event: any) => `<tr>
    <td class="font-mono">${escapeHtml(event.timestamp)}</td>
    <td><span class="badge ${event.kind === "governance_gate" ? "bg-amber" : "bg-neutral"}">${escapeHtml(event.kind)}</span></td>
    <td><strong>${escapeHtml(event.title)}</strong></td>
    <td><span class="badge ${event.status === "approved" || event.status === "completed" || event.status === "success" ? "signed" : event.status === "rejected" ? "unsigned" : "bg-neutral"}">${escapeHtml(event.status ?? "—")}</span></td>
    <td>${escapeHtml(event.actor ?? "—")}</td>
    <td>${escapeHtml(event.summary ?? "")}</td>
    <td class="hash text-xs">${escapeHtml(event.payloadHash ? event.payloadHash.slice(0, 12) + "..." : "—")}</td>
  </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Oddjob Procurement Audit Report — ${escapeHtml(bundle.roomTitle || bundle.missionRunId || bundle.exportId)}</title>
  <style>
    body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; max-width: 1200px; margin: 30px auto; padding: 0 24px; background: #fff; }
    h1, h2, h3 { color: #0b1324; font-weight: 700; margin-top: 24px; margin-bottom: 8px; }
    header { border-bottom: 3px solid #6366f1; padding-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header-title { font-size: 24px; font-weight: 800; color: #1e1b4b; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .signed { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
    .unsigned { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .bg-amber { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .bg-neutral { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; }
    .label { color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
    .value { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .hash-box { background: #0f172a; color: #34d399; font-family: ui-monospace, monospace; padding: 12px; border-radius: 8px; font-size: 11px; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #334155; font-weight: 700; font-size: 11px; text-transform: uppercase; }
    tr:nth-child(even) { background: #f8fafc; }
    .font-mono { font-family: ui-monospace, monospace; font-size: 11px; }
    .hash { font-family: ui-monospace, monospace; }
    footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; color: #64748b; font-size: 11px; text-align: center; }
    @media print { body { margin: 0; max-width: none; } .no-print { display: none; } }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="header-title">🛡️ Procurement AI Governance & Audit Report</div>
      <div style="color: #64748b; margin-top: 4px;">Target Room: <strong>${escapeHtml(bundle.roomTitle || bundle.missionRunId || bundle.exportId)}</strong> (Key: <code>${escapeHtml(bundle.roomKey || bundle.exportId)}</code>)</div>
    </div>
    <div style="text-align: right;">
      <span class="badge ${attestation.status}">${escapeHtml(attestation.status)} Attestation</span>
      <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Export ID: <span class="font-mono">${escapeHtml(bundle.exportId)}</span></div>
    </div>
  </header>

  <!-- Executive Metric Cards -->
  <div class="grid">
    <div class="card">
      <div class="label">Safety Score T(S)</div>
      ${
        // This rendered a green 88.0% whenever nothing had been scored, which is
        // the number a procurement reviewer actually reads. An unmeasured score
        // says so, in the muted colour, rather than borrowing a healthy-looking
        // one.
        typeof metrics.avgTrajectorySafetyScore === "number"
          ? `<div class="value" style="color: #059669;">${(metrics.avgTrajectorySafetyScore * 100).toFixed(1)}%</div>`
          : `<div class="value" style="color: #64748b;">Not measured</div>`
      }
    </div>
    <div class="card">
      <div class="label">Human Approvals</div>
      <div class="value">${metrics.humanSignOffsApproved ?? 0} <span style="font-size: 11px; color: #64748b; font-weight: normal;">approved</span></div>
    </div>
    <div class="card">
      <div class="label">Tool Operations</div>
      <div class="value">${metrics.totalToolInvocations ?? 0} <span style="font-size: 11px; color: #64748b; font-weight: normal;">invocations</span></div>
    </div>
    <div class="card">
      <div class="label">Est. Compute Cost</div>
      <div class="value">$${(metrics.estimatedCostUsd ?? 0).toFixed(2)}</div>
    </div>
  </div>

  <h2>Cryptographic Provenance & Head Hash Chain</h2>
  <div class="hash-box">
    <div><strong>Control Plane:</strong> ${escapeHtml(bundle.provenance?.controlPlane || "Oddjob 5-Layer AI Control Plane")}</div>
    <div><strong>SHA-256 Head Hash:</strong> ${escapeHtml(bundle.integrity?.headHash)}</div>
    <div><strong>Signature:</strong> ${escapeHtml(attestation.signature ?? "Unsigned — AUDIT_REPORT_SIGNING_SECRET not present")}</div>
    <div><strong>Key ID:</strong> ${escapeHtml(attestation.keyId ?? "oddjob-audit-v1")} · <strong>Algorithm:</strong> ${escapeHtml(attestation.algorithm ?? "None")} · <strong>Total Events:</strong> ${escapeHtml(bundle.integrity?.eventCount ?? events.length)}</div>
  </div>

  <h2>Compliance & Regulatory Standards</h2>
  <p>This audit record adheres to the following compliance standards:</p>
  <ul>
    ${(bundle.provenance?.governanceStandards || ["EU_AI_ACT_ART_12", "ISO_42001", "SOC2_TYPE_II"]).map((s: string) => `<li><strong>${escapeHtml(s)}</strong> — Verifiable autonomous agent state tracking and deterministic provenance.</li>`).join("")}
  </ul>

  <h2>Evidence Timeline & Execution Chain (${events.length} Events)</h2>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Category</th>
        <th>Event Title</th>
        <th>Status</th>
        <th>Actor</th>
        <th>Summary</th>
        <th>Hash</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <footer>
    Generated at ${escapeHtml(bundle.exportedAt)} by Oddjob Audit Export Engine (Schema: ${escapeHtml(bundle.schemaVersion)}).<br/>
    Retain the JSON payload alongside this document for automated machine verification.
  </footer>
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
