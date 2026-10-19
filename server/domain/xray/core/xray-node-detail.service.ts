import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { computeLineDiff } from "@shared/utils/json-diff.js";
import {
  xrayNodeDocumentation,
  xrayNodeDocChanges,
  knowledgeTopics,
  jobs,
  pipelines,
  missions,
  datasets,
  operationalCycles,
  agentDeployments,
  skills,
  missionRuns
} from "@shared/schema/index.js";
import {
  ontologyObjectTypes,
  ontologyObjects,
  ontologyActions,
  ontologyLinkTypes,
  ontologyActionLog
} from "@shared/schema/ontology/ontology.js";
import { eq, and, or, isNull, count, desc } from "drizzle-orm";
import { xrayCompositionService } from "./xray-composition.service.js";
import { xrayOperationalGuideService } from "./xray-operational-guide.service.js";
import type { CompositionNode, CompositionEdge } from "../types/composition.js";

const logger = createLogger("XrayNodeDetailService");

export interface DetailedNodePayload {
  node: CompositionNode;
  documentation: {
    id?: number;
    knowledgeTopicId?: number;
    summary?: string;
    content: string;
    status: "published" | "draft" | "ai_generated";
    contentFingerprint?: string | null;
    documentationStatus: "up-to-date" | "outdated" | "missing";
    tags: string[];
    isAiGenerated: boolean;
    updatedAt?: string;
  };
  inbound: { node: CompositionNode; relation: string; label: string }[];
  outbound: { node: CompositionNode; relation: string; label: string }[];
  specs: Record<string, unknown>;
  telemetry: {
    totalRuns?: number;
    lastRunAt?: string;
    successRate?: number;
    errorCount?: number;
  };
}

