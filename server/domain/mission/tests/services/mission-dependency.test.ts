import { it, expect, describe, vi, beforeEach } from "vitest";
import { db } from "@server/database_service.js";
import { missionDependencyResolver } from "@domain/mission/core/mission-dependency-resolver.service.js";
// Same schema import as resolver so table identity matches (jobs vs credentials)
import { jobs, credentials, pipelineSteps } from "@shared/schema/index.js";

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(),
    },
}));

describe("MissionDependencyResolver", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return remediation metadata for missing credentials", async () => {
        const mockJob = {
            id: 1,
            name: "Test Slack Job",
            type: "slack_post",
            config: { credentialId: 123 },
            organizationId: 100,
        };

        // Chain mock: resolver uses same @shared/schema table refs, so table identity matches
        (db.select as any).mockImplementation(() => {
            const chain: any = {
                from: vi.fn().mockImplementation((table: any) => {
                    chain._table = table;
                    return chain;
                }),
                innerJoin: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockImplementation(() => {
                    const table = chain._table;
                    let result: any[] = [];
                    if (table === jobs) {
                        result = [mockJob];
                    } else if (table === credentials) {
                        result = [];
                    }
                    // pipelineSteps (supervisor check): no row = warning only
                    if (table === pipelineSteps) {
                        result = [];
                    }
                    return { then: (resolve: any) => resolve(result) };
                }),
                execute: vi.fn().mockImplementation(() => {
                    const table = chain._table;
                    let result: any[] = [];
                    if (table === jobs) result = [mockJob];
                    else if (table === credentials) result = [];
                    else if (table === pipelineSteps) result = [];
                    return Promise.resolve(result);
                }),
            };
            return chain;
        });

        const result = await missionDependencyResolver.validateAndResolve(
            [
                { role: "Messenger", entityType: "job", entityId: 1 },
            ],
            100
        );

        expect(result.valid).toBe(false);
        expect(result.missing.length).toBeGreaterThan(0);
        expect(result.missing[0].remediation?.action).toBe("create_credential");

        const credMissing = result.missing.find((m: any) => m.missingType === "credential");
        expect(credMissing).toBeDefined();
        expect(credMissing!.remediation).toBeDefined();
        expect(credMissing!.remediation!.action).toBe("create_credential");
        expect(credMissing!.remediation!.type).toBe("slack");
    });
});
