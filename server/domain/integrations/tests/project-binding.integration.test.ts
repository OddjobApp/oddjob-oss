import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { projectSaasBindings, saasConnectors } from "@shared/schema/index.js";
import { projectBindingService } from "../project-binding.service.js";
import { saasAdapterInventoryService } from "../saas-adapter-inventory.service.js";

/**
 * Runs against the integration test database (oddjob_test on 5433), never dev.
 * The org/project pair is a real row there. Everything this suite creates is
 * torn down, and only rows it inserted are ever deleted.
 */
const ORG = 1;
const PROJECT = 19;

let createdConnectorIds: number[] = [];

async function makeConnector(platform: string, projectId: number | null = null) {
    const [row] = await db
        .insert(saasConnectors)
        .values({ orgId: ORG, projectId, platform, status: "connected", config: {} })
        .returning({ id: saasConnectors.id });
    createdConnectorIds.push(row.id);
    return row.id;
}

beforeEach(() => {
    createdConnectorIds = [];
});

afterEach(async () => {
    // Bindings cascade from the connector, so removing these is enough.
    for (const id of createdConnectorIds) {
        await db.delete(saasConnectors).where(eq(saasConnectors.id, id));
    }
});

describe("projectBindingService", () => {
    it("binds a Confluence space through the org connection when the project has none", async () => {
        const connectorId = await makeConnector("confluence", null);

        const binding = await projectBindingService.bind({
            orgId: ORG,
            projectId: PROJECT,
            resourceKind: "confluence_space",
            resourceKey: "ENG",
            resourceName: "Engineering",
            resourceType: "global",
            boundBy: "tester",
        });

        expect(binding.connectorId).toBe(connectorId);
        expect(binding.resourceKey).toBe("ENG");
    });

    it("lets one connection carry several spaces, which is the point of the table", async () => {
        await makeConnector("confluence", null);

        await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space",
            resourceKey: "ENG", resourceName: "Engineering",
        });
        await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space",
            resourceKey: "DOCS", resourceName: "Documentation",
        });

        const bindings = await projectBindingService.listForProject(ORG, PROJECT);
        expect(bindings.map((b) => b.resourceKey).sort()).toEqual(["DOCS", "ENG"]);
    });

    it("re-binding the same key refreshes it rather than failing", async () => {
        await makeConnector("confluence", null);

        await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space",
            resourceKey: "ENG", resourceName: "Engineering",
        });
        const again = await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space",
            resourceKey: "ENG", resourceName: "Engineering & Platform",
        });

        expect(again.resourceName).toBe("Engineering & Platform");
        const bindings = await projectBindingService.listForProject(ORG, PROJECT);
        expect(bindings.filter((b) => b.resourceKey === "ENG")).toHaveLength(1);
    });

    it("prefers the project's own connection over the organization's", async () => {
        await makeConnector("confluence", null);
        const projectConnectorId = await makeConnector("confluence", PROJECT);

        const binding = await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space", resourceKey: "ENG",
        });

        expect(binding.connectorId).toBe(projectConnectorId);
    });

    it("refuses to bind when no connection for that platform exists", async () => {
        await expect(projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "jira_project", resourceKey: "PROJ",
        })).rejects.toThrow(/No jira connection/i);
    });

    it("refuses an unknown resource kind rather than writing an unusable row", async () => {
        await expect(projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "sharepoint_site", resourceKey: "X",
        })).rejects.toThrow(/Unknown resource kind/i);
    });

    it("unbinds only within the caller's own project", async () => {
        await makeConnector("confluence", null);
        const binding = await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space", resourceKey: "ENG",
        });

        // A different project must not be able to remove this one's binding.
        expect(await projectBindingService.unbind(ORG, PROJECT + 999, binding.id)).toBeNull();
        expect(await projectBindingService.unbind(ORG, PROJECT, binding.id)).not.toBeNull();
    });
});

describe("adapter inventory with bindings", () => {
    it("reports each bound resource on the connection that carries it", async () => {
        const connectorId = await makeConnector("confluence", null);
        await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space",
            resourceKey: "ENG", resourceName: "Engineering",
        });

        const adapters = await saasAdapterInventoryService.listForProject(ORG, PROJECT);
        const confluence = adapters.find((a) => a.connectorId === connectorId);

        expect(confluence?.bindings.map((b) => b.resourceKey)).toEqual(["ENG"]);
    });

    it("carries no bindings on an organization-wide listing, which has no project", async () => {
        const connectorId = await makeConnector("confluence", null);
        await projectBindingService.bind({
            orgId: ORG, projectId: PROJECT, resourceKind: "confluence_space", resourceKey: "ENG",
        });

        const adapters = await saasAdapterInventoryService.listForProject(ORG, null);
        const confluence = adapters.find((a) => a.connectorId === connectorId);

        expect(confluence?.bindings).toEqual([]);
    });
});