export const xrayNodeDetailService = {
  async getNodeDetail(
    scope: string,
    nodeId: string,
    organizationId: number,
    isSuperAdmin = false
  ): Promise<DetailedNodePayload | null> {
    try {
      // 1. Build or fetch composition graph for context
      const graph = await xrayCompositionService.buildGraph(scope, organizationId, { isSuperAdmin });
      const targetNode = graph.nodes.find(n => n.id === nodeId);
      if (!targetNode) {
        logger.warn(`Node ${nodeId} not found in scope ${scope}`);
        return null;
      }

      // 2. Resolve Inbound & Outbound relationships
      const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
      const inbound: { node: CompositionNode; relation: string; label: string }[] = [];
      const outbound: { node: CompositionNode; relation: string; label: string }[] = [];

      for (const e of graph.edges) {
        if (e.target === nodeId && nodeMap.has(e.source)) {
          inbound.push({
            node: nodeMap.get(e.source)!,
            relation: e.relation,
            label: e.label,
          });
        }
        if (e.source === nodeId && nodeMap.has(e.target)) {
          outbound.push({
            node: nodeMap.get(e.target)!,
            relation: e.relation,
            label: e.label,
          });
        }
      }

      // 3. Fetch Documentation record from database
      const [existingDoc] = await db
        .select()
        .from(xrayNodeDocumentation)
        .where(
          and(
            eq(xrayNodeDocumentation.nodeId, nodeId),
            or(
              eq(xrayNodeDocumentation.organizationId, organizationId),
              isNull(xrayNodeDocumentation.organizationId)
            )
          )
        )
        .limit(1);

      // Check if matching Knowledge Topic exists for bi-directional link
      let linkedTopicId = existingDoc?.knowledgeTopicId ?? undefined;
      if (!linkedTopicId && targetNode.label) {
        const [matchingTopic] = await db
          .select({ id: knowledgeTopics.id })
          .from(knowledgeTopics)
          .where(
            and(
              eq(knowledgeTopics.name, targetNode.label),
              or(
                eq(knowledgeTopics.organizationId, organizationId),
                isNull(knowledgeTopics.organizationId)
              )
            )
          )
          .limit(1);
        if (matchingTopic) {
          linkedTopicId = matchingTopic.id;
        }
      }

      // Default documentation fallback if none exists
      let docStatus: "up-to-date" | "outdated" | "missing" = "missing";
      if (existingDoc) {
        docStatus = (existingDoc.documentationStatus as "up-to-date" | "outdated" | "missing") || "up-to-date";
      }

      const docPayload = existingDoc
        ? {
            id: existingDoc.id,
            knowledgeTopicId: linkedTopicId,
            summary: existingDoc.summary ?? undefined,
            content: existingDoc.content,
            status: existingDoc.status as "published" | "draft" | "ai_generated",
            contentFingerprint: existingDoc.contentFingerprint ?? createHash("sha256").update(existingDoc.content.trim()).digest("hex"),
            documentationStatus: docStatus,
            tags: (existingDoc.tags as string[]) ?? [],
            isAiGenerated: existingDoc.isAiGenerated,
            updatedAt: existingDoc.updatedAt.toISOString(),
          }
        : {
            knowledgeTopicId: linkedTopicId,
            summary: targetNode.description ?? `${targetNode.label} (${targetNode.type})`,
            content: "",
            status: "draft" as const,
            contentFingerprint: null,
            documentationStatus: "missing" as const,
            tags: [targetNode.type],
            isAiGenerated: false,
          };

      // 4. Fetch Node Specs & Code Snippet
      const specs: Record<string, unknown> = {
        ...targetNode.metadata,
        filePath: targetNode.filePath,
        dbId: targetNode.dbId,
      };

      // Code snippet if file exists
      if (targetNode.filePath) {
        try {
          const absolutePath = path.isAbsolute(targetNode.filePath)
            ? targetNode.filePath
            : path.join(process.cwd(), targetNode.filePath);

          const stat = await fs.stat(absolutePath);
          if (stat.isFile() && stat.size < 200_000) {
            const rawContent = await fs.readFile(absolutePath, "utf-8");
            const lines = rawContent.split("\n");
            // Slice first 60 lines for preview
            specs.codePreview = lines.slice(0, 60).join("\n");
            specs.lineCount = lines.length;
            specs.fileSizeBytes = stat.size;
          }
        } catch {
          // Ignore file read errors for virtual or missing files
        }
      }

      // Database entity enrichment
      if (targetNode.dbId) {
        if (targetNode.type === "job_definition" || targetNode.type === "agent" || targetNode.type === "supervisor") {
          const [jobRow] = await db.select().from(jobs).where(eq(jobs.id, targetNode.dbId)).limit(1);
          if (jobRow) {
            specs.jobType = jobRow.type;
            specs.name = jobRow.name;
            specs.config = jobRow.config;
            specs.isActive = jobRow.isActive;
          }
        } else if (targetNode.type === "pipeline") {
          const [pipeRow] = await db.select().from(pipelines).where(eq(pipelines.id, targetNode.dbId)).limit(1);
          if (pipeRow) {
            specs.name = pipeRow.name;
            specs.lifecycleStatus = pipeRow.lifecycleStatus;
            specs.triggerType = pipeRow.triggerType;
            specs.isActive = pipeRow.isActive;
          }
        } else if (targetNode.type === "mission") {
          const [missionRow] = await db.select().from(missions).where(eq(missions.id, targetNode.dbId)).limit(1);
          if (missionRow) {
            specs.title = missionRow.name;
            specs.executionStrategy = missionRow.executionStrategy;
            specs.status = missionRow.status;
          }
        } else if (targetNode.type === "dataset") {
          const [datasetRow] = await db.select().from(datasets).where(eq(datasets.id, targetNode.dbId)).limit(1);
          if (datasetRow) {
            specs.name = datasetRow.name;
            specs.schemaMapping = datasetRow.schemaMapping;
            specs.validationRules = datasetRow.validationRules;
          }
        } else if (targetNode.type === "ontology_object_type") {
          const [typeRow] = await db.select().from(ontologyObjectTypes).where(eq(ontologyObjectTypes.id, targetNode.dbId)).limit(1);
          if (typeRow) {
            specs.name = typeRow.name;
            specs.description = typeRow.description;
            specs.backing = typeRow.backing;
            specs.sourceAdapter = typeRow.sourceAdapter;
            specs.titleProperty = typeRow.titleProperty;
            specs.propertiesSchema = typeRow.propertiesSchema;
            specs.icon = typeRow.icon;
            specs.isActive = typeRow.isActive;

            if (typeRow.backing === "materialized") {
              const [objCount] = await db.select({ count: count() }).from(ontologyObjects)
                .where(and(eq(ontologyObjects.organizationId, organizationId), eq(ontologyObjects.objectTypeId, typeRow.id)));
              specs.materializedInstanceCount = objCount?.count ?? 0;
            }
          }
        } else if (targetNode.type === "ontology_action") {
          const [actionRow] = await db.select().from(ontologyActions).where(eq(ontologyActions.id, targetNode.dbId)).limit(1);
          if (actionRow) {
            specs.name = actionRow.name;
            specs.description = actionRow.description;
            specs.effect = actionRow.effect;
            specs.handlerKind = actionRow.handlerKind;
            specs.handlerRef = actionRow.handlerRef;
            specs.requiresApproval = actionRow.requiresApproval;
            specs.riskLevel = actionRow.riskLevel;
            specs.parametersSchema = actionRow.parametersSchema;
            specs.objectTypeId = actionRow.objectTypeId;
            specs.isActive = actionRow.isActive;
          }
        } else if (targetNode.type === "ontology_link_type") {
          const [linkRow] = await db.select().from(ontologyLinkTypes).where(eq(ontologyLinkTypes.id, targetNode.dbId)).limit(1);
          if (linkRow) {
            specs.name = linkRow.name;
            specs.inverseName = linkRow.inverseName;
            specs.description = linkRow.description;
            specs.cardinality = linkRow.cardinality;
            specs.backing = linkRow.backing;
            specs.sourceTypeId = linkRow.sourceTypeId;
            specs.targetTypeId = linkRow.targetTypeId;
            specs.sourceProperty = linkRow.sourceProperty;
            specs.targetProperty = linkRow.targetProperty;
            specs.targetTypeProperty = linkRow.targetTypeProperty;
            specs.targetTypeMap = linkRow.targetTypeMap;
            specs.path = linkRow.path;
            specs.isActive = linkRow.isActive;
          }
        }
      }

      // 5. Telemetry metrics aggregation
      const telemetry: DetailedNodePayload["telemetry"] = {};

      if (targetNode.dbId && (targetNode.type === "mission" || targetNode.type === "pipeline" || targetNode.type === "job_definition")) {
        try {
          const [runStats] = await db
            .select({
              totalRuns: count(),
            })
            .from(missionRuns)
            .where(eq(missionRuns.organizationId, organizationId));

          const [lastRun] = await db
            .select({ createdAt: missionRuns.createdAt })
            .from(missionRuns)
            .where(eq(missionRuns.organizationId, organizationId))
            .orderBy(desc(missionRuns.createdAt))
            .limit(1);

          telemetry.totalRuns = Number(runStats?.totalRuns ?? 0);
          if (lastRun) telemetry.lastRunAt = lastRun.createdAt.toISOString();
        } catch {
          // Non-blocking telemetry query catch
        }
      } else if (targetNode.dbId && targetNode.type === "ontology_action") {
        try {
          const [actionStats] = await db
            .select({ totalRuns: count() })
            .from(ontologyActionLog)
            .where(and(eq(ontologyActionLog.organizationId, organizationId), eq(ontologyActionLog.actionId, targetNode.dbId)));

          const [errorStats] = await db
            .select({ failedCount: count() })
            .from(ontologyActionLog)
            .where(and(
              eq(ontologyActionLog.organizationId, organizationId),
              eq(ontologyActionLog.actionId, targetNode.dbId),
              eq(ontologyActionLog.status, "failed")
            ));

          const [lastExec] = await db
            .select({ createdAt: ontologyActionLog.createdAt })
            .from(ontologyActionLog)
            .where(and(eq(ontologyActionLog.organizationId, organizationId), eq(ontologyActionLog.actionId, targetNode.dbId)))
            .orderBy(desc(ontologyActionLog.createdAt))
            .limit(1);

          const total = Number(actionStats?.totalRuns ?? 0);
          const failed = Number(errorStats?.failedCount ?? 0);
          telemetry.totalRuns = total;
          telemetry.errorCount = failed;
          telemetry.successRate = total > 0 ? ((total - failed) / total) * 100 : 100;
          if (lastExec) telemetry.lastRunAt = lastExec.createdAt.toISOString();
        } catch {
          // Non-blocking telemetry query catch
        }
      }

      return {
        node: targetNode,
        documentation: docPayload,
        inbound,
        outbound,
        specs,
        telemetry,
      };
    } catch (err: any) {
      logger.error(`Error fetching node detail for ${nodeId}`, err);
      throw err;
    }
  },

  computeSpecFingerprint(content: string): string {
    return createHash("sha256").update(content.trim()).digest("hex");
  },

  async recordNodeDocChange(params: {
    organizationId: number;
    nodeId: string;
    nodeType: string;
    kind: "addition" | "change" | "deletion";
    previousFingerprint?: string | null;
    newFingerprint: string;
    explanation?: string;
    oldContent?: string;
    newContent: string;
    authorId?: number;
    isAiGenerated?: boolean;
  }) {
    let addedLines = 0;
    let removedLines = 0;
    let diffStr = "";

    if (params.kind === "addition") {
      const lines = params.newContent.split("\n");
      addedLines = lines.length;
      diffStr = lines.map(l => `+ ${l}`).join("\n");
    } else if (params.kind === "change" && params.oldContent) {
      const diffLines = computeLineDiff(params.oldContent, params.newContent);
      addedLines = diffLines.filter(l => l.type === "add").length;
      removedLines = diffLines.filter(l => l.type === "remove").length;
      diffStr = diffLines.map(l => (l.type === "add" ? `+ ${l.content}` : l.type === "remove" ? `- ${l.content}` : `  ${l.content}`)).join("\n");
    }

    await db.insert(xrayNodeDocChanges).values({
      organizationId: params.organizationId,
      nodeId: params.nodeId,
      nodeType: params.nodeType,
      kind: params.kind,
      previousFingerprint: params.previousFingerprint ?? null,
      newFingerprint: params.newFingerprint,
      explanation: params.explanation ?? (params.kind === "addition" ? "X-Ray spec initialized" : "X-Ray spec updated"),
      addedLines,
      removedLines,
      diff: diffStr,
      authorId: params.authorId ?? null,
      isAiGenerated: params.isAiGenerated ?? false,
    });
  },

  async saveNodeDocumentation(
    nodeId: string,
    nodeType: string,
    summary: string | undefined,
    content: string,
    organizationId: number,
    authorId?: number,
    isAiGenerated = false
  ) {
    // 1. Sync or create Knowledge Topic for global Documentation feature
    let knowledgeTopicId: number | undefined;
    const nodeLabel = nodeId.split("::")[1] ?? nodeId;

    try {
      const [existingTopic] = await db
        .select()
        .from(knowledgeTopics)
        .where(
          and(
            eq(knowledgeTopics.name, nodeLabel),
            eq(knowledgeTopics.organizationId, organizationId)
          )
        )
        .limit(1);

      if (existingTopic) {
        knowledgeTopicId = existingTopic.id;
        await db
          .update(knowledgeTopics)
          .set({ description: summary ?? existingTopic.description, updatedAt: new Date() })
          .where(eq(knowledgeTopics.id, existingTopic.id));
      } else {
        const [insertedTopic] = await db
          .insert(knowledgeTopics)
          .values({
            name: nodeLabel,
            description: summary ?? `${nodeType} documentation`,
            organizationId,
          })
          .returning();
        knowledgeTopicId = insertedTopic.id;
      }
    } catch (err) {
      logger.warn(`Failed to sync Knowledge Topic for ${nodeId}: ${err}`);
    }

    // 2. Save X-Ray Node Documentation with SHA-256 fingerprint & change recording
    const newFingerprint = this.computeSpecFingerprint(content);

    const [existing] = await db
      .select()
      .from(xrayNodeDocumentation)
      .where(
        and(
          eq(xrayNodeDocumentation.nodeId, nodeId),
          eq(xrayNodeDocumentation.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existing) {
      const prevFingerprint = existing.contentFingerprint ?? this.computeSpecFingerprint(existing.content);
      const isChanged = prevFingerprint !== newFingerprint;

      const [updated] = await db
        .update(xrayNodeDocumentation)
        .set({
          summary: summary ?? existing.summary,
          content,
          status: "published",
          contentFingerprint: newFingerprint,
          documentationStatus: "up-to-date",
          knowledgeTopicId: knowledgeTopicId ?? existing.knowledgeTopicId,
          authorId: authorId ?? existing.authorId,
          updatedAt: new Date(),
        })
        .where(eq(xrayNodeDocumentation.id, existing.id))
        .returning();

      if (isChanged) {
        await this.recordNodeDocChange({
          organizationId,
          nodeId,
          nodeType,
          kind: "change",
          previousFingerprint: prevFingerprint,
          newFingerprint,
          explanation: isAiGenerated ? "AI re-generated spec" : "Manual update",
          oldContent: existing.content,
          newContent: content,
          authorId,
          isAiGenerated,
        });

        // Only on a real content change — the fingerprint above is exactly the
        // signal for "worth re-embedding", and re-filing an unchanged spec would
        // churn the vector store on every save.
        await this.mirrorSpecToKnowledgeBase({
          organizationId,
          nodeId,
          nodeType,
          summary: summary ?? existing.summary ?? undefined,
          content,
          knowledgeTopicId: knowledgeTopicId ?? existing.knowledgeTopicId ?? undefined,
          xrayDocumentationId: existing.id,
          contentFingerprint: newFingerprint,
        });
      }

      return updated;
    } else {
      const [inserted] = await db
        .insert(xrayNodeDocumentation)
        .values({
          organizationId,
          nodeId,
          nodeType,
          summary: summary ?? "",
          content,
          status: "published",
          contentFingerprint: newFingerprint,
          documentationStatus: "up-to-date",
          knowledgeTopicId,
          authorId,
          isAiGenerated,
        })
        .returning();

      await this.recordNodeDocChange({
        organizationId,
        nodeId,
        nodeType,
        kind: "addition",
        previousFingerprint: null,
        newFingerprint,
        explanation: isAiGenerated ? "AI generated initial spec" : "Manual initial spec creation",
        newContent: content,
        authorId,
        isAiGenerated,
      });

      await this.mirrorSpecToKnowledgeBase({
        organizationId,
        nodeId,
        nodeType,
        summary: summary ?? undefined,
        content,
        knowledgeTopicId,
        xrayDocumentationId: inserted.id,
        contentFingerprint: newFingerprint,
      });

      return inserted;
    }
  },

  /** The knowledge-base title a node's spec is filed under. Stable by design:
   *  createDocument upserts on (project_id, title), so a changing title would
   *  orphan the previous copy instead of updating it. nodeType is included
   *  because labels collide across types — `scope::x` and `screen::/x` both
   *  reduce to something very close. */
  specDocumentTitle(nodeId: string, nodeType: string): string {
    const nodeLabel = nodeId.split("::")[1] ?? nodeId;
    return `X-Ray Spec: ${nodeLabel} (${nodeType})`;
  },

  /**
   * Files a node's spec into the knowledge base as a real document.
   *
   * WHY THIS EXISTS
   *
   * saveNodeDocumentation has always created a knowledge TOPIC for each node
   * ("Sync or create Knowledge Topic for global Documentation feature") and
   * stored its id back on the row — but nothing ever created a document under
   * that topic. All 15 topics held zero documents, so ~450KB of hand-written
   * architecture specs sat in a table that search_unified_knowledge does not
   * read. The folder was created; nothing was ever filed in it.
   *
   * xray_node_documentation remains the source of truth — it owns versioning,
   * fingerprints and the change register. This copy exists so the content is
   * discoverable by the same search every other document answers to.
   */
  async mirrorSpecToKnowledgeBase(params: {
    organizationId: number;
    nodeId: string;
    nodeType: string;
    summary?: string;
    content: string;
    knowledgeTopicId?: number;
    xrayDocumentationId: number;
    contentFingerprint: string;
  }): Promise<number | null> {
    if (!params.content?.trim()) return null;

    try {
      const { documentService } = await import(
        "@domain/knowledge/core/extraction/document-service.js"
      );

      const doc = await documentService.createDocument(
        {
          title: this.specDocumentTitle(params.nodeId, params.nodeType),
          summary: params.summary,
          textContent: params.content,
          sourceType: "xray_spec",
          metadata: {
            type: "xray_spec",
            nodeId: params.nodeId,
            nodeType: params.nodeType,
            xrayDocumentationId: params.xrayDocumentationId,
            contentFingerprint: params.contentFingerprint,
          },
          ...(params.knowledgeTopicId ? { topicIds: [params.knowledgeTopicId] } : {}),
        } as any,
        {
          organizationId: params.organizationId,
          userId: "xray",
          isAdmin: false,
          isSuperAdmin: false,
          isOrgAdmin: false,
        } as any,
      );

      logger.info(
        `Filed X-Ray spec ${params.nodeId} into the knowledge base as document ${(doc as any)?.id}`,
      );
      return (doc as any)?.id ?? null;
    } catch (err: any) {
      // Loud, and greppable. The whole reason this content was invisible for
      // months is that failures on this path were logged as warnings nobody
      // read — the spec save itself must still succeed, but this is an error.
      logger.error(
        `KB MIRROR FAILED for X-Ray spec ${params.nodeId} (org ${params.organizationId}): ${err?.message ?? err}. ` +
        `The spec is saved but will NOT be findable by knowledge search.`,
      );
      return null;
    }
  },

  async getNodeDocChangeRegister(nodeId: string, organizationId: number, limit = 50) {
    return db
      .select()
      .from(xrayNodeDocChanges)
      .where(
        and(
          eq(xrayNodeDocChanges.nodeId, nodeId),
          eq(xrayNodeDocChanges.organizationId, organizationId)
        )
      )
      .orderBy(desc(xrayNodeDocChanges.createdAt))
      .limit(limit);
  },

  async getOrgXraySpecChangeRegister(organizationId: number, limit = 50) {
    return db
      .select()
      .from(xrayNodeDocChanges)
      .where(eq(xrayNodeDocChanges.organizationId, organizationId))
      .orderBy(desc(xrayNodeDocChanges.createdAt))
      .limit(limit);
  },

  async generateNodeDocumentation(
    scope: string,
    nodeId: string,
    organizationId: number
  ) {
    const details = await this.getNodeDetail(scope, nodeId, organizationId);
    if (!details) throw new Error(`Node ${nodeId} not found`);

    const { node, inbound, outbound, specs, telemetry } = details;

    const codeSnippet = (specs.codePreview as string | undefined) ?? "";
    const inboundList = inbound.map(i => `- **${i.node.label}** (${i.node.type}) via \`${i.relation}\``).join("\n") || "_None (Root element)_";
    const outboundList = outbound.map(o => `- **${o.node.label}** (${o.node.type}) via \`${o.relation}\``).join("\n") || "_None (Terminal element)_";

    let generatedMarkdown = "";

    try {
      const { llmRouterService } = await import("@domain/ai/core/llm-router.service.js");
      const systemPrompt = `You are a Principal Software Architect documenting system components for the enterprise Oddjob platform.
Generate a structured, professional, and detailed Technical Summary Document in clean GitHub-flavored Markdown.

Include the following standardized sections:
1. ## Executive & Business Summary
   (Explain high-level business goals, domain responsibilities, target workflows, and who/what relies on this component).
2. ## Core Business Logic & Rule Enforcement
   (Provide step-by-step operational flow, validation logic, state machine rules, and exception/failure handling).
3. ## Interaction & Control Flow Diagram
   (Include a valid Mermaid diagram showing how this node interacts with inbound triggers and outbound targets).
4. ## Data Contracts & System Side Effects
   (Detail input/output parameters, database mutations, emitted events, and external API integrations).
5. ## Observability & Recovery Guidelines
   (Document performance expectations, telemetry error metrics, edge cases, and maintainer instructions).`;

      const userPrompt = `Synthesize a Technical Summary Document for the following component:
Component ID: ${node.id}
Label: ${node.label}
Type: ${node.type}
Scope: ${scope}
Source File Path: ${node.filePath ?? "N/A"}

Technical Specifications & Metadata:
${JSON.stringify(specs, null, 2)}

Telemetry Performance Data:
${JSON.stringify(telemetry ?? {}, null, 2)}

Inbound Dependencies (Callers / Triggers):
${inboundList}

Outbound Dependencies (Entities Modified / Invoked):
${outboundList}

Source Code Snippet Preview:
\`\`\`typescript
${codeSnippet.slice(0, 1500)}
\`\`\``;

      const aiResponse = await llmRouterService.complete(
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.3,
          routingStrategy: "quality",
        },
        organizationId
      );

      if (aiResponse?.content && aiResponse.content.trim().length > 100) {
        generatedMarkdown = aiResponse.content.trim();
      }
    } catch (err: any) {
      logger.warn(`AI spec synthesis fallback triggered for ${nodeId}: ${err.message}`);
    }

    if (!generatedMarkdown) {
      if (node.type === "ontology_object_type") {
        const backing = String(specs.backing ?? "materialized");
        const adapter = specs.sourceAdapter ? ` (Adapter: \`${specs.sourceAdapter}\`)` : "";
        const propEntries = specs.propertiesSchema && typeof specs.propertiesSchema === "object" 
          ? Object.entries(specs.propertiesSchema)
          : specs.properties && typeof specs.properties === "object" 
            ? Object.entries(specs.properties)
            : [];

        generatedMarkdown = `# Technical Summary Document: ${node.label} (Ontology Object Type)

## 1. Executive & Business Summary
**${node.label}** is a curated **Business Object Type** with \`${backing}\` storage backing${adapter} operating within the **${scope}** domain architecture.
> ${node.description ?? `Defines the structural data contract, domain properties, and operational policies for ${node.label}.`}

### Key Responsibilities
- Serves as a governed entity definition in the AIP-style business ontology.
- Backing Strategy: \`${backing}\`${adapter}
- Display Title Property: \`${specs.titleProperty ?? "name"}\`
${specs.materializedInstanceCount !== undefined ? `- Materialized Instance Count: **${specs.materializedInstanceCount}** records in \`ontology_objects\`` : ""}
${node.dbId ? `- Registry Database ID: \`ontology_object_type::${node.dbId}\`` : ""}

---

## 2. Domain Properties & Schema Contract
| Property Name | Type / Description |
| :--- | :--- |
${propEntries.length ? propEntries.map(([k, v]) => `| **${k}** | \`${typeof v === "object" ? JSON.stringify(v) : String(v)}\` |`).join("\n") : "| _(No properties registered)_ | - |"}

---

## 3. Governed Actions & Operational Capabilities
Actions executed against **${node.label}** enforce parameter validation, approval guardrails, and audit logging:
${outbound.filter(o => o.node.type === "ontology_action" || o.relation === "ACTS_ON").map(o => `- **${o.node.label}** (\`${o.node.type}\`)`).join("\n") || inbound.filter(i => i.node.type === "ontology_action" || i.relation === "ACTS_ON").map(i => `- **${i.node.label}** (\`${i.relation}\`)`).join("\n") || "_No specific actions directly linked in this graph._"}

---

## 4. Relationship & Link Topology
${inbound.length ? `### Inbound Link Traversal (Incoming References)\n${inboundList}\n` : ""}
${outbound.length ? `### Outbound Link Traversal (Outgoing Relationships)\n${outboundList}\n` : ""}

---

## 5. Governance, Multi-Tenant Isolation & Audit Policy
- **Org Isolation**: Strictly isolated by \`organization_id\`. Cross-tenant reads/writes are disallowed by construction.
- **Auditability**: All state mutations and action executions are logged with actor identity, timestamp, parameters, and result status.
`;
      } else if (node.type === "ontology_action") {
        const effect = String(specs.effect ?? "read");
        const handlerKind = String(specs.handlerKind ?? "builtin");
        const requiresApproval = Boolean(specs.requiresApproval);
        const riskLevel = String(specs.riskLevel ?? "medium");
        const params = specs.parametersSchema && typeof specs.parametersSchema === "object"
          ? Object.entries(specs.parametersSchema)
          : [];

        generatedMarkdown = `# Technical Summary Document: ${node.label} (Governed Action)

## 1. Executive & Business Summary
**${node.label}** is a governed **Ontology Action** with effect \`${effect.toUpperCase()}\` and handler kind \`${handlerKind}\` operating within the **${scope}** domain architecture.
> ${node.description ?? `Enforces structured validation, execution routing, and safety governance for ${node.label}.`}

### Governance Profile
- **Effect Type**: \`${effect}\` (${effect === "write" ? "State Mutating" : "Read-Only"})
- **Handler Kind**: \`${handlerKind}\` (Ref: \`${specs.handlerRef ?? "standard"}\`)
- **Risk Level**: \`${riskLevel}\`
- **Approval Gate**: ${requiresApproval ? "⚠️ **Mandatory Human-in-the-Loop Approval Required**" : "✅ **Automated Execution Permitted**"}
${node.dbId ? `- Registry Database ID: \`ontology_action::${node.dbId}\`` : ""}

---

## 2. Parameter Contract & Validation Rules
| Parameter | Type / Constraints |
| :--- | :--- |
${params.length ? params.map(([k, v]) => `| **${k}** | \`${typeof v === "object" ? JSON.stringify(v) : String(v)}\` |`).join("\n") : "| _(No parameters required)_ | - |"}

---

## 3. Target Business Entities & Execution Topology
### Target Business Object Type
${outbound.filter(o => o.node.type === "ontology_object_type" || o.relation === "ACTS_ON").map(o => `- **${o.node.label}** (\`${o.relation}\`)`).join("\n") || "_Generic / System-wide action_"}

### Pipeline & Worker Integration
${outbound.filter(o => o.node.type === "pipeline" || o.relation === "TRIGGERS").map(o => `- Triggers Execution Pipeline: **${o.node.label}**`).join("\n") || "_Direct in-process handler_"}

---

## 4. Observability & Execution Telemetry
| Metric | Value |
| :--- | :--- |
| **Total Executions** | ${telemetry.totalRuns ?? 0} |
| **Failed Executions** | ${telemetry.errorCount ?? 0} |
| **Success Rate** | ${telemetry.successRate !== undefined ? `${telemetry.successRate.toFixed(1)}%` : "N/A"} |
| **Last Execution** | ${telemetry.lastRunAt ?? "Never"} |

- **Audit Log**: Every invocation generates an immutable record in \`ontology_action_log\`.
`;
      } else if (node.type === "ontology_link_type") {
        const cardinality = String(specs.cardinality ?? "one_to_many");
        const backing = String(specs.backing ?? "derived");
        const pathHops = Array.isArray(specs.path) ? (specs.path as string[]).join(" -> ") : "N/A";

        generatedMarkdown = `# Technical Summary Document: ${node.label} (Ontology Link Type)

## 1. Relationship Specification & Semantics
**${node.label}** is a typed **Ontology Link Type** declaring the relationship between business object types.
> ${node.description ?? `Governs relationship traversal, join key resolution, and bi-directional navigation.`}

### Relationship Summary
- **Forward Name**: \`${specs.name ?? node.label}\` (Source -> Target)
- **Inverse Name**: \`${specs.inverseName ?? "inverse"}\` (Target -> Source)
- **Cardinality**: \`${cardinality}\`
- **Backing Strategy**: \`${backing}\` (${backing === "derived" ? "Foreign Key Join" : backing === "materialized" ? "Stored Graph Edge" : "Composed Path Hops"})
${specs.sourceProperty ? `- Source Join Key: \`${specs.sourceProperty}\`` : ""}
${specs.targetProperty ? `- Target Join Key: \`${specs.targetProperty}\`` : ""}
${specs.targetTypeProperty ? `- Polymorphic Discriminator: \`${specs.targetTypeProperty}\`` : ""}
${backing === "path" ? `- Traversal Hops: \`${pathHops}\`` : ""}
${node.dbId ? `- Registry Database ID: \`ontology_link_type::${node.dbId}\`` : ""}

---

## 2. Connected Object Types
### Source Object Type
${outbound.filter(o => o.relation === "DEFINES_FORWARD").map(o => `- **${o.node.label}** (\`ontology_object_type\`)`).join("\n") || "_Unspecified_"}

### Target Object Type(s)
${outbound.filter(o => o.relation === "DEFINES_REVERSE" || o.relation === "TARGETS_OBJECT_TYPE").map(o => `- **${o.node.label}** (\`${o.relation === "TARGETS_OBJECT_TYPE" ? "Polymorphic Target" : "Direct Target"}\`)`).join("\n") || "_Polymorphic / Dynamic Target_"}

---

## 3. Traversal Semantics & Completeness Guarantees
- **Forward Traversal**: Resolves from source to target using indexed foreign keys or stored edge tables.
- **Inverse Traversal**: Navigates from target back to source via \`${specs.inverseName ?? "inverse"}\`.
- **Integrity**: Enforces multi-tenant organizational isolation and join key validation.
`;
      } else {
        generatedMarkdown = `# Technical Summary Document: ${node.label}

## 1. Executive & Business Summary
**${node.label}** is a \`${node.type.replace(/_/g, " ")}\` component operating within the **${scope}** domain architecture.
> ${node.description ?? `Executes core domain logic and manages state transitions for ${node.label}.`}

### Key Responsibilities
- Executes operational logic within scope \`${scope}\`.
${node.filePath ? `- Source File: \`${node.filePath}\`` : ""}
${node.dbId ? `- Registry Database ID: \`#${node.dbId}\`` : ""}

---

## 2. Core Business Logic & Rule Enforcement
- **Validation**: Enforces parameter and state preconditions prior to executing downstream operations.
- **Execution Flow**: Processes input payload, updates domain registries, and returns operation results.
- **Error Handling**: Catches runtime errors, rolls back database transactions, and records failure metrics to System Telemetry.

---

## 3. Data Contracts & Technical Specifications
| Property | Value |
| :--- | :--- |
| **Node ID** | \`${node.id}\` |
| **Type** | \`${node.type}\` |
| **Scope** | \`${scope}\` |
${Object.entries(specs)
  .filter(([k]) => k !== "codePreview" && k !== "metadata")
  .map(([k, v]) => `| **${k}** | \`${typeof v === "object" ? JSON.stringify(v) : String(v)}\` |`)
  .join("\n")}

