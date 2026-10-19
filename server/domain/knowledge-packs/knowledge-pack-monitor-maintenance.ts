import { createLogger } from "@server/utils/logger.js";
import { knowledgePackMonitorService } from "./knowledge-pack-monitor.service.js";

const logger = createLogger("KnowledgePackMonitorMaintenance");
const INTERVAL_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export function startKnowledgePackMonitorMaintenance() {
  if (timer) return;
  const run = () => knowledgePackMonitorService.runDue().then(results => logger.info(`Knowledge pack source monitoring completed (${results.length} due)`)).catch(error => logger.error(`Knowledge pack source monitoring failed: ${error.message}`));
  setTimeout(run, 30_000);
  timer = setInterval(run, INTERVAL_MS);
  logger.info("Knowledge pack source monitoring scheduled hourly");
}

export function stopKnowledgePackMonitorMaintenance() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getKnowledgePackMonitorMaintenanceStatus() {
  return { running: timer !== null, intervalMs: INTERVAL_MS };
}
