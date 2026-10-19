/** @vitest-environment node */
/**
 * getExecution resolves an id against two tables, and five ids currently exist in
 * both: 35, 48, 49, 50, 51. Without a kind it tries pipeline_step_executions
 * first and returns that row, so an agent-step link for id 51 silently rendered
 * "Mission Launcher" instead of the agent thought — a wrong record, not an error.
 *
 * These assert which table is queried for each kind. The check is on the query
 * path rather than on returned rows, because the bug was that the wrong table
 * was consulted at all.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/** Records the table each select() targeted. */
const queried: string[] = [];
let pipelineRows: any[] = [];
let agentRows: any[] = [];

function tableNameOf(t: any): string {
    return t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? "unknown";
}

vi.mock("@server/database_service.js", () => {
    const builder = (rows: () => any[]) => {
        const chain: any = {
            from(t: any) { queried.push(tableNameOf(t)); return chain; },
            innerJoin() { return chain; },
            where() { return chain; },
            orderBy() { return chain; },
            limit() { return Promise.resolve(rows()); },
        };
        return chain;
    };
    return {
        db: {
            select() {
                // Which rows come back depends on the table recorded by from().
                return builder(() => {
                    const last = queried[queried.length - 1];
                    if (last === "pipeline_step_executions") return pipelineRows;
                    if (last === "agent_run_steps") return agentRows;
                    return [];
                });
            },
        },
        checkDatabaseConnection: async () => ({ connected: true }),
    };
});

const { monitoringService } = await import("../monitoring.service.js");

const superAdmin = {
    userId: "u", organizationId: null, isAdmin: true, isSuperAdmin: true, isOrgAdmin: false,
} as any;

const pipelineRow = { executionId: 51, jobName: "Mission Launcher", organizationId: null, status: "success" };
const agentRow = { executionId: 51, jobName: "Agent Thought", organizationId: null, status: "success" };

describe("getExecution id kind", () => {
    beforeEach(() => {
        queried.length = 0;
        pipelineRows = [];
        agentRows = [];
    });

    it("kind 'step' never consults agent_run_steps", async () => {
        pipelineRows = [pipelineRow];
        agentRows = [agentRow];
        const res: any = await monitoringService.getExecution(51, superAdmin, "step");
        expect(res.jobName).toBe("Mission Launcher");
        expect(queried).toContain("pipeline_step_executions");
        expect(queried).not.toContain("agent_run_steps");
    });

    it("kind 'agent-step' never consults pipeline_step_executions", async () => {
        // The collision case: both tables hold id 51. Previously the pipeline row won.
        pipelineRows = [pipelineRow];
        agentRows = [agentRow];
        const res: any = await monitoringService.getExecution(51, superAdmin, "agent-step");
        expect(res.jobName).toBe("Agent Thought");
        expect(queried).not.toContain("pipeline_step_executions");
        expect(queried).toContain("agent_run_steps");
    });

    it("kind 'step' 404s for an id that only exists as an agent step", async () => {
        pipelineRows = [];
        agentRows = [agentRow];
        await expect(monitoringService.getExecution(773, superAdmin, "step"))
            .rejects.toThrow("Execution not found");
        expect(queried).not.toContain("agent_run_steps");
    });

    it("kind 'agent-step' 404s for an id that only exists as a pipeline step", async () => {
        pipelineRows = [pipelineRow];
        agentRows = [];
        await expect(monitoringService.getExecution(51, superAdmin, "agent-step"))
            .rejects.toThrow("Execution not found");
    });

    it("no kind keeps the legacy try-pipeline-then-agent behaviour", async () => {
        pipelineRows = [];
        agentRows = [agentRow];
        const res: any = await monitoringService.getExecution(773, superAdmin);
        expect(res.jobName).toBe("Agent Thought");
        expect(queried).toEqual(["pipeline_step_executions", "agent_run_steps"]);
    });

    it("still 404s when neither table has the id", async () => {
        await expect(monitoringService.getExecution(999999, superAdmin))
            .rejects.toThrow("Execution not found");
    });
});

describe("getExecution tenant isolation", () => {
    beforeEach(() => { queried.length = 0; pipelineRows = []; agentRows = []; });

    const otherOrgRow = { executionId: 773, jobName: "Agent Thought", organizationId: 342, status: "success" };

    it("an unscoped super admin may read another org's record", () => {
        agentRows = [otherOrgRow];
        return expect(
            monitoringService.getExecution(773, superAdmin, "agent-step"),
        ).resolves.toMatchObject({ jobName: "Agent Thought" });
    });

    it("a super admin scoped to an org may not read a different org's record", async () => {
        // The documented rule: super admins see everything ONLY with no org selected.
        agentRows = [otherOrgRow];
        const scoped = { ...superAdmin, organizationId: 291 };
        await expect(monitoringService.getExecution(773, scoped, "agent-step"))
            .rejects.toThrow("Access denied");
    });

    it("an org admin may not read another org's record", async () => {
        // This is the case that previously skipped the check entirely: isAdmin was
        // enough to bypass it, including for API-key auth.
        agentRows = [otherOrgRow];
        const orgAdmin = { userId: "u", organizationId: 291, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true } as any;
        await expect(monitoringService.getExecution(773, orgAdmin, "agent-step"))
            .rejects.toThrow("Access denied");
    });

    it("an org member may read their own org's record", () => {
        agentRows = [{ ...otherOrgRow, organizationId: 291 }];
        const member = { userId: "u", organizationId: 291, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as any;
        return expect(
            monitoringService.getExecution(773, member, "agent-step"),
        ).resolves.toMatchObject({ jobName: "Agent Thought" });
    });
});