${codeSnippet ? `\n### Code Snippet Preview\n\`\`\`typescript\n${codeSnippet.slice(0, 1000)}\n\`\`\`\n` : ""}

---

## 4. Architectural Dependencies

### Inbound Connections (Triggers / Consumers)
${inboundList}

### Outbound Connections (Invoked / Modified Entities)
${outboundList}

---

## 5. Observability & Operational Guidelines
- **Observability**: Track health status, latency, and error counts in System Telemetry.
- **Maintenance**: Auto-fingerprinted via SHA-256 to track structural and logic changes.
`;
      }
    }

    const summary = `${node.label} Technical Summary Document (${node.type.replace(/_/g, " ")}) in ${scope}.`;

    const doc = await this.saveNodeDocumentation(
      nodeId,
      node.type,
      summary,
      generatedMarkdown,
      organizationId,
      undefined,
      true
    );

    await db
      .update(xrayNodeDocumentation)
      .set({ isAiGenerated: true, status: "ai_generated" })
      .where(eq(xrayNodeDocumentation.id, doc.id));

    return {
      ...doc,
      content: generatedMarkdown,
      isAiGenerated: true,
      status: "ai_generated",
    };
  },

  /**
   * Bi-Directional Sync Helper: Synchronizes Blueprint or App Documentation
   * across both Knowledge Topics and X-Ray Node Documentation.
   */
  async syncBlueprintOrAppDocs(
    nodeId: string,
    nodeType: string,
    name: string,
    description: string,
    markdownContent: string,
    organizationId: number
  ) {
    logger.info(`[XrayNodeDetail] Syncing Blueprint/App doc: ${nodeId} (${name})`);
    return this.saveNodeDocumentation(
      nodeId,
      nodeType,
      description,
      markdownContent,
      organizationId
    );
  },

  /**
   * Generates a full Application Architecture Document for an entire scope (App or Platform),
   * structured around discovered components, layers, and relationships.
   */
  async generateAppArchitectureDoc(scope: string, organizationId: number) {
    logger.info(`[XrayNodeDetail] Synthesizing Component & Relationship App Doc for scope: ${scope}`);
    await xrayCompositionService.invalidateCache(scope, organizationId);
    const graph = await xrayCompositionService.buildGraph(scope, organizationId, { skipCache: true });
    
    // Group nodes by architectural layer
    const screens = graph.nodes.filter(n => n.type === "screen");
    const apis = graph.nodes.filter(n => n.type === "api_endpoint");
    const components = graph.nodes.filter(n => n.type === "ui_component");
    const jobsList = graph.nodes.filter(n => n.type === "job_definition" || n.type === "agent" || n.type === "supervisor");
    const pipelinesList = graph.nodes.filter(n => n.type === "pipeline");
    const missionsList = graph.nodes.filter(n => n.type === "mission");
    const datasetsList = graph.nodes.filter(n => n.type === "dataset");
    const knowledgeList = graph.nodes.filter(n => n.type === "knowledge_cluster");
    const modules = graph.nodes.filter(n => n.type === "npm_module");
    const uiBehaviors = graph.nodes.filter(n => n.type === "ui_behavior");
    const e2eTests = graph.nodes.filter(n => n.type === "e2e_test");
    const ontologyTypes = graph.nodes.filter(n => n.type === "ontology_object_type");
    const ontologyActions = graph.nodes.filter(n => n.type === "ontology_action");
    const ontologyLinks = graph.nodes.filter(n => n.type === "ontology_link_type");

    const mermaidDiagram = xrayCompositionService.toMermaid(graph);
    const operationalGuide = xrayOperationalGuideService.buildGuide(graph);
    const businessDefinitionMarkdown = xrayOperationalGuideService.businessDefinitionToMarkdown(operationalGuide);
    const operationalGuideMarkdown = xrayOperationalGuideService.toMarkdown(operationalGuide);

    // Build markdown document
    const docMarkdown = `# Application Architecture Specification: ${graph.scope.name}

