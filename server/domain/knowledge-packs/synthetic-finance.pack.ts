import type { KnowledgePackManifest } from "@shared/schema/knowledge-packs.js";

/** Synthetic controls validate the platform architecture; they are not legal advice or regulatory coverage. */
export const SYNTHETIC_FINANCE_PACK: KnowledgePackManifest = {
  apiVersion: "oddjob.io/v1",
  kind: "KnowledgePack",
  metadata: {
    id: "synthetic-finance-governance",
    name: "Synthetic Finance Governance",
    version: "1.0.0",
    publisher: "oddjob-demo",
    contentHash: "sha256:synthetic-finance-governance-1.0.0",
    synthetic: true,
  },
  scope: { domains: ["finance"], jurisdictions: ["DEMO"] },
  requiredProfileFields: ["legalEntity", "complianceOwner"],
  certification: { minimumPassRate: 1, requiresComplianceApproval: true },
  controls: [
    {
      id: "FIN-DEMO-001",
      description: "Publishing retail financial content requires separate compliance approval.",
      actionTypes: ["publish_financial_content"],
      effect: "APPROVAL_REQUIRED",
      requiredContext: ["customerClassification", "approvalStatus"],
      conditions: [{ field: "customerClassification", operator: "equals", value: "retail" }, { field: "approvalStatus", operator: "not_equals", value: "APPROVED" }],
      remediation: ["Submit the final content for compliance review."],
    },
    {
      id: "FIN-DEMO-002",
      description: "Approval must be bound to the exact final content hash.",
      actionTypes: ["publish_financial_content"],
      effect: "BLOCK",
      requiredContext: ["contentHash", "approvalContentHash"],
      conditions: [{ field: "approvalContentHash", operator: "hash_matches", value: "contentHash" }],
      remediation: ["Obtain approval for the current content hash."],
    },
    {
      id: "FIN-DEMO-003",
      description: "Customer classification must be known before publication.",
      actionTypes: ["publish_financial_content"],
      effect: "BLOCK",
      requiredContext: ["customerClassification"],
      conditions: [{ field: "customerClassification", operator: "known" }],
      remediation: ["Resolve customer classification from a trusted system."],
    },
    {
      id: "FIN-DEMO-004",
      description: "Only an explicitly permitted actor may publish.",
      actionTypes: ["publish_financial_content"],
      effect: "BLOCK",
      requiredContext: ["agentMayPublish"],
      conditions: [{ field: "agentMayPublish", operator: "not_equals", value: true }],
      remediation: ["Route publication to a permitted human or service account."],
    },
    {
      id: "FIN-DEMO-005",
      description: "Published content must declare an approved archive destination.",
      actionTypes: ["publish_financial_content"],
      effect: "BLOCK",
      requiredContext: ["archiveTarget"],
      conditions: [{ field: "archiveTarget", operator: "known" }],
      remediation: ["Configure an approved archive destination."],
    },
  ],
};

