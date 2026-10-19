import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { BehaviorCoverage } from "./ui-behavior-reconciler.service.js";

const logger = createLogger("UIBehaviorGraph");

export interface BehaviorGraphContext {
  organizationId: number;
  versionId: string;
  appId?: number;
  appSlug?: string;
}

async function persistCoverage(coverage: BehaviorCoverage[], context: BehaviorGraphContext): Promise<void> {
  if (coverage.length === 0) return;
  const orgContext = getSystemOrgContext(context.organizationId);
  const versionNode = await graphService.createNode({
    label: "AppVersion",
    name: `${context.appSlug ?? "App"} ${context.versionId}`,
    externalId: `app-version:${context.versionId}`,
    verificationStatus: coverage.every((entry) => entry.covered) ? "verified" : "staging",
    properties: {
      versionId: context.versionId,
      appId: context.appId ?? null,
      appSlug: context.appSlug ?? null,
    },
    sourceType: "system",
  }, orgContext);

  const docsNode = await graphService.createNode({
    label: "DocumentationSpec",
    name: "Platform UI Documentation",
    externalId: "documentation:ui",
    verificationStatus: "verified",
    properties: { route: "/platform-maintenance/documentation", specType: "ui" },
    sourceType: "system",
  }, orgContext);

  for (const entry of coverage) {
    const behavior = entry.behavior;
    const behaviorNode = await graphService.createNode({
      label: "UIBehavior",
      name: behavior.name,
      externalId: behavior.id,
      verificationStatus: entry.covered ? "verified" : "staging",
      confidenceScore: behavior.confidence,
      description: behavior.expectedOutcome,
      properties: {
        ...behavior,
        covered: entry.covered,
        testIds: entry.tests.map((test) => test.id),
      },
      sourceType: "system",
      sourceRef: behavior.sourceFile,
    }, orgContext);

    const screenNode = await graphService.createNode({
      label: "UIScreen",
      name: behavior.route ?? behavior.sourceFile,
      externalId: `ui-screen:${behavior.route ?? behavior.sourceFile}`,
      verificationStatus: "verified",
      properties: { route: behavior.route, sourceFile: behavior.sourceFile },
      sourceType: "system",
    }, orgContext);

    await graphService.createEdgesBatch([
      {
        sourceNodeId: versionNode.id,
        targetNodeId: behaviorNode.id,
        relation: "INTRODUCED",
        properties: { versionId: context.versionId },
      },
      {
        sourceNodeId: screenNode.id,
        targetNodeId: behaviorNode.id,
        relation: "IMPLEMENTS",
        properties: { sourceFile: behavior.sourceFile },
      },
      {
        sourceNodeId: docsNode.id,
        targetNodeId: behaviorNode.id,
        relation: "DOCUMENTS",
        properties: { sourceRefs: behavior.sourceRefs },
      },
    ], orgContext);

    for (const sourceRef of behavior.sourceRefs.filter((ref) => ref.startsWith("api:"))) {
      const endpoint = sourceRef.slice(4);
      const apiNode = await graphService.createNode({
        label: "APIEndpoint",
        name: endpoint,
        externalId: `api-endpoint:${endpoint}`,
        verificationStatus: "verified",
        properties: { endpoint },
        sourceType: "system",
      }, orgContext);
      await graphService.createEdge({
        sourceNodeId: apiNode.id,
        targetNodeId: behaviorNode.id,
        relation: "SUPPORTS",
      }, orgContext);
    }

    for (const test of entry.tests) {
      const testNode = await graphService.createNode({
        label: "E2ETest",
        name: test.testName,
        externalId: `e2e-test:${test.id}`,
        verificationStatus: "verified",
        properties: {
          testId: test.id,
          suiteId: test.suiteId ?? null,
          behaviorIds: test.behaviorIds ?? [],
          filePath: test.filePath,
          startLine: test.startLine,
          endLine: test.endLine,
        },
        sourceType: "system",
        sourceRef: test.filePath,
      }, orgContext);
      await graphService.createEdge({
        sourceNodeId: testNode.id,
        targetNodeId: behaviorNode.id,
        relation: "VERIFIES",
        properties: { testId: test.id },
      }, orgContext);
    }
  }

  logger.info(`Persisted ${coverage.length} UI behavior contract(s) for ${context.versionId}`);
}

export const uiBehaviorGraphService = { persistCoverage };
