import { describe, it, expect, vi, beforeEach } from "vitest";
import { skillService } from "../../core/skill-service.js";
import { RedTeamService } from "../../core/red-team.service.js";

// Mocks
const mockDb = vi.hoisted(() => ({
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 42, name: "Agent math_tool Red-Team Dataset" }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
}));

vi.mock("@server/database_service.js", () => ({ db: mockDb }));

const mockGenerateText = vi.fn();
vi.mock("@server/domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        generateText: (...args: any[]) => mockGenerateText(...args)
    }
}));

describe("Phase 3 Self-Improving Flywheel - Unit Tests", () => {
    describe("Safe Sandbox Capabilities", () => {
        it("should validate args inside JS VM using validator.validate helper", async () => {
            const code = `
                validator.validate(args, { x: "number", y: "string" });
                result = args.x + args.y.length;
            `;
            const res = await skillService._executeJS("test_validator", code, { x: 5, y: "hello" });
            expect(res.success).toBe(true);
            expect(res.result).toBe(10);
        });

        it("should throw execution error if validator validation fails", async () => {
            const code = `
                validator.validate(args, { x: "number", y: "string" });
                result = true;
            `;
            const res = await skillService._executeJS("test_validator_fail", code, { x: "not-a-number", y: "hello" });
            expect(res.success).toBe(false);
            expect(res.error).toContain("Field 'x' has invalid type");
        });

        it("should allow optional fields in validator.validate", async () => {
            const code = `
                validator.validate(args, { x: "number", y: "string?" });
                result = args.x;
            `;
            const res = await skillService._executeJS("test_validator_opt", code, { x: 42 });
            expect(res.success).toBe(true);
            expect(res.result).toBe(42);
        });

        it("should capture custom telemetry metrics inside sandbox execution logs", async () => {
            const code = `
                telemetry.record("latency_ms", 120);
                result = true;
            `;
            const res = await skillService._executeJS("test_telemetry", code, {});
            expect(res.success).toBe(true);
            expect(res.logs).toContain("[telemetry] latency_ms: 120");
        });
    });

    describe("RedTeamService", () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it("should execute red-teaming loop, detect failures and insert DPO records", async () => {
            const mockSkill = {
                id: 101,
                name: "math_tool",
                description: "Performs math multiplication",
                code: "result = args.x * args.y;",
                language: "javascript",
                organizationId: 1
            };
            vi.spyOn(skillService, "getSkillByName").mockResolvedValue(mockSkill as any);

            mockDb.select.mockImplementation(() => ({
                from: () => ({
                    where: () => ({
                        limit: () => [] // triggers creation of dataset
                    })
                })
            }));

            // Mock Teacher LLM call behavior
            mockGenerateText
                // 1. Generation prompt for 5 test cases
                .mockResolvedValueOnce(JSON.stringify([
                    { args: { x: 2, y: 3 } },
                    { args: { x: 0, y: 5 } },
                    { args: { x: -1, y: -1 } },
                    { args: { x: 10, y: 10 } },
                    { args: { x: 1.5, y: 2 } }
                ]))
                // 2. Evaluated outputs for test cases 1 to 5
                .mockResolvedValueOnce("<output>{\"result\": 6}</output>") // Case 1: Match (2 * 3 = 6)
                .mockResolvedValueOnce("<output>{\"result\": 999}</output>") // Case 2: Mismatch (0 * 5 = 0 vs 999)
                .mockResolvedValueOnce("<output>{\"result\": 1}</output>") // Case 3: Match (-1 * -1 = 1)
                .mockResolvedValueOnce("<output>{\"result\": 100}</output>") // Case 4: Match (10 * 10 = 100)
                .mockResolvedValueOnce("<output>{\"result\": -5}</output>"); // Case 5: Mismatch (Crash vs -5)

            // Mock local execution behavior
            vi.spyOn(skillService, "executeSkill").mockImplementation(async (id, args: any) => {
                if (args.x === 0) {
                    return { success: true, result: { result: 0 } };
                }
                if (args.x === 1.5) {
                    return { success: false, error: "Mock execution crashed" };
                }
                return { success: true, result: { result: args.x * args.y } };
            });

            const redTeamService = new RedTeamService();
            const res = await redTeamService.redTeam("math_tool");

            expect(res.success).toBe(true);
            expect(res.testsRun).toBe(5);
            expect(res.failuresFound).toBe(2);
            expect(res.dpoRecordsLogged).toBe(2);

            // Verify inserts occurred for dataset and preference entries
            expect(mockDb.insert).toHaveBeenCalled();
        });
    });
});