> Auto-generated component & relationship architecture specification for **${graph.scope.name}** (Scope: \`${scope}\`). Indexed at \`${graph.indexedAt}\`.

---

${businessDefinitionMarkdown}

---

## 1. System Composition Overview
Total discovered system components: **${graph.nodes.length}** nodes with **${graph.edges.length}** structural connections.

### Component Census
| Layer / Type | Discovered Count | Description |
| :--- | :--- | :--- |
| **Screens / Routes** | ${screens.length} | User-facing application routes and pages |
| **API Endpoints** | ${apis.length} | HTTP REST / GraphQL backend interface routes |
| **UI Components** | ${components.length} | Frontend widgets, modals, and design components |
| **Missions & Orchestration** | ${missionsList.length} | Goal-directed autonomous execution missions |
| **Pipelines & Workflows** | ${pipelinesList.length} | Multi-step execution graphs |
| **Agents & Jobs** | ${jobsList.length} | Specialized AI background workers & cron jobs |
| **Datasets & Knowledge** | ${datasetsList.length + knowledgeList.length} | Structured tables, RAG clusters, and vectors |
| **Ontology Object Types** | ${ontologyTypes.length} | Curated business entity definitions (Virtual & Materialized) |
| **Governed Actions** | ${ontologyActions.length} | Governed operations, handlers, and approval gates |
| **Ontology Link Types** | ${ontologyLinks.length} | Typed relationships between business objects |
| **Domain Modules** | ${modules.length} | Core TypeScript/NPM domain packages |
| **Verified UI Behaviors** | ${uiBehaviors.length} | User-visible functional contracts linked to E2E evidence |
| **E2E Tests** | ${e2eTests.length} | Playwright tests providing verification evidence |

---

## 2. Platform Component Dependency Flow

\`\`\`mermaid
${mermaidDiagram}
\`\`\`

---

## 3. Layered Architectural Breakdown

### 3.1 User Interface & Screens
${screens.length ? screens.map(s => `- **${s.label}** (${s.metadata?.route ?? "Route unspecified"})\n  - File: \`${s.filePath ? path.relative(process.cwd(), s.filePath) : "N/A"}\``).join("\n") : "_No screens indexed in this scope._"}

