
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB - everything must be self-contained or use globals
vi.mock("@server/database_service.js", () => {
    const createMockQuery = (result: any = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        values: vi.fn().mockReturnThis(),
    });

    const db = {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
    };
    return { db };
});

import { DISCOVERY_TOOLS } from "../../../server/domain/tools/v1/capabilities/discovery.js";
import { db } from "@server/database_service.js";

describe("Discovery Tools", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list_available_mcp_capabilities", () => {
        it("should return a list of inactive tools", async () => {
            const mockServers = [
                { id: 1, name: "jira", description: "Jira integration" },
            ];
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue(mockServers),
            });

            const result = await DISCOVERY_TOOLS.list_available_mcp_capabilities.execute({ search: "jira" }, { organizationId: 1 } as any);

            expect(result).toContain("jira");
            expect(result).toContain("Jira integration");
        });

        it("should return a message when no tools are found", async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([]),
            });

            const result = await DISCOVERY_TOOLS.list_available_mcp_capabilities.execute({}, { organizationId: 1 } as any);

            expect(result).toBe("No inactive MCP capabilities found matching your search.");
        });
    });

    describe("request_mcp_tool", () => {
        it("should insert a rescue session", async () => {
            const insertValuesSpy = vi.fn().mockResolvedValue([]);
            (db.insert as any).mockReturnValue({
                values: insertValuesSpy,
            });

            // The tool reads context.missionRunId — there is no jobId to
            // missionRunId mapping, so passing jobId left the column undefined
            // and the objectContaining match failed on a field the test itself
            // supplied under the wrong name.
            const context = { organizationId: 1, missionId: 10, missionRunId: 100, agentId: "agent-1" };
            const result = await DISCOVERY_TOOLS.request_mcp_tool.execute({ 
                toolName: "jira", 
                reason: "Need to sync tickets" 
            }, context as any);

            expect(result).toContain("SUCCESS");
            expect(insertValuesSpy).toHaveBeenCalledWith(expect.objectContaining({
                serviceType: "tool_discovery",
                missionId: 10,
                missionRunId: 100,
            }));
        });
    });
});
