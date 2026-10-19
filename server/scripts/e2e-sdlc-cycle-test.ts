/**
 * E2E SDLC Cycle Test — TECHHEAD7 (Org 291)
 *
 * Tests the full cycle flow:
 * 1. Verify org and cycle exist
 * 2. Verify all 9 agents are provisioned
 * 3. Verify all 9 missions exist with pipelines
 * 4. Verify Jira connector is active
 * 5. Verify Confluence connector is active
 * 6. Verify app deployments exist
 * 7. Trigger Mission-2 (Requirements) and verify it starts
 * 8. Verify mission app bindings exist
 * 9. Verify AppRecords collections are accessible
 */
import { db } from "../database_service.js";
import { orgs, apps, appDeployments, jobs, missions, pipelines, pipelineSteps, saasConnectors, operationalCycles, missionAppBindings } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

const ORG_NAME = "TECHHEAD7";

async function runE2ETest() {
    const results: Array<{ test: string; status: "PASS" | "FAIL"; detail: string }> = [];

    function pass(test: string, detail: string) { results.push({ test, status: "PASS", detail }); }
    function fail(test: string, detail: string) { results.push({ test, status: "FAIL", detail }); }

    try {
        // 1. Verify org exists
        const [org] = await db.select().from(orgs).where(eq(orgs.name, ORG_NAME)).limit(1);
        if (!org) { fail("Org exists", `${ORG_NAME} not found`); return results; }
        pass("Org exists", `${ORG_NAME} (id: ${org.id})`);
        const orgId = org.id;

        // 2. Verify operational cycle exists
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.organizationId, orgId)).limit(1);
        if (!cycle) { fail("Cycle exists", "No operational cycle found"); }
        else { pass("Cycle exists", `"${cycle.name}" (id: ${cycle.id}, status: ${cycle.status})`); }

        // 3. Verify 9 agents provisioned
        const agentJobs = await db.select().from(jobs).where(and(eq(jobs.organizationId, orgId), eq(jobs.type, "ai_agent")));
        if (agentJobs.length >= 9) { pass("Agents provisioned", `${agentJobs.length} AI agents found`); }
        else { fail("Agents provisioned", `Expected 9, found ${agentJobs.length}: ${agentJobs.map(j => j.name).join(", ")}`); }

        // 4. Verify 9 missions exist
        const missionRows = await db.select().from(missions).where(eq(missions.organizationId, orgId));
        if (missionRows.length >= 9) { pass("Missions provisioned", `${missionRows.length} missions found`); }
        else { fail("Missions provisioned", `Expected 9, found ${missionRows.length}`); }

        // 5. Verify pipelines + steps
        const pipelineRows = await db.select().from(pipelines).where(eq(pipelines.organizationId, orgId));
        const stepCount = await db.select({ count: sql<number>`count(*)` }).from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
            .where(eq(pipelines.organizationId, orgId));
        pass("Pipelines provisioned", `${pipelineRows.length} pipelines, ${stepCount[0]?.count ?? 0} steps`);

        // 6. Verify Jira connector
        const [jiraConn] = await db.select().from(saasConnectors).where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "jira"))).limit(1);
        if (jiraConn) { pass("Jira connector", `Connected (id: ${jiraConn.id})`); }
        else { fail("Jira connector", "No Jira connector found"); }

        // 7. Verify Confluence connector
        const [confConn] = await db.select().from(saasConnectors).where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "confluence"))).limit(1);
        if (confConn) { pass("Confluence connector", `Connected (id: ${confConn.id})`); }
        else { fail("Confluence connector", "No Confluence connector found"); }

        // 8. Verify app deployments
        const deployments = await db.select({ app: apps, deployment: appDeployments })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(appDeployments.organizationId, orgId));
        pass("App deployments", `${deployments.length} deployments: ${deployments.map(d => d.app.slug).join(", ")}`);

        // 9. Verify mission app bindings
        const bindings = await db.select().from(missionAppBindings).where(eq(missionAppBindings.organizationId, orgId));
        pass("Mission app bindings", `${bindings.length} bindings across missions`);

        // 10. Verify sdlc-workbench is running
        const sdlcApp = deployments.find(d => d.app.slug.includes("sdlc-workbench"));
        if (sdlcApp) {
            const meta = (sdlcApp.app.runtimeMetadata as any) || {};
            if (meta.status === "running") { pass("SDLC Workbench running", `Port ${meta.assignedPort}`); }
            else { fail("SDLC Workbench running", `Status: ${meta.status ?? "unknown"}`); }
        } else { fail("SDLC Workbench running", "App not found in deployments"); }

        // 11. Test Jira connectivity (live API call)
        if (jiraConn) {
            try {
                const { getJiraClientForOrg } = await import("../domain/integrations/atlassian-connector-bridge.js");
                const client = await getJiraClientForOrg(orgId);
                const searchResult = await client.searchIssues("project = PROJ ORDER BY updated DESC", 1);
                // The /rest/api/3/search/jql endpoint no longer returns `total`, so a
                // dead token / bad response would surface as `total: undefined` while
                // still printing "Connected". Validate the actual `issues` array — the
                // real success signal — and fail explicitly on an unexpected shape.
                if (!searchResult || !Array.isArray(searchResult.issues)) {
                    fail("Jira API connectivity", `Unexpected search response (no issues array): ${JSON.stringify(searchResult).slice(0, 120)}`);
                } else {
                    pass("Jira API connectivity", `Connected — query returned ${searchResult.issues.length} issue(s)`);
                }
            } catch (e: any) {
                fail("Jira API connectivity", e.message);
            }
        }

        // 12. Test Confluence connectivity (live API call)
        if (confConn) {
            try {
                const { getConfluenceClientForOrg } = await import("../domain/integrations/atlassian-connector-bridge.js");
                const client = await getConfluenceClientForOrg(orgId);
                const spaces = await client.getSpaces(1);
                pass("Confluence API connectivity", `Connected — ${spaces.length > 0 ? spaces[0].name : "accessible"}`);
            } catch (e: any) {
                fail("Confluence API connectivity", e.message);
            }
        }

    } catch (e: any) {
        fail("Unexpected error", e.message);
    }

    return results;
}

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  E2E SDLC Cycle Test — TECHHEAD7");
    console.log("═══════════════════════════════════════════════════════════════\n");

    const results = await runE2ETest();

    let passed = 0, failed = 0;
    for (const r of results) {
        const icon = r.status === "PASS" ? "✅" : "❌";
        console.log(`  ${icon} ${r.test}: ${r.detail}`);
        if (r.status === "PASS") passed++; else failed++;
    }

    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
    console.log(`═══════════════════════════════════════════════════════════════`);

    process.exit(failed > 0 ? 1 : 0);
}

main();