### 3.2 API & Access Interface
${apis.length ? apis.map(a => `- **${a.label}** (\`${a.metadata?.route ?? a.id}\`)\n  - File: \`${a.filePath ? path.relative(process.cwd(), a.filePath) : "N/A"}\``).join("\n") : "_No API endpoints indexed in this scope._"}

### 3.3 Orchestration, Pipelines & Missions
${missionsList.length ? missionsList.map(m => `- **Mission**: ${m.label} (Strategy: \`${m.metadata?.executionStrategy ?? "Standard"}\`)`).join("\n") : ""}
${pipelinesList.length ? pipelinesList.map(p => `- **Pipeline**: ${p.label} (Trigger: \`${p.metadata?.triggerType ?? "Manual"}\`)`).join("\n") : ""}
${jobsList.length ? jobsList.map(j => `- **Job/Agent**: ${j.label} (Type: \`${j.metadata?.jobType ?? j.type}\`)`).join("\n") : ""}

### 3.4 Data & Storage Layer
${datasetsList.length ? datasetsList.map(d => `- **Dataset**: ${d.label} (Type: \`${d.metadata?.type ?? "Standard"}\`)`).join("\n") : "_No datasets linked._"}

### 3.5 Domain Modules & Internal Packages
${modules.length ? modules.map(m => `- **Domain Module**: ${m.label}\n  - File: \`${m.filePath ? path.relative(process.cwd(), m.filePath) : "N/A"}\``).join("\n") : "_No domain modules linked in this scope._"}

