import { e2eTestIndexerService } from "../server/domain/sdlc-pipeline/autonomous/e2e-test-indexer.service.js";

const manifest = await e2eTestIndexerService.indexManifest();

console.log(
  `Indexed ${manifest.summary.testCount} tests across ${manifest.summary.populatedSuiteCount}/${manifest.summary.suiteCount} suites.`,
);
