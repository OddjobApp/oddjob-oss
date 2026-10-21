import { z } from "zod";
import { randomBytes } from "crypto";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { requireToolOrgId } from "./org-context.js";

const logger = createLogger("CrewTaskProposalTools");

/**
 * approvalRequests.token is NOT NULL with no default and carries a unique index.
 * Every proposal tool in this file omitted it, so each insert threw, the catch
 * downgraded it to a warning, and the room rendered an approval card whose
 * proposalId was a Date.now() value pointing at no row.
 */
const newApprovalToken = () => randomBytes(16).toString("hex");

/**
 * Users are UUID-keyed. Proposal rows may be raised by a non-user actor (crew
 * passes "crew", the assistant path passes "assistant"), and writing those into
 * the FK-bearing approver_id column would throw and cost the row entirely.
 */
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function proposeCrewRecord(kind: "crew_decision" | "crew_claim" | "crew_commitment", params: any, context: ToolContext) {
  const orgId = context.organizationId;
  const sessionKey = (context as any).sessionKey || (context as any).channelId;
  if (!orgId || !sessionKey) return `Failed to propose ${kind}: organization and CREW room context are required.`;
  const requestedBy = context.userId || "assistant";
  const { db } = await import("@server/database_service.js");
  const { approvalRequests } = await import("@shared/schema/index.js");
  const meta = { type: "approval_request", kind, ...params, sessionKey, organizationId: orgId, status: "pending" };
  const [inserted] = await db.insert(approvalRequests).values({
    executionId: `${kind}_${Date.now()}`, toolName: `propose_${kind}`, toolArgs: meta,
    approverType: "user", ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
    approverEmail: String(requestedBy), status: "pending", comments: params.reason || null,
    organizationId: orgId, token: newApprovalToken(),
  }).returning({ id: approvalRequests.id });
  return JSON.stringify({ ...meta, proposalId: inserted.id, requestedBy,
    title: kind === "crew_decision" ? `Decision: ${params.statement}` : kind === "crew_claim" ? `Claim: ${params.claim}` : `Commitment: ${params.title}`,
    message: "Approve to add this durable record to the CREW room." });
}