### 3.6 Ontology & Semantic Knowledge Layer
${knowledgeList.length ? knowledgeList.map(k => `- **Ontology Cluster**: ${k.label} (Domain: \`${k.metadata?.domain ?? "System"}\`)`).join("\n") : "_No ontology clusters linked in this scope._"}

### 3.7 Business Ontology Layer
${ontologyTypes.length ? `#### Object Types (${ontologyTypes.length})
${ontologyTypes.map(ot => `- **${ot.label}** (${ot.metadata?.backing ?? "materialized"}${ot.metadata?.sourceAdapter ? `, adapter: ${ot.metadata.sourceAdapter}` : ""})
  - Properties: ${ot.metadata?.propertyCount ?? 0} defined
  - ID: \`ontology_object_type::${ot.dbId}\``).join("\n")}` : "_No ontology object types defined._"}

${ontologyActions.length ? `#### Governed Actions (${ontologyActions.length})
${ontologyActions.map(oa => `- **${oa.label}** (${oa.metadata?.effect ?? "read"}${oa.metadata?.requiresApproval ? ", requires approval" : ""})
  - Handler: ${oa.metadata?.handlerKind ?? "builtin"}
  - Risk Level: ${oa.metadata?.riskLevel ?? "medium"}
  - ID: \`ontology_action::${oa.dbId}\``).join("\n")}` : "_No ontology actions defined._"}

${ontologyLinks.length ? `#### Link Types (${ontologyLinks.length})
${ontologyLinks.map(ol => `- **${ol.label}** (${ol.metadata?.cardinality ?? "one_to_many"}, ${ol.metadata?.backing ?? "derived"})
  - Source Type ID: ${ol.metadata?.sourceTypeId ?? "polymorphic"}
  - Target Type ID: ${ol.metadata?.targetTypeId ?? "polymorphic"}
  - ID: \`ontology_link_type::${ol.dbId}\``).join("\n")}` : "_No ontology link types defined._"}

### 3.8 Frontend Functional Behavior and E2E Evidence
${uiBehaviors.length ? uiBehaviors.map(b => {
  const verificationEdges = graph.edges.filter(e => e.source === b.id && e.relation === "VERIFIED_BY");
  const evidence = verificationEdges.map(e => graph.nodes.find(n => n.id === e.target)).filter(Boolean);
  const routes = Array.isArray(b.metadata?.routes) ? b.metadata.routes as string[] : [];
  const steps = Array.isArray(b.metadata?.steps) ? b.metadata.steps as string[] : [];
  const assertions = Array.isArray(b.metadata?.assertions) ? b.metadata.assertions as string[] : [];
  return `#### ${b.label}

