// GENERATED FILE — do not edit by hand.
// Produced by scripts/generate-executor-manifest.mjs (run via npm run build /
// npm run gen:executor-manifest; freshness enforced by check:executor-manifest).
// See that script for why the bundle needs a static import list.
import type { JobExecutor } from "./executor-types.js";

import * as m0 from "./ai-agent-executor.js";
import * as m1 from "./ai-api-executor.js";
import * as m2 from "./airflow-executor.js";
import * as m3 from "./amortize-sim-executor.js";
import * as m4 from "./api-executor.js";
import * as m5 from "./apply-accepted-proposals-executor.js";
import * as m6 from "./autoresearch-weaknesses-executor.js";
import * as m7 from "./balance-lock-executor.js";
import * as m8 from "./cash-drag-scan-executor.js";
import * as m9 from "./cashflow-forecast-executor.js";
import * as m10 from "./cloud-function-executor.js";
import * as m11 from "./collect-evaluation-results-executor.js";
import * as m12 from "./computer-use-executor.js";
import * as m13 from "./confluence-sync-executor.js";
import * as m14 from "./crm-sync-executor.js";
import * as m15 from "./decision-executor.js";
import * as m16 from "./dispatcher-executor.js";
import * as m17 from "./dms-evaluate-executor.js";
import * as m18 from "./email-executor.js";
import * as m19 from "./estimated-tax-calc-executor.js";
import * as m20 from "./evolve-harness-executor.js";
import * as m21 from "./file-export-executor.js";
import * as m22 from "./file-ops-executor.js";
import * as m23 from "./file-writer-executor.js";
import * as m24 from "./folder-import-executor.js";
import * as m25 from "./forecast-calibration-executor.js";
import * as m26 from "./forecast-rollup-executor.js";
import * as m27 from "./form-agent-executor.js";
import * as m28 from "./generate-statements-executor.js";
import * as m29 from "./git-executor.js";
import * as m30 from "./github-op-executor.js";
import * as m31 from "./github-sync-executor.js";
import * as m32 from "./google-drive-sync-executor.js";
import * as m33 from "./human-approval-executor.js";
import * as m34 from "./information-return-assemble-executor.js";
import * as m35 from "./iterator-executor.js";
import * as m36 from "./jira-migration-executor.js";
import * as m37 from "./jira-sync-executor.js";
import * as m38 from "./lead-qualify-executor.js";
import * as m39 from "./log-evaluation-result-executor.js";
import * as m40 from "./media-take-executor.js";
import * as m41 from "./mine-weaknesses-executor.js";
import * as m42 from "./monitoring-executor.js";
import * as m43 from "./node-executor.js";
import * as m44 from "./openapi-executor.js";
import * as m45 from "./pdf-parse-executor.js";
import * as m46 from "./pipeline-post-executor.js";
import * as m47 from "./prediction-inference-executor.js";
import * as m48 from "./presentation-assembly-executor.js";
import * as m49 from "./propose-harness-changes-executor.js";
import * as m50 from "./python-executor.js";
import * as m51 from "./quote-generation-executor.js";
import * as m52 from "./receivables-scan-executor.js";
import * as m53 from "./repeater-executor.js";
import * as m54 from "./reranker-executor.js";
import * as m55 from "./sales-analytics-executor.js";
import * as m56 from "./sales-tax-compile-executor.js";
import * as m57 from "./save-to-dataset-executor.js";
import * as m58 from "./scribe-publish-executor.js";
import * as m59 from "./selenium-job-executor.js";
import * as m60 from "./sharepoint-sync-executor.js";
import * as m61 from "./shell-executor.js";
import * as m62 from "./slack-executor.js";
import * as m63 from "./smart-scraper-executor.js";
import * as m64 from "./spatial-reranker-executor.js";
import * as m65 from "./sql-executor.js";
import * as m66 from "./statement-ingest-executor.js";
import * as m67 from "./static-executor.js";
import * as m68 from "./subscription-scan-executor.js";
import * as m69 from "./supervisor-job-executor.js";
import * as m70 from "./teams-executor.js";
import * as m71 from "./territory-assignment-executor.js";
import * as m72 from "./transformer-executor.js";
import * as m73 from "./unified-sync-executor.js";
import * as m74 from "./update-harness-registry-executor.js";
import * as m75 from "./validate-harness-proposals-executor.js";
import * as m76 from "./window-calibrate-executor.js";
import * as m77 from "./window-evaluate-executor.js";
import * as m78 from "./window-open-executor.js";
import * as m79 from "./window-score-executor.js";
import * as m80 from "./winloss-reconcile-executor.js";
import * as m81 from "./youtube-sync-executor.js";

const modules = [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27, m28, m29, m30, m31, m32, m33, m34, m35, m36, m37, m38, m39, m40, m41, m42, m43, m44, m45, m46, m47, m48, m49, m50, m51, m52, m53, m54, m55, m56, m57, m58, m59, m60, m61, m62, m63, m64, m65, m66, m67, m68, m69, m70, m71, m72, m73, m74, m75, m76, m77, m78, m79, m80, m81];

export function getBundledExecutors(): JobExecutor[] {
  const out: JobExecutor[] = [];
  for (const mod of modules) {
    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function' && exported.prototype && 'canExecute' in exported.prototype) {
        out.push(new (exported as new () => JobExecutor)());
      }
    }
  }
  return out;
}
