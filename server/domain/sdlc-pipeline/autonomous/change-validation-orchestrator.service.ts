import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { documentationService } from "@domain/admin/documentation.service.js";
import { e2eTestIndexerService } from "./e2e-test-indexer.service.js";
import { uiBehaviorReconcilerService, mapBehaviorCoverage } from "./ui-behavior-reconciler.service.js";
import { uiBehaviorGraphService } from "./ui-behavior-graph.service.js";
import { e2eTestAuthoringService, type TestAuthoringResult } from "./e2e-test-authoring.service.js";
import { testLoopControllerService } from "./test-loop-controller.service.js";
import { ensureAutonomousRunnersWired } from "./runner-wiring.js";

const logger = createLogger("ChangeValidationOrchestrator");

export interface ChangeValidationInput {
  versionId: string;
  appId: number;
  appSlug?: string;
  organizationId: number;
  changedFiles: string[];
  snapshotPath: string;
  previousSnapshotPath?: string | null;
  message?: string;
}

export interface ChangeValidationResult {
  versionId: string;
  status: "verified" | "blocked" | "no_ui_change";
  behaviorCount: number;
  uncoveredBehaviorCount: number;
  authoredTests: TestAuthoringResult[];
  testStatus?: string;
  documentationUpdated: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function processChange(input: ChangeValidationInput): Promise<ChangeValidationResult> {
  const sessionId = `version:${input.versionId}`;
  await eventStream.publish("version.validation.started", {
    versionId: input.versionId,
    appId: input.appId,
    changedFiles: input.changedFiles,
  }, { organizationId: input.organizationId, subject: input.versionId }, "pipeline");

  const uiFiles = input.changedFiles.filter((file) => /\.(tsx|jsx)$/.test(file));
  if (uiFiles.length === 0) {
    const result: ChangeValidationResult = {
      versionId: input.versionId,
      status: "no_ui_change",
      behaviorCount: 0,
      uncoveredBehaviorCount: 0,
      authoredTests: [],
      documentationUpdated: false,
    };
    await eventStream.publish("version.validation.completed", result, {
      organizationId: input.organizationId,
      subject: input.versionId,
    }, "pipeline");
    return result;
  }

  const initialTests = await e2eTestIndexerService.indexTests();
  const uiDocumentation = await documentationService
    .getUiSpec(input.organizationId)
    .then((spec) => spec.markdown)
    .catch((error) => {
      logger.warn(`Could not load UI documentation for ${input.versionId}`, { error });
      return "";
    });

  let coverage = await uiBehaviorReconcilerService.reconcile({
    versionId: input.versionId,
    changedFiles: uiFiles,
    currentRoot: input.snapshotPath,
    previousRoot: input.previousSnapshotPath,
    changeSummary: input.message,
    documentation: uiDocumentation,
  }, initialTests);

  await eventStream.publish("ui.behavior.detected", {
    versionId: input.versionId,
    behaviorCount: coverage.length,
    uncoveredBehaviorCount: coverage.filter((entry) => !entry.covered).length,
    behaviors: coverage.map((entry) => ({
      id: entry.behavior.id,
      name: entry.behavior.name,
      route: entry.behavior.route,
      confidence: entry.behavior.confidence,
      covered: entry.covered,
    })),
  }, { organizationId: input.organizationId, subject: input.versionId }, "pipeline");

  await uiBehaviorGraphService.persistCoverage(coverage, {
    organizationId: input.organizationId,
    versionId: input.versionId,
    appId: input.appId,
    appSlug: input.appSlug,
  }).catch((error) => logger.error(`Could not persist initial behavior graph for ${input.versionId}`, error));

  const uncoveredBeforeAuthoring = coverage.filter((entry) => !entry.covered);
  const authoredTests: TestAuthoringResult[] = [];
  const autoAuthorEnabled = process.env.E2E_AUTO_AUTHOR_ENABLED === "true";
  if (autoAuthorEnabled) {
    for (const entry of uncoveredBeforeAuthoring) {
      const result = await e2eTestAuthoringService.authorAndValidate(entry.behavior, initialTests, sessionId);
      authoredTests.push(result);
      await eventStream.publish(`e2e.test.authoring.${result.status}`, {
        versionId: input.versionId,
        ...result,
      }, { organizationId: input.organizationId, subject: entry.behavior.id }, "pipeline");
    }
  } else {
    authoredTests.push(...uncoveredBeforeAuthoring.map((entry) => ({
      status: "skipped" as const,
      behaviorId: entry.behavior.id,
      reason: "Automatic authoring is disabled; set E2E_AUTO_AUTHOR_ENABLED=true to enable gated writes",
    })));
  }

  const applied = authoredTests.filter((result) => result.status === "applied");
  const currentTests = applied.length > 0 ? await e2eTestIndexerService.indexTests() : initialTests;
  if (applied.length > 0) {
    coverage = mapBehaviorCoverage(coverage.map((entry) => entry.behavior), currentTests);
    await uiBehaviorGraphService.persistCoverage(coverage, {
      organizationId: input.organizationId,
      versionId: input.versionId,
      appId: input.appId,
      appSlug: input.appSlug,
    }).catch((error) => logger.error(`Could not persist updated behavior graph for ${input.versionId}`, error));
  }

  const affectedTests = unique([
    ...coverage.flatMap((entry) => entry.tests.map((test) => test.filePath)),
    ...applied.map((result) => result.targetFile ? `playwright-test-repo/${result.targetFile}` : ""),
  ]);
  if (affectedTests.length === 0) affectedTests.push("playwright-test-repo/tests/smoke/dashboard.spec.ts");

  ensureAutonomousRunnersWired({ workspaceRoot: process.cwd() });
  const testResult = await testLoopControllerService.executeLoop(sessionId, affectedTests, 3);

  let documentationUpdated = false;
  if (applied.length > 0) {
    try {
      await documentationService.generateForFeature("e2e-testing", input.organizationId);
      await documentationService.generateUiSpec(input.organizationId);
      documentationUpdated = true;
      await eventStream.publish("documentation.validation.updated", {
        versionId: input.versionId,
        authoredTestCount: applied.length,
        documents: ["e2e-testing", "ui"],
      }, { organizationId: input.organizationId, subject: input.versionId }, "pipeline");
    } catch (error) {
      logger.error(`Documentation regeneration failed for ${input.versionId}`, error);
    }
  }

  const remainingUncovered = coverage.filter((entry) => !entry.covered).length;
  const verified = testResult.status === "all_passed" && remainingUncovered === 0;
  const result: ChangeValidationResult = {
    versionId: input.versionId,
    status: verified ? "verified" : "blocked",
    behaviorCount: coverage.length,
    uncoveredBehaviorCount: remainingUncovered,
    authoredTests,
    testStatus: testResult.status,
    documentationUpdated,
  };

  await eventStream.publish(
    verified ? "version.validation.completed" : "version.validation.blocked",
    result,
    { organizationId: input.organizationId, subject: input.versionId },
    "pipeline",
  );
  return result;
}

export const changeValidationOrchestratorService = { processChange };
