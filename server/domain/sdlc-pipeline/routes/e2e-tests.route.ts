import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAuth } from "../../core/auth/security.service.js";
import { e2eTestIndexerService } from "../autonomous/e2e-test-indexer.service.js";
import { testLoopControllerService } from "../autonomous/test-loop-controller.service.js";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { exec } from "node:child_process";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

// Dataset that captures E2E failures (the "Identified Bugs" dataset). Overridable so the
// reporter and this endpoint always agree on the target dataset.
const BUG_DATASET_ID = parseInt(process.env.ODDJOB_BUG_DATASET_ID || "71", 10);

const router = Router();
const logger = createLogger("E2ETestsRoute");

// GET /api/health/e2e-tests
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  logger.info("Fetching E2E tests index");
  let manifest;
  try {
    manifest = await e2eTestIndexerService.loadManifestV2();
  } catch (err) {
    logger.info("Manifest not found. Running E2E test indexer...");
    manifest = await e2eTestIndexerService.indexManifest();
  }
  res.json(manifest);
}));

// POST /api/health/e2e-tests/run
router.post("/run", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { testFiles = ["tests/smoke/dashboard.spec.ts"], testName, runSelfHealing = false } = req.body;
  const sessionId = `ui-run-${randomUUID()}`;

  if (runSelfHealing) {
    logger.info(`UI triggered E2E self-healing run in background: session=${sessionId}`);
    // Execute self-healing loop asynchronously
    testLoopControllerService.executeLoop(sessionId, testFiles, 3)
      .then(result => {
        logger.info(`UI triggered self-healing run completed: session=${sessionId}, status=${result.status}`);
      })
      .catch(err => {
        logger.error(`Error in UI triggered self-healing run: session=${sessionId}`, err);
      });

    return res.json({ success: true, message: "Self-healing test execution started in the background.", sessionId });
  } else {
    logger.info(`UI triggered standard E2E test run in background: files=${testFiles.join(", ")}, testName=${testName || "*"}`);
    const testRepoPath = path.join(process.cwd(), "playwright-test-repo");
    let command = `npx playwright test ${testFiles.join(" ")}`;
    if (testName) {
      command += ` -g "${testName}"`;
    }

    const child = exec(command, {
      cwd: testRepoPath,
      env: { ...process.env, CI: "true" }
    });

    child.on("close", (code) => {
      logger.info(`UI E2E test run finished with exit code ${code}`);
    });

    return res.json({ success: true, message: "Test execution started in the background." });
  }
}));

// POST /api/health/e2e-tests/resolve
// Called by the Playwright reporter when a test PASSES: closes the loop by marking any
// prior open incidents for that test as resolved. Without this, the reporter is insert-only
// and "open failures" grows forever even after the test goes green.
router.post("/resolve", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { testName } = req.body as { testName?: string };
  if (!testName || typeof testName !== "string") {
    return res.status(400).json({ success: false, message: "testName is required" });
  }

  const orgContext = await getUserOrgContext(req);
  const { resolved } = await datasetService.resolveIncidentsByTestName(BUG_DATASET_ID, testName, orgContext);

  if (resolved > 0) {
    logger.info(`Resolved ${resolved} open E2E incident(s) for passing test: "${testName}"`);
  }
  return res.json({ success: true, resolved });
}));

export default router;