**Functional description:** ${b.metadata?.functionalDescription ?? b.description ?? b.label}

- **Evidence status:** \`${b.metadata?.evidenceStatus ?? "inferred"}\`
${routes.length ? `- **Routes:** ${routes.map(r => `\`${r}\``).join(", ")}` : "- **Routes:** Not statically identified"}
${evidence.length ? `- **Verified by:** ${evidence.map(t => `\`${t?.label}\` (${t?.filePath ? path.relative(process.cwd(), t.filePath) : "source unavailable"}:${t?.metadata?.startLine ?? "?"})`).join(", ")}` : "- **Verified by:** No linked E2E test"}
${steps.length ? `- **Test-derived flow:**\n${steps.map((step, index) => `  ${index + 1}. ${step}`).join("\n")}` : ""}
${assertions.length ? `- **Acceptance evidence:**\n${assertions.map(a => `  - \`${a}\``).join("\n")}` : "- **Acceptance evidence:** No explicit assertion extracted"}`;
}).join("\n") : "_No E2E-linked frontend behavior contracts were discovered._"}

---

## 4. Key Relationships & Interconnections

### 4.1 Module & Package Dependencies
${graph.edges.filter(e => e.relation === "PART_OF" || (e.relation as string) === "IMPORTS" || e.relation === "DEPENDS_ON").map(e => `- **${e.source}** \`--[${e.relation}]-->\` **${e.target}** (${e.label})`).join("\n") || "_No explicit module imports._"}

### 4.2 Operational Execution & Data Flow
${graph.edges.filter(e => e.relation !== "PART_OF" && (e.relation as string) !== "IMPORTS" && e.relation !== "DEPENDS_ON").slice(0, 40).map(e => `- **${e.source}** \`--[${e.relation}]-->\` **${e.target}** (${e.label})`).join("\n") || "_No execution edges._"}
${graph.edges.length > 40 ? `\n_...and ${graph.edges.length - 40} additional structural relationships._` : ""}

---

${operationalGuideMarkdown}
`;

    const docName = `${graph.scope.name} Architecture Specification`;
    const docSummary = `Full component and relationship architecture specification for ${graph.scope.name}, including ${graph.nodes.length} components and ${graph.edges.length} relationships.`;

    const savedDoc = await this.syncBlueprintOrAppDocs(
      `scope::${scope}`,
      "app_architecture",
      docName,
      docSummary,
      docMarkdown,
      organizationId
    );

    return {
      doc: savedDoc,
      markdown: docMarkdown,
      graphSummary: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        scope: graph.scope,
      },
    };
  },
};
