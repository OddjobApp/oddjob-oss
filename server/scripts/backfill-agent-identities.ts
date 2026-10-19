/**
 * Backfill governed agent identities for existing Oddjob principals.
 *
 * The runtime governance gate now expects active identities and permission
 * grants for agent/job principals. This script discovers existing jobs, public
 * agent deployments, and app deployments, then seeds conservative defaults:
 * reads are allowed, writes/deploys require approval, deletes are denied.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-agent-identities.ts                  # dry run (default)
 *   npx tsx server/scripts/backfill-agent-identities.ts --apply          # write changes
 *   npx tsx server/scripts/backfill-agent-identities.ts --org-id 7       # one org, dry run
 *   npx tsx server/scripts/backfill-agent-identities.ts --limit 20       # preview first 20
 */
import { AgentIdentityBackfillService } from "../domain/governance/core/agent-identity-backfill.service.js";

const APPLY = process.argv.includes("--apply");
const orgId = readNumberFlag("--org-id");
const limit = readNumberFlag("--limit");
const environment = readStringFlag("--environment") ?? "prod";

async function main() {
  const service = new AgentIdentityBackfillService();
  const summary = await service.backfill({
    organizationId: orgId,
    environment,
    limit,
    dryRun: !APPLY,
    createdBy: "agent-identity-backfill",
  });

  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to create identities and grants.");
  }
  process.exit(0);
}

function readStringFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function readNumberFlag(name: string): number | undefined {
  const value = readStringFlag(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
