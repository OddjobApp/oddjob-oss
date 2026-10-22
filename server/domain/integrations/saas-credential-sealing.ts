import { eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SaasCredentialSealing");

/**
 * Re-write SaaS connector credentials stored before they were encrypted.
 *
 * `saas_connectors.credentials` held API keys, passwords and OAuth tokens as
 * plain JSON. The column now seals on write (shared/schema/sealed-json.ts); a
 * plaintext row still reads, and this sweep rewrites each one sealed. Idempotent:
 * a sealed row is skipped. A Slack team id found only in the credentials is
 * copied to `config` first, because routing looks it up there and a sealed
 * value cannot be queried.
 */
export async function sealPlaintextSaasCredentials(): Promise<{ sealed: number }> {
    const result = await db.execute(sql`
        SELECT id FROM saas_connectors
        WHERE NOT (credentials ? '__sealed') AND credentials <> '{}'::jsonb
    `);
    const ids = ((result as any).rows ?? result).map((r: { id: number }) => r.id) as number[];
    let sealed = 0;
    for (const id of ids) {
        try {
            const [row] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, id)).limit(1);
            if (!row) continue;
            const credentials = row.credentials ?? {};
            const config = { ...(row.config ?? {}) };
            const teamId = credentials.team_id ?? credentials.teamId;
            if (row.platform === "slack" && teamId && !config.teamId && !config.team_id) config.teamId = teamId;
            await db.update(saasConnectors).set({ credentials, config }).where(eq(saasConnectors.id, id));
            sealed++;
        } catch (error: any) {
            // One unreadable row must not stop the rest; it stays as it was.
            logger.error(`Could not seal credentials of SaaS connector ${id}: ${error?.message}`);
        }
    }
    if (sealed) logger.info(`Sealed the credentials of ${sealed} SaaS connector(s)`);
    return { sealed };
}
