import { e2eTestIndexerService } from "../server/domain/sdlc-pipeline/autonomous/e2e-test-indexer.service.js";
import {
  createE2ETestAuthoringService,
  type E2ETestDraft,
} from "../server/domain/sdlc-pipeline/autonomous/e2e-test-authoring.service.js";
import type { UIBehaviorContract } from "../server/domain/sdlc-pipeline/autonomous/ui-behavior-reconciler.service.js";

const behavior: UIBehaviorContract = {
  id: "generated.ui-contracts.e2e-runner-ready-state",
  name: "E2E runner ready state is visible",
  kind: "state",
  route: "/health/e2e-tests",
  actor: "authenticated user",
  preconditions: ["The E2E Test Health screen is available"],
  action: "Open E2E Test Health",
  expectedOutcome: "The runner state is visibly reported as Ready",
  sourceFile: "client/src/modules/health/pages/TestHealthDashboard.tsx",
  sourceRefs: ["documentation:e2e-testing", "change:suite-aware-v2-manifest"],
  confidence: 0.95,
  risk: "low",
  needsClarification: false,
  introducedByVersionId: "suite-aware-v2-manifest",
};

const draft: E2ETestDraft = {
  behaviorId: behavior.id,
  testName: "shows the E2E runner ready state",
  targetFile: "tests/regression/generated/e2e-runner-ready.spec.ts",
  rationale: "Seeds the review-gated generated suite with a low-risk visible state contract.",
  code: `test('shows the E2E runner ready state', async ({ page }) => {
  // @behavior ${behavior.id}
  // @tag generated behavior-contract health e2e-testing

  await page.goto('/health/e2e-tests');
  await expect(page.getByText('Runner state', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
});`,
};

const manifest = await e2eTestIndexerService.loadManifestV2();
if (manifest.tests.some((test) => test.behaviorIds?.includes(behavior.id))) {
  console.log(`Behavior ${behavior.id} is already covered; no draft was written.`);
  process.exit(0);
}

const authoringService = createE2ETestAuthoringService({
  generator: {
    async generate() {
      return draft;
    },
  },
});

const result = await authoringService.authorAndValidate(
  behavior,
  manifest.tests,
  `seed:${behavior.introducedByVersionId}`,
);

if (result.status !== "applied") {
  throw new Error(`Generated contract was not applied: ${result.reason ?? result.status}`);
}

await e2eTestIndexerService.indexManifest();
console.log(`Applied ${result.testId} for ${result.behaviorId} after two passing validation runs.`);
process.exit(0);