export const CREW_TASK_PROPOSAL_TOOLS: Record<string, ToolDefinition> = {
  propose_crew_decision: {
    name: "propose_crew_decision",

    idempotency: "idempotent", label: "Propose CREW Decision", group: "CREW", riskLevel: "low",
    description: "Propose a durable room decision with rationale, alternatives, confidence, and ontology references. Requires human approval.",
    parameters: z.object({ statement: z.string().min(1), rationale: z.string().optional(), alternatives: z.array(z.string()).default([]), confidence: z.number().min(0).max(100).optional(), ontologyRefs: z.array(z.object({ objectType: z.string(), objectId: z.union([z.string(), z.number()]) })).default([]), reason: z.string().optional() }),
    execute: (params, context) => proposeCrewRecord("crew_decision", params, context),
  },
  propose_crew_claim: {
    name: "propose_crew_claim",

    idempotency: "idempotent", label: "Propose CREW Claim", group: "CREW", riskLevel: "low",
    description: "Propose a durable claim with evidence and confidence for the room evidence ledger. Requires human approval.",
    parameters: z.object({ claim: z.string().min(1), confidence: z.number().min(0).max(100).optional(), evidence: z.array(z.object({ label: z.string(), uri: z.string().optional(), excerpt: z.string().optional() })).default([]), reason: z.string().optional() }),
    execute: (params, context) => proposeCrewRecord("crew_claim", params, context),
  },
  propose_crew_commitment: {
    name: "propose_crew_commitment",

    idempotency: "idempotent", label: "Propose CREW Commitment", group: "CREW", riskLevel: "low",
    description: "Propose an owned, trackable room commitment. Requires human approval.",
    parameters: z.object({ title: z.string().min(1), detail: z.string().optional(), ownerType: z.enum(["user", "agent", "team"]).default("user"), ownerId: z.string().optional(), dueAt: z.string().optional(), ontologyRefs: z.array(z.object({ objectType: z.string(), objectId: z.union([z.string(), z.number()]) })).default([]), reason: z.string().optional() }),
    execute: (params, context) => proposeCrewRecord("crew_commitment", params, context),
  },
  propose_scenario_simulation: {
    name: "propose_scenario_simulation",

    idempotency: "idempotent",
    label: "Propose Scenario Simulation",
    group: "Simulation",
    description:
      "Proposes running a multi-branch Monte Carlo / GMS PMI scenario simulation (e.g., 10,000 iterations) " +
      "to stress-test competing strategies, assess blast radius, and evaluate failure cascades. " +
      "Requires human approval before execution and reports findings directly back into the room.",
    parameters: z.object({
      objective: z.string().describe("The objective or decision being simulated"),
      strategies: z.array(z.string()).min(2).describe("Candidate strategies to compare (e.g. ['Blue/Green Deployment', 'Canary Rollout'])"),
      iterations: z.number().default(10000).describe("Number of Monte Carlo iterations"),
      reason: z.string().describe("Why simulation is needed to resolve the room's divergence"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || (context as any).channelId || null;

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `simulation_${uuidv4()}`,
              toolName: "propose_scenario_simulation",
              toolArgs: { ...params, sessionKey, originAgentCardId: (context as any).agentCardId } as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Leaving it null meant the requester failed the designated-approver
              // check on their own proposal and got a 403 unless they happened to
              // be an admin. Only set when it is a real user id — the column
              // carries an FK to users.id, and crew passes the literal string
              // "crew" when no user is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert simulation approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "scenario_simulation",
          proposalId,
          title: `Monte Carlo Simulation: "${params.objective}"`,
          objective: params.objective,
          strategies: params.strategies,
          iterations: params.iterations,
          reason: params.reason,
          sessionKey,
          priority: "urgent",
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message: `I've prepared a high-priority Monte Carlo simulation across ${params.strategies.length} candidate strategies with ${params.iterations} iterations. Approve to execute.`,
        });
      } catch (err: any) {
        return `Failed to propose scenario simulation: ${err.message}`;
      }
    },
  },

  propose_spatial_analysis: {
    name: "propose_spatial_analysis",

    idempotency: "idempotent",
    label: "Propose Spatial Telemetry & Anomaly Analysis",
    group: "Spatial",
    description:
      "Proposes running an Eulerian Uber H3 hexagonal spatial flux and geofence dwell-time anomaly analysis. " +
      "Identifies congestion clusters and geographic bottlenecks with human approval.",
    parameters: z.object({
      targetArea: z.string().describe("Target metropolitan area, job site, or regional geofence"),
      resolution: z.number().default(8).describe("Uber H3 spatial resolution (e.g. 7-9)"),
      metrics: z.array(z.string()).default(["dwell_time", "flux_vector", "geofence_breach"]).describe("Spatial metrics to evaluate"),
      reason: z.string().describe("Operational rationale for spatial anomaly inspection"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || null;

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `spatial_${uuidv4()}`,
              toolName: "propose_spatial_analysis",
              toolArgs: { ...params, sessionKey } as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Leaving it null meant the requester failed the designated-approver
              // check on their own proposal and got a 403 unless they happened to
              // be an admin. Only set when it is a real user id — the column
              // carries an FK to users.id, and crew passes the literal string
              // "crew" when no user is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert spatial approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "spatial_analysis",
          proposalId,
          title: `H3 Spatial Analysis: "${params.targetArea}"`,
          targetArea: params.targetArea,
          resolution: params.resolution,
          metrics: params.metrics,
          reason: params.reason,
          sessionKey,
          priority: "urgent",
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message: `I've configured an Eulerian H3 spatial analysis for ${params.targetArea} (Resolution ${params.resolution}). Approve to compute spatial flux and geofence clusters.`,
        });
      } catch (err: any) {
        return `Failed to propose spatial analysis: ${err.message}`;
      }
    },
  },

  propose_calculation_eval: {
    name: "propose_calculation_eval",

    idempotency: "idempotent",
    label: "Propose Neuro-Symbolic Calculation Evaluation",
    group: "Calculations",
    description:
      "Proposes running an AST formula calculation, constraint optimization, or probabilistic sensitivity evaluation over knowledge graph nodes.",
    parameters: z.object({
      formulaName: z.string().describe("Name of the calculation or formula node"),
      constraints: z.array(z.string()).describe("List of constraints or bounds (e.g. ['budget <= 50000', 'latency < 200ms'])"),
      inputVariables: z.record(z.any()).describe("Key-value parameters and assumptions"),
      reason: z.string().describe("Why symbolic calculation is needed"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || null;

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `calc_${uuidv4()}`,
              toolName: "propose_calculation_eval",
              toolArgs: { ...params, sessionKey } as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Leaving it null meant the requester failed the designated-approver
              // check on their own proposal and got a 403 unless they happened to
              // be an admin. Only set when it is a real user id — the column
              // carries an FK to users.id, and crew passes the literal string
              // "crew" when no user is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert calculation approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "calculation_eval",
          proposalId,
          title: `Calculation Evaluation: "${params.formulaName}"`,
          formulaName: params.formulaName,
          constraints: params.constraints,
          inputVariables: params.inputVariables,
          reason: params.reason,
          sessionKey,
          priority: "urgent",
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message: `I've prepared a neuro-symbolic AST constraint evaluation for "${params.formulaName}". Approve to compute optimal parameter bounds.`,
        });
      } catch (err: any) {
        return `Failed to propose calculation evaluation: ${err.message}`;
      }
    },
  },

  propose_security_audit: {
    name: "propose_security_audit",

    idempotency: "idempotent",
    label: "Propose Security & Vulnerability Remediation Audit",
    group: "Security",
    description:
      "Proposes running an isolated dependency CVE scan, generating an automated patch branch, and validating container smoke tests.",
    parameters: z.object({
      targetPackageOrService: z.string().describe("Package name, docker service, or repository module to audit"),
      scope: z.string().default("dependencies_and_containers").describe("Audit scope: 'dependencies', 'containers', or 'full'"),
      reason: z.string().describe("Security rationale or detected CVE advisory"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || null;

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `sec_audit_${uuidv4()}`,
              toolName: "propose_security_audit",
              toolArgs: { ...params, sessionKey } as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Leaving it null meant the requester failed the designated-approver
              // check on their own proposal and got a 403 unless they happened to
              // be an admin. Only set when it is a real user id — the column
              // carries an FK to users.id, and crew passes the literal string
              // "crew" when no user is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert security audit approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "security_audit",
          proposalId,
          title: `Security Remediation Audit: "${params.targetPackageOrService}"`,
          targetPackageOrService: params.targetPackageOrService,
          scope: params.scope,
          reason: params.reason,
          sessionKey,
          priority: "urgent",
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message: `I've prepared an automated CVE vulnerability scan and patch candidate for "${params.targetPackageOrService}". Approve to execute in an isolated sandbox.`,
        });
      } catch (err: any) {
        return `Failed to propose security audit: ${err.message}`;
      }
    },
  },

  propose_knowledge_ingestion: {
    name: "propose_knowledge_ingestion",

    idempotency: "idempotent",
    label: "Propose Scoped Data Ingestion & Entity Enrichment",
    group: "Knowledge",
    description:
      "Proposes running a targeted 1-time external ingestion job (e.g. Jira, Zendesk, PDF, or Datasets) " +
      "to extract entity triples and enrich the room's Knowledge Graph.",
    parameters: z.object({
      sourceName: z.string().describe("Source system or dataset (e.g. 'Jira Escalations', 'Zendesk Tickets', 'Vendor Contract PDF')"),
      timeframeOrFilter: z.string().optional().describe("Filter criteria or date range (e.g. 'last 30 days', 'priority: high')"),
      reason: z.string().describe("Why this data is required to inform the room's current debate"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || null;

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `ingest_${uuidv4()}`,
              toolName: "propose_knowledge_ingestion",
              toolArgs: { ...params, sessionKey } as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Leaving it null meant the requester failed the designated-approver
              // check on their own proposal and got a 403 unless they happened to
              // be an admin. Only set when it is a real user id — the column
              // carries an FK to users.id, and crew passes the literal string
              // "crew" when no user is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert ingestion approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "knowledge_ingestion",
          proposalId,
          title: `Knowledge Ingestion: "${params.sourceName}"`,
          sourceName: params.sourceName,
          timeframeOrFilter: params.timeframeOrFilter,
          reason: params.reason,
          sessionKey,
          priority: "urgent",
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message: `I've configured a scoped ingestion pipeline for "${params.sourceName}". Approve to ingest records and enrich the Knowledge Graph.`,
        });
      } catch (err: any) {
        return `Failed to propose knowledge ingestion: ${err.message}`;
      }
    },
  },

  propose_assembly_deployment: {
    name: "propose_assembly_deployment",

    idempotency: "idempotent",
    label: "Propose Scaffolding a New App From the Assembly Stack",
    group: "App Forge",
    description:
      "Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. " +
      "Requires a real application name — the packs describe what to build, not what to call it. " +
      "Use this when asked to deploy, ship, or build out the current assembly stack. " +
      "Call list_scaffold_packs first: pack ids are validated against the registry and an invented id is rejected.",
    parameters: z.object({
      appName: z
        .string()
        .min(3)
        .regex(
          /^[a-z0-9-]+$/,
          "appName must be lowercase alphanumeric with hyphens — it becomes a directory and a DNS label",
        )
        .describe("URL- and DNS-safe application name, e.g. 'tip-calculator'"),
      displayName: z.string().min(3).describe("Human-readable name shown in the app catalog"),
      packs: z
        .array(z.string())
        .min(1)
        // Named a nonexistent pack ('data-postgres-drizzle') as its example,
        // which is one of the ids agents then invented. The example must be a
        // pack that is actually in the registry.
        .describe("Scaffold pack IDs to assemble, taken from list_scaffold_packs (e.g. ['core-node-express'])"),
      reason: z.string().describe("What this application is for"),
      publish: z.boolean().optional().default(false).describe("Set true only when the user explicitly asked to publish or share a link; deploy alone leaves the verified app private"),
      accessPolicy: z.enum(["internal_only", "public"]).optional().default("internal_only").describe("Who may open the published link. Use public only when the user explicitly requested public access"),
      designStyleId: z.string().optional().describe("Optional App Forge design-catalog style ID selected by the user"),
      aiEmbellishment: z.string().optional().describe("Optional visual flourish requested by the user; must not change app features or content"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || (context as any).channelId || null;
        // The room's Project Space travels with the proposal so the scaffold is
        // built under the same scope the discussion happened in, rather than
        // landing unscoped in the org.
        const projectKey = (context as any).projectKey ?? null;
        const projectId = (context as any).projectId ?? null;

        // Resolve the DAG before proposing. A proposal that cannot be executed
        // is worse than a refusal: it asks a human to approve work that will
        // fail, and "Deploy Full Stack" previously sent free text that no tool
        // could act on at all, which cost the room four rounds of debate.
        const { scaffoldRegistryService } = await import("../../../scaffold/scaffold-registry.service.js");
        const { DAGResolver } = await import("../../../scaffold/dag-resolver.js");

        const availablePacks = await scaffoldRegistryService.loadAllPacks();
        const known = new Set(availablePacks.map((p: any) => p.id));
        const unknown = params.packs.filter((p: string) => !known.has(p));
        if (unknown.length > 0) {
          return `Cannot propose this deployment: unknown scaffold pack(s) ${unknown.join(", ")}. Call resolve_assembly_dag or list_scaffold_packs first and propose only pack IDs that exist.`;
        }

        let executionOrder: string[];
        try {
          executionOrder = new DAGResolver(availablePacks)
            .resolveExecutionOrder(params.packs)
            .map((p: any) => p.id);
        } catch (dagErr: any) {
          return `Cannot propose this deployment: the selected packs do not resolve — ${dagErr.message}. Fix the conflict or missing prerequisite before proposing.`;
        }

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `assembly_${uuidv4()}`,
              toolName: "propose_assembly_deployment",
              toolArgs: { ...params, kind: "assembly_deployment", executionOrder, sessionKey, projectKey, projectId } as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Leaving it null meant the requester failed the designated-approver
              // check on their own proposal and got a 403 unless they happened to
              // be an admin. Only set when it is a real user id — the column
              // carries an FK to users.id, and crew passes the literal string
              // "crew" when no user is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert assembly deployment approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "assembly_deployment",
          proposalId,
          title: `${params.publish ? "Deploy and publish" : "Deploy"} new app: "${params.displayName}"`,
          appName: params.appName,
          displayName: params.displayName,
          packs: params.packs,
          executionOrder,
          reason: params.reason,
          publish: params.publish,
          accessPolicy: params.accessPolicy,
          designStyleId: params.designStyleId,
          aiEmbellishment: params.aiEmbellishment,
          sessionKey,
          projectKey,
          priority: "normal",
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message:
            `Ready to assemble, start, and verify "${params.displayName}" (\`${params.appName}\`) from ${executionOrder.length} pack(s), ` +
            `applied in order: ${executionOrder.join(" → ")}.${params.designStyleId ? ` App Builder will apply the ${params.designStyleId} theme under a feature-preservation contract.` : " The original presentation will be preserved."}${params.publish ? ` It will then be published with ${params.accessPolicy} access.` : " It will remain unpublished."} Approve to execute the deployment.`,
        });
      } catch (err: any) {
        return `Failed to propose assembly deployment: ${err.message}`;
      }
    },
  },

  /**
   * Draft an outbound email or Slack message and render it as a confirmation
   * card (the kind = "outbound_message" branch of InlineApprovalCard). Nothing
   * leaves the building until the card's Send posts an approval; Discard marks
   * the request rejected and nothing is sent.
   *
   * The send itself is executed by approval.service's outbound_message branch
   * from the STORED proposal — the approver cannot redirect recipients at
   * approval time.
   */
  propose_outbound_message: {
    name: "propose_outbound_message",

    idempotency: "idempotent",
    label: "Draft Outbound Message for Review",
    group: "Integrations",
    description:
      "Draft an outbound email or Slack message and show it as a confirmation card the human can send or discard. " +
      "Prefer this over a direct send whenever context makes review appropriate: first contact with an external " +
      "recipient, messages making commitments (pricing, dates, legal), replies to a customer or partner, anything " +
      "the user didn't dictate verbatim, or a channel with a broad audience. For a routine internal notice the " +
      "user already asked for verbatim, send directly. Always fill `trigger` and `sensitivity` so the reviewer " +
      "sees the situation the draft came from.",
    parameters: z.object({
      channel: z.enum(["email", "slack"]).describe("Delivery channel for the draft"),
      to: z.union([z.string(), z.array(z.string())]).describe("Recipient email address(es) or Slack channel (e.g. #sales)"),
      from: z.string().optional().describe("Sender address shown on the card (email only; defaults to the connected mailbox)"),
      subject: z.string().optional().describe("Email subject line"),
      body: z.string().min(1).describe("The message body to send"),
      cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC recipients (email only)"),
      bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC recipients, shown for review"),
      bodyFormat: z.enum(["plain", "html"]).optional().describe("Email body format, preserved in the reviewed draft"),
      workspace: z.string().optional().describe("Slack workspace name shown on the card"),
      threadTs: z.string().optional().describe("Slack thread to reply into (thread timestamp)"),
      thread: z.string().optional().describe("Thread label shown on the card (e.g. 'Demo readiness')"),
      sendTool: z.string().optional().describe("User-authored email confirms a connected Google or Microsoft sender on the card. send_agentmail and reply_agentmail are reserved for Oddjob/room notification mail. Never use AgentMail for user-authored correspondence."),
      messageId: z.string().optional().describe("For thread replies gated to this card: the AgentMail message being replied to."),
      trigger: z.string().optional().describe(
        "The situation that produced this draft, in one line — e.g. 'Replying to Dana's question about the migration timeline' or 'User asked the room to notify #sales'. Shown to the reviewer as context for the decision.",
      ),
      sensitivity: z
        .enum(["routine", "requested_review", "external_first_contact", "customer_facing", "commitment_or_legal", "broad_audience"])
        .optional()
        .describe(
          "How consequential this send is if wrong: routine internal, first contact with an external party, " +
          "reply to an existing customer/partner, anything making commitments (price, dates, legal terms), or a " +
          "post reaching a wide channel. The card displays it so the reviewer weighs the right risk.",
        ),
      escalate: z.boolean().optional().describe("Force org-admin review: only an org admin or super admin can send/discard this draft."),
      reason: z.string().optional().describe("Why this message is being sent"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const sessionKey = (context as any).sessionKey || null;
        const agentCardId = (context as any).agentCardId ?? null;
        const agentName = (context as any).agentName ?? null;
        const toList = Array.isArray(params.to) ? params.to : [params.to];
        // High-sensitivity sends are escalated: only an org admin or super
        // admin can decide them — the person who asked for the draft cannot
        // self-approve a commitment-language send (or any send the caller
        // flagged for escalation).
        const requiresOrgAdmin = params.sensitivity === "commitment_or_legal" || params.escalate === true;
        const title = params.channel === "email"
          ? `New email to ${toList.join(", ")}`
          : `Slack message to ${toList.join(", ")}`;

        // The stored meta is the send contract: approval.service executes from
        // toolArgs, so what the card shows is exactly what gets sent.
        const meta = {
          type: "approval_request",
          kind: "outbound_message",
          channel: params.channel,
          to: toList,
          from: params.from ?? null,
          subject: params.subject ?? null,
          body: params.body,
          cc: params.cc ? (Array.isArray(params.cc) ? params.cc : [params.cc]) : null,
          bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc : [params.bcc]) : null,
          bodyFormat: params.bodyFormat ?? "plain",
          workspace: params.workspace ?? null,
          threadTs: params.threadTs ?? null,
          thread: params.thread ?? null,
          sendTool: params.sendTool ?? null,
          messageId: params.messageId ?? null,
          trigger: params.trigger ?? null,
          sensitivity: params.sensitivity ?? null,
          escalatedReview: requiresOrgAdmin,
          reason: params.reason ?? null,
          sessionKey,
          organizationId: orgId,
          agentCardId,
          agentName,
          status: "pending",
        };

        let proposalId = Date.now();
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          // A model that loops on the same send used to mint a fresh card each
          // pass — the mortgage-style duplicate calls apply to proposals too.
          // If an identical pending draft exists for this room, reuse it.
          if (sessionKey) {
            const { and, eq } = await import("drizzle-orm");
            const pending = await db
              .select({ id: approvalRequests.id, toolArgs: approvalRequests.toolArgs })
              .from(approvalRequests)
              .where(and(
                eq(approvalRequests.toolName, "propose_outbound_message"),
                eq(approvalRequests.organizationId, orgId),
                eq(approvalRequests.status, "pending"),
              ))
              .limit(50);
            const fingerprint = (m: any) =>
              JSON.stringify([m.channel, [...(m.to ?? [])].sort(), m.subject ?? "", m.body ?? ""]);
            const existing = pending.find((r) => {
              const m = r.toolArgs as any;
              return m?.kind === "outbound_message" && m.sessionKey === sessionKey && fingerprint(m) === fingerprint(meta);
            });
            if (existing) {
              return JSON.stringify({ ...meta, proposalId: existing.id, title, requestedBy,
                message: "This draft is already waiting on the review card — the room can send or discard it there." });
            }
          }

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `outbound_${uuidv4()}`,
              toolName: "propose_outbound_message",
              toolArgs: meta as any,
              approverType: "user",
              // approverId is what processDecision matches the approver against.
              // Only set when it is a real user id — the column carries an FK to
              // users.id, and crew passes the literal string "crew" when no user
              // is attached to the turn.
              ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              token: newApprovalToken(),
            })
            .returning({ id: approvalRequests.id });
          if (inserted?.id) proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert outbound message approvalRequest: ${dbErr.message}`);
        }

        return JSON.stringify({
          ...meta,
          proposalId,
          title,
          requestedBy,
          message: params.channel === "email"
            ? `Draft ready — review and send to ${toList.join(", ")}.`
            : `Draft ready — review and post to ${toList.join(", ")}.`,
        });
      } catch (err: any) {
        return `Failed to propose outbound message: ${err.message}`;
      }
    },
  },
};
