import { describe, it, expect, vi, beforeEach } from "vitest";
import { forgeWowService } from "../../server/domain/apps/core/forge-wow.service.js";
import { forgeShadowService } from "../../server/domain/apps/core/forge-shadow.service.js";
import { forgeEvolutionService } from "../../server/domain/apps/core/forge-evolution.service.js";
import { forgeCodegenService } from "../../server/domain/apps/core/forge-codegen.service.js";
import { redis } from "../../server/domain/core/infrastructure/redis/redis-client.js";

// Mock Redis
// Listing only get/set/keys was not enough to collect this file: pod-registry
// calls `redis.hset` while server/auth loads, so the suite died at import with
// "redis.hset is not a function" and reported 0 tests. The helper answers every
// other command with a resolved promise, which is what the fire-and-forget
// callers need for their `.catch`.
vi.mock("../../server/domain/core/infrastructure/redis/redis-client.js", async () => {
    const { redisClientMockModule } = await import("../helpers/ioredis-mock.js");
    return redisClientMockModule({
        get: vi.fn(),
        set: vi.fn(),
        keys: vi.fn(),
    });
});

describe("Mach 4.0: Deterministic Assembly & Evolution", () => {
    
    describe("Block Registry", () => {
        it("successfully reads the block registry manifest", async () => {
            const registry = await forgeCodegenService.getBlockRegistry();
            expect(registry.blocks).toBeDefined();
            expect(registry.blocks.length).toBeGreaterThan(0);
            
            const hero = registry.blocks.find(b => b.id === "IndustrialDashboardHero");
            expect(hero).toBeDefined();
            expect(hero.premium_features).toContain("Glassmorphism");
        });
    });

    describe("ForgeWowService (Aesthetic Scorer)", () => {
        it("calculates a baseline score for minimal apps", () => {
            const files = { "pages/index.tsx": "export default function App() { return <div>Hello</div> }" };
            const score = forgeWowService.calculateWowScore(files, "A simple app");
            // Low score due to missing motion, icons, etc.
            expect(score).toBeLessThan(50);
        });

        it("awards bonuses for premium industrial markers", () => {
            const files = { 
                "pages/index.tsx": `
                    import { motion } from "framer-motion";
                    import { Activity } from "lucide-react";
                    import { MetricGrid } from "@domain-ui/packaged";
                    
                    export default function App() { 
                        return (
                            <div className="bg-gradient-to-br backdrop-blur-xl">
                                <Activity />
                                <MetricGrid />
                            </div>
                        )
                    }
                `,
                "pages/api/report-error.ts": "export default {}"
            };
            const score = forgeWowService.calculateWowScore(files, "An industrial dashboard");
            // High score due to motion, icons, gradient, glassmorphism, and packaged blocks
            expect(score).toBeGreaterThan(80);
        });
    });

    describe("ForgeShadowService (Challenger Pipeline)", () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        /**
         * The challenger's own codegen is stubbed.
         *
         * runChallengerShadow ran the REAL forge — generateBlueprintFiles into a
         * workspace on disk — which segfaulted the vitest worker, so this file
         * reported a crash rather than a result and the two tests after it never
         * ran. Nothing about the comparison needs a real generation: what is
         * under test is the scoring, the winner, and the write to Redis.
         *
         * The service imports forge-codegen lazily inside the function, but a
         * dynamic import resolves to the same module singleton, so spying on the
         * instance is enough to intercept it.
         */
        it("scores the challenger against the live app and stores the comparison", async () => {
            const liveFiles = { "pages/index.tsx": "content" };
            const options = { description: "Test mission" };

            const generate = vi
                .spyOn(forgeCodegenService, "generateBlueprintFiles")
                .mockResolvedValue({
                    success: true,
                    files: {
                        "pages/index.tsx": "export default function Page() { return <main/>; }",
                        "components/Chart.tsx": "export const Chart = () => null;",
                    },
                });

            await forgeShadowService.runChallengerShadow(
                "test-app",
                options,
                liveFiles,
                "crud-app"
            );

            // crud-app's challenger is spa, per the rotation table.
            expect(generate).toHaveBeenCalledOnce();
            expect(generate.mock.calls[0][1]).toBe("spa");

            expect(redis.set).toHaveBeenCalledWith(
                expect.stringContaining("forge:shadow:result:test-app"),
                expect.stringContaining("improvement"),
                "EX",
                expect.any(Number)
            );

            const stored = JSON.parse((redis.set as any).mock.calls[0][1]);
            expect(stored.live.blueprint).toBe("crud-app");
            expect(stored.shadow.blueprint).toBe("spa");
            expect(stored.shadow.error).toBeNull();
            expect(stored.filesGenerated).toBe(2);
            expect(stored.improvement).toBe(stored.shadow.score - stored.live.score);
            expect(stored.winner).toBe(stored.improvement > 0 ? "shadow" : "live");

            generate.mockRestore();
        });

        it("still records a comparison when the challenger fails to generate", async () => {
            const generate = vi
                .spyOn(forgeCodegenService, "generateBlueprintFiles")
                .mockRejectedValue(new Error("blueprint exploded"));

            await forgeShadowService.runChallengerShadow(
                "test-app",
                { description: "Test mission" },
                { "pages/index.tsx": "content" },
                "crud-app"
            );

            const stored = JSON.parse((redis.set as any).mock.calls[0][1]);
            expect(stored.shadow.error).toBe("blueprint exploded");
            expect(stored.shadow.score).toBe(0);
            // A failed challenger must never be declared the winner.
            expect(stored.winner).toBe("live");

            generate.mockRestore();
        });
    });

    describe("ForgeEvolutionService (Learning Brain)", () => {
        it("correctly calculates efficiency gain from shadow data", async () => {
            const mockResult = JSON.stringify({
                live: { score: 70 },
                shadow: { score: 90, blueprint: "industrial-dashboard" },
                improvement: 20
            });

            vi.mocked(redis.keys).mockResolvedValue(["forge:shadow:result:1"]);
            vi.mocked(redis.get).mockResolvedValue(mockResult);

            const stats = await forgeEvolutionService.analyzeShadowPerformance();
            expect(stats.totalRuns).toBe(1);
            expect(stats.avgImprovement).toBe(20);
            expect(stats.winningBlueprint).toBe("industrial-dashboard");
            expect(stats.efficiencyGain).toBe("20.0%");
        });
    });
});
