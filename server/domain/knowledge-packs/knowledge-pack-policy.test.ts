import { describe, expect, it } from "vitest";
import { KnowledgePackManifestSchema } from "@shared/schema/knowledge-packs.js";
import { SYNTHETIC_FINANCE_PACK } from "./synthetic-finance.pack.js";
import { evaluateKnowledgePack, versionSatisfies } from "./knowledge-pack-policy.js";

const compliantContext = {
  customerClassification: "retail",
  approvalStatus: "APPROVED",
  contentHash: "sha256:final",
  approvalContentHash: "sha256:final",
  agentMayPublish: true,
  archiveTarget: "approved-archive",
};

describe("knowledge-pack governance policy", () => {
  it("validates the synthetic fixture and labels it synthetic", () => {
    const pack = KnowledgePackManifestSchema.parse(SYNTHETIC_FINANCE_PACK);
    expect(pack.metadata.synthetic).toBe(true);
    expect(pack.controls).toHaveLength(5);
  });

  it("allows an exact approved content hash with all required context", () => {
    const result = evaluateKnowledgePack(SYNTHETIC_FINANCE_PACK, "publish_financial_content", compliantContext);
    expect(result.decision).toBe("ALLOW");
    expect(result.applicableControls).toHaveLength(5);
  });

  it("requires approval before retail publication", () => {
    const result = evaluateKnowledgePack(SYNTHETIC_FINANCE_PACK, "publish_financial_content", { ...compliantContext, approvalStatus: "PENDING" });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
    expect(result.reasons.join(" ")).toContain("FIN-DEMO-001");
  });

  it("blocks when approval is for different content", () => {
    const result = evaluateKnowledgePack(SYNTHETIC_FINANCE_PACK, "publish_financial_content", { ...compliantContext, approvalContentHash: "sha256:old" });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons.join(" ")).toContain("FIN-DEMO-002");
  });

  it("denies by default when required context is missing", () => {
    const { customerClassification: _, ...context } = compliantContext;
    const result = evaluateKnowledgePack(SYNTHETIC_FINANCE_PACK, "publish_financial_content", context);
    expect(result.decision).toBe("INSUFFICIENT_CONTEXT");
    expect(result.missingContext).toContain("customerClassification");
  });

  it("evaluates deterministic version ranges for blueprint dependencies", () => {
    expect(versionSatisfies("1.4.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(versionSatisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
  });
});

