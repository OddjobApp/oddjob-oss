import { describe, expect, it } from "vitest";
import { attestAuditReport, renderAuditReportHtml } from "../core/mission-audit-report.js";

describe("mission audit report", () => {
  it("never claims a signature when no signing secret exists", () => {
    const result = attestAuditReport("export:1", "abc", "");
    expect(result.status).toBe("unsigned");
    expect(result.signature).toBeNull();
  });

  it("produces a stable HMAC attestation", () => {
    const first = attestAuditReport("export:1", "abc", "secret", "key-1");
    const second = attestAuditReport("export:1", "abc", "secret", "key-1");
    expect(first.status).toBe("signed");
    expect(first.signature).toBe(second.signature);
    expect(first.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("escapes evidence content in the human-readable report", () => {
    const html = renderAuditReportHtml({
      missionRunId: 1, exportId: "x", exportedAt: "now", schemaVersion: "v3",
      provenance: { level: "integration" }, integrity: { eventCount: 1, headHash: "abc" },
      payloadPolicy: "redacted", claims: { limitations: ["<unsafe>"] },
      attestation: attestAuditReport("x", "abc", ""),
      timeline: { events: [{ timestamp: "now", kind: "action", title: "<script>", summary: "ok" }] },
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
