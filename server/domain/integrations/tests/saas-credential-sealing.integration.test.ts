/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { ensureFixtureOrgs } from "../../../../tests/helpers/fixture-orgs.js";
import { sealPlaintextSaasCredentials } from "../saas-credential-sealing.js";

/**
 * SaaS connector credentials used to sit in saas_connectors.credentials as plain
 * JSON. Rows written that way are re-sealed by a boot-time sweep, and every new
 * write is sealed by the column itself. Real Postgres throughout.
 */
const ORG = 9601;
const SECRET = `xoxb-${randomUUID()}`;
const TEAM = `T${randomUUID().slice(0, 8)}`;

async function rawCredentials(id: number): Promise<any> {
    const result: any = await db.execute(sql`SELECT credentials, config FROM saas_connectors WHERE id = ${id}`);
    return (result.rows ?? result)[0];
}

describe("SaaS connector credentials at rest", () => {
    let legacyId = 0;

    beforeAll(async () => {
        await ensureFixtureOrgs([[ORG, "SaaS sealing"]]);
        await db.execute(sql`DELETE FROM saas_connectors WHERE org_id = ${ORG}`);
        // Exactly what the old code stored: plaintext JSON, team id only in credentials.
        const result: any = await db.execute(sql`
            INSERT INTO saas_connectors (org_id, platform, status, config, credentials)
            VALUES (${ORG}, 'slack', 'connected', '{}'::jsonb,
                    ${JSON.stringify({ bot_token: SECRET, team_id: TEAM })}::jsonb)
            RETURNING id`);
        legacyId = (result.rows ?? result)[0].id;
    });

    afterAll(async () => {
        await db.execute(sql`DELETE FROM saas_connectors WHERE org_id = ${ORG}`);
    });

    it("reads a plaintext row before the sweep", async () => {
        const [row] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, legacyId));
        expect(row.credentials).toEqual({ bot_token: SECRET, team_id: TEAM });
    });

    it("seals it in place, keeps it readable, and moves the Slack team id to config", async () => {
        const { sealed } = await sealPlaintextSaasCredentials();
        expect(sealed).toBeGreaterThanOrEqual(1);

        const raw = await rawCredentials(legacyId);
        expect(Object.keys(raw.credentials)).toEqual(["__sealed"]);
        expect(JSON.stringify(raw)).not.toContain(SECRET);
        expect(raw.config.teamId).toBe(TEAM);

        const [row] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, legacyId));
        expect(row.credentials).toEqual({ bot_token: SECRET, team_id: TEAM });
    });

    it("is idempotent", async () => {
        const before = await rawCredentials(legacyId);
        await sealPlaintextSaasCredentials();
        expect(await rawCredentials(legacyId)).toEqual(before);
    });

    it("seals a new write without any caller doing anything", async () => {
        const token = `jira-${randomUUID()}`;
        const [created] = await db.insert(saasConnectors).values({
            orgId: ORG, platform: "jira", status: "connected", config: {}, credentials: { api_key: token },
        }).returning();
        expect(created.credentials).toEqual({ api_key: token });
        expect(JSON.stringify(await rawCredentials(created.id))).not.toContain(token);
    });

    it("still routes a Slack message to its connector by team id", async () => {
        const { conversationalBridgeService } = await import("../conversational-bridge.service.js");
        const connector = await (conversationalBridgeService as any).resolveConnector({ platform: "slack", teamId: TEAM });
        expect(connector?.id).toBe(legacyId);
        expect(connector?.credentials?.bot_token).toBe(SECRET);
    });
});
