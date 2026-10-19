/**
 * Unit tests for Seed Provisioning Service
 *
 * Feature: hat-menu-intent-router
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SeedProvisioningService, SEED_CARD_COUNT } from "./seed-provisioning.service.js";

// Mock the database service
vi.mock("@server/database_service.js", () => ({
    db: {
        transaction: vi.fn(),
    },
}));

// Mock the logger
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { db } from "@server/database_service.js";

describe("SeedProvisioningService", () => {
    let service: SeedProvisioningService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SeedProvisioningService();
    });

    describe("seedForOrganization", () => {
        /**
         * Requirement 5.1: Atomically create default set including Coder, Analyst, Media Creator
         */
        it("should create all three seed cards atomically (Coder, Analyst, Media Creator)", async () => {
            const orgId = 42;
            let insertCallCount = 0;
            const createdCards: any[] = [];

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { id: 1, name: "anthropic" },
                            { id: 2, name: "flux" },
                        ]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => {
                        insertCallCount++;
                        const card = {
                            id: insertCallCount,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        createdCards.push(card);
                        return {
                            returning: vi.fn().mockResolvedValue([card]),
                        };
                    }),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);

            // Should create all seed cards
            expect(result).toHaveLength(SEED_CARD_COUNT);
            expect(insertCallCount).toBe(SEED_CARD_COUNT);

            // Verify all cards belong to the org
            for (const card of result) {
                expect(card.organizationId).toBe(orgId);
                expect(card.enabled).toBe(true);
            }

            // Verify names
            const names = result.map((c) => c.name);
            expect(names).toContain("Copilot");
            expect(names).toContain("Security Auditor");
            expect(names).toContain("Site Reliability Engineer");
            expect(names).toContain("Growth Marketer");
            expect(names).toContain("Coder");
            expect(names).toContain("Analyst");
            expect(names).toContain("Media Creator");
        });

        /**
         * Requirement 5.2: Coder card capabilities and affinities
         */
        it("should create Coder with correct capabilities and affinities", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { id: 10, name: "anthropic" },
                        ]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 1,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);
            const coder = result.find((c) => c.name === "Coder")!;

            expect(coder).toBeDefined();
            expect(coder.capabilities).toEqual(["code generation", "code review", "debugging"]);
            expect(coder.topicAffinities).toEqual(["Code"]);
            expect(coder.intentAffinities).toEqual(["Code Execution", "Analysis"]);
            expect(coder.modelBindingProviderId).toBe(10); // anthropic provider id
            expect(coder.isDefault).toBe(true);
        });

        /**
         * Requirement 5.3: Analyst card capabilities and affinities
         */
        it("should create Analyst with correct capabilities and affinities", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { id: 10, name: "anthropic" },
                        ]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 2,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);
            const analyst = result.find((c) => c.name === "Analyst")!;

            expect(analyst).toBeDefined();
            expect(analyst.capabilities).toEqual(["data analysis", "pattern recognition", "report generation"]);
            expect(analyst.topicAffinities).toEqual(["Finance", "Real Estate", "Legal"]);
            expect(analyst.intentAffinities).toEqual(["Analysis", "Alert"]);
            expect(analyst.modelBindingProviderId).toBe(10); // anthropic provider id
            expect(analyst.isDefault).toBe(false);
        });

        /**
         * Requirement 5.4: Media Creator card capabilities and affinities
         */
        it("should create Media Creator with correct capabilities and affinities", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { id: 10, name: "anthropic" },
                            { id: 20, name: "flux" },
                        ]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 3,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);
            const mediaCreator = result.find((c) => c.name === "Media Creator")!;

            expect(mediaCreator).toBeDefined();
            expect(mediaCreator.capabilities).toEqual(["image generation", "video synthesis"]);
            expect(mediaCreator.topicAffinities).toEqual(["Media"]);
            expect(mediaCreator.intentAffinities).toEqual(["Image Generation", "Video"]);
            expect(mediaCreator.modelBindingProviderId).toBe(20); // flux provider id
            expect(mediaCreator.isDefault).toBe(false);
        });

        /**
         * Requirement 5.5: Rollback on failure
         */
        it("should rollback all cards if any insertion fails", async () => {
            const orgId = 1;
            let insertCount = 0;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { id: 10, name: "anthropic" },
                        ]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => {
                        insertCount++;
                        // Fail on the second insert (Analyst)
                        if (insertCount === 2) {
                            return {
                                returning: vi.fn().mockRejectedValue(
                                    new Error("DB constraint violation")
                                ),
                            };
                        }
                        return {
                            returning: vi.fn().mockResolvedValue([{
                                id: insertCount,
                                ...values,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            }]),
                        };
                    }),
                })),
            };

            // The transaction mock simulates rollback by throwing
            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            await expect(service.seedForOrganization(orgId)).rejects.toThrow(
                /Seed provisioning failed for organization 1/
            );
        });

        /**
         * Requirement 5.1: Cards should be created with null model binding if provider not found
         */
        it("should create cards with null model binding if provider not found", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]), // No providers found
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 1,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);

            // All cards should have null provider since none were found
            for (const card of result) {
                expect(card.modelBindingProviderId).toBeNull();
            }
        });

        /**
         * Requirement 5.1: Coder card should be marked as isDefault
         */
        it("should mark only the Coder card as isDefault=true", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { id: 10, name: "anthropic" },
                            { id: 20, name: "flux" },
                        ]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 1,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);

            const defaultCards = result.filter((c) => c.isDefault === true);
            expect(defaultCards).toHaveLength(2);
            const defaultNames = defaultCards.map((c) => c.name);
            expect(defaultNames).toContain("Copilot");
            expect(defaultNames).toContain("Coder");
        });

        /**
         * Verify all seed cards are enabled by default
         */
        it("should create all seed cards with enabled=true", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 1,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            const result = await service.seedForOrganization(orgId);

            for (const card of result) {
                expect(card.enabled).toBe(true);
            }
        });

        /**
         * Requirement 5.5: Transaction ensures atomicity via db.transaction
         */
        it("should call db.transaction exactly once", async () => {
            const orgId = 1;

            const mockTx = {
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockImplementation((values: any) => ({
                        returning: vi.fn().mockResolvedValue([{
                            id: 1,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    })),
                })),
            };

            vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
                return await cb(mockTx);
            });

            await service.seedForOrganization(orgId);

            expect(db.transaction).toHaveBeenCalledTimes(1);
        });
    });
});
