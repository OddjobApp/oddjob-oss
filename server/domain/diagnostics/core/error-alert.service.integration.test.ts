/**
 * ErrorAlertService persistence and tenant scoping.
 *
 * The previous stub returned `{ id: 1, ...config }` from createConfig without
 * writing anything, echoed updates back, and always returned [] from getConfigs.
 * The UI therefore reported every save as successful, always received id 1, and
 * then displayed an empty list.
 *
 * Runs against the real test database, because what matters here — that rows are
 * actually written, and that one tenant cannot read or modify another's configs —
 * cannot be demonstrated against a mock.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { errorAlertConfigs, errorAlerts, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { errorAlertService } from "./error-alert.service.js";

let orgA: number;
let orgB: number;
const createdConfigIds: number[] = [];

// orgs.name carries a UNIQUE constraint, so fixed names make the suite fail on its
// second run — and on its first, if a previous run was interrupted before cleanup.
const suiteTag = `AlertSvc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
    const [a] = await db.insert(orgs).values({ name: `${suiteTag}-A` }).returning();
    const [b] = await db.insert(orgs).values({ name: `${suiteTag}-B` }).returning();
    orgA = a.id;
    orgB = b.id;
});

afterAll(async () => {
    if (createdConfigIds.length) {
        await db.delete(errorAlerts).where(inArray(errorAlerts.configId, createdConfigIds));
        await db.delete(errorAlertConfigs).where(inArray(errorAlertConfigs.id, createdConfigIds));
    }
    await db.delete(orgs).where(eq(orgs.id, orgA));
    await db.delete(orgs).where(eq(orgs.id, orgB));
});

async function makeConfig(organizationId: number, name: string) {
    const id = await errorAlertService.createConfig({
        organizationId,
        name,
        notifyVia: ["email"],
        errorCategories: ["rate_limit"],
        emailRecipients: ["ops@example.test"],
    });
    createdConfigIds.push(id);
    return id;
}

describe("errorAlertService persistence", () => {
    it("actually writes the config and returns its real id", async () => {
        const id = await makeConfig(orgA, "Rate limit watch");

        // The stub always answered 1 regardless of input.
        const [row] = await db.select().from(errorAlertConfigs).where(eq(errorAlertConfigs.id, id));
        expect(row).toBeDefined();
        expect(row.name).toBe("Rate limit watch");
        expect(row.organizationId).toBe(orgA);
        expect(row.notifyVia).toEqual(["email"]);
    });

    it("returns saved configs instead of an empty list", async () => {
        await makeConfig(orgA, "Second watch");
        const configs = await errorAlertService.getConfigs(orgA);

        expect(configs.length).toBeGreaterThanOrEqual(2);
        expect(configs.every(c => c.organizationId === orgA)).toBe(true);
    });

    it("persists an update", async () => {
        const id = await makeConfig(orgA, "Before");
        const ok = await errorAlertService.updateConfig(id, { name: "After", minOccurrences: 9 }, orgA);

        expect(ok).toBe(true);
        const [row] = await db.select().from(errorAlertConfigs).where(eq(errorAlertConfigs.id, id));
        expect(row.name).toBe("After");
        expect(row.minOccurrences).toBe(9);
    });
});

describe("errorAlertService tenant scoping", () => {
    it("does not list another organization's configs", async () => {
        await makeConfig(orgA, "Org A only");
        const bConfigs = await errorAlertService.getConfigs(orgB);
        expect(bConfigs.every(c => c.organizationId === orgB)).toBe(true);
    });

    it("does not return every tenant's configs when no organization is given", async () => {
        await makeConfig(orgA, "Scoped away");
        // An absent org means global configs only, never all of them.
        const globals = await errorAlertService.getConfigs(undefined);
        expect(globals.every(c => c.organizationId === null)).toBe(true);
    });

    it("refuses to update a config belonging to another organization", async () => {
        const id = await makeConfig(orgA, "Owned by A");
        const ok = await errorAlertService.updateConfig(id, { name: "Hijacked" }, orgB);

        expect(ok).toBe(false);
        const [row] = await db.select().from(errorAlertConfigs).where(eq(errorAlertConfigs.id, id));
        expect(row.name).toBe("Owned by A");
    });

    it("refuses to delete a config belonging to another organization", async () => {
        const id = await makeConfig(orgA, "Do not delete");
        const ok = await errorAlertService.deleteConfig(id, orgB);

        expect(ok).toBe(false);
        const [row] = await db.select().from(errorAlertConfigs).where(eq(errorAlertConfigs.id, id));
        expect(row).toBeDefined();
    });
});

describe("errorAlertService.sendAlert", () => {
    it("records the alert and stamps the config, without claiming delivery", async () => {
        const id = await makeConfig(orgA, "Alerting");
        const res = await errorAlertService.sendAlert({
            configId: id,
            errorCount: 5,
            errorCategory: "rate_limit",
            sampleErrors: ["429 Too Many Requests"],
        });

        expect(res.id).toBeGreaterThan(0);
        expect(res.notificationSent).toBe(false);

        const history = await errorAlertService.getAlertHistory(id, orgA);
        expect(history).toHaveLength(1);
        expect(history[0].errorCount).toBe(5);

        const [cfg] = await db.select().from(errorAlertConfigs).where(eq(errorAlertConfigs.id, id));
        expect(cfg.lastTriggeredAt).not.toBeNull();
    });
});
