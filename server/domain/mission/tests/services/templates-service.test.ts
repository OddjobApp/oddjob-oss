/**
 * Templates Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockInsert, mockDelete } = vi.hoisted(() => {
    const c = (r: unknown[] = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(r),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(r).then(fn),
    });
    return {
        mockSelect: vi.fn(() => c()),
        mockInsert: vi.fn(() => c()),
        mockDelete: vi.fn(() => c()),
    };
});

const createChain = (result: unknown[] = []) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
    then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: mockSelect,
        insert: mockInsert,
        delete: mockDelete,
    },
}));

vi.mock("../../../server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { templatesService } from "@domain/core/infrastructure/templates.service.js";

describe("Templates Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelect.mockReturnValue(createChain([]));
        mockInsert.mockReturnValue(createChain([]));
        mockDelete.mockReturnValue(createChain([]));
    });

    describe("listTemplates", () => {
        it("returns templates ordered by featured and createdAt", async () => {
            const templates = [{ id: 1, name: "T1" }, { id: 2, name: "T2" }];
            mockSelect.mockReturnValue(createChain(templates));
            const result = await templatesService.listTemplates();
            expect(result).toEqual(templates);
            expect(mockSelect).toHaveBeenCalled();
        });
    });

    describe("deleteTemplate", () => {
        it("throws ForbiddenError when not admin", async () => {
            await expect(
                templatesService.deleteTemplate(1, { isAdmin: false })
            ).rejects.toThrow("Only admins can delete templates");
            expect(mockSelect).not.toHaveBeenCalled();
        });

        it("throws NotFoundError when template not found", async () => {
            mockSelect.mockReturnValue(createChain([]));
            await expect(
                templatesService.deleteTemplate(999, { isAdmin: true })
            ).rejects.toThrow("Template not found");
        });

        it("deletes template when admin and found", async () => {
            const template = { id: 1, name: "T1" };
            mockSelect.mockReturnValue(createChain([template]));
            mockDelete.mockReturnValue(createChain());
            await templatesService.deleteTemplate(1, { isAdmin: true });
            expect(mockDelete).toHaveBeenCalled();
        });
    });

    describe("instantiateTemplate", () => {
        it("throws NotFoundError when template not found", async () => {
            mockSelect.mockReturnValue(createChain([]));
            await expect(
                templatesService.instantiateTemplate(999, {}, { organizationId: 1, userId: "u1" })
            ).rejects.toThrow("Template not found");
        });

        it("throws BadRequestError when config missing steps", async () => {
            const template = { id: 1, name: "T1", config: {}, description: null };
            mockSelect.mockReturnValue(createChain([template]));
            await expect(
                templatesService.instantiateTemplate(1, {}, { organizationId: 1, userId: "u1" })
            ).rejects.toThrow("Template configuration is missing steps");
        });

        it("creates pipeline from template with parameter substitution", async () => {
            const template = {
                id: 1,
                name: "T1",
                description: "Desc",
                config: {
                    steps: [{ jobId: "job-1", order: 0 }],
                    jobs: [{ id: "job-1", name: "J1", type: "api", config: {} }],
                    triggerType: "manual",
                },
            };
            const newPipeline = { id: 10, name: "My Copy" };
            const newJob = { id: 20 };
            mockSelect.mockReturnValueOnce(createChain([template]));
            mockInsert
                .mockReturnValueOnce(createChain([newPipeline]))
                .mockReturnValueOnce(createChain([newJob]))
                .mockReturnValueOnce(createChain([]));
            const result = await templatesService.instantiateTemplate(
                1,
                { name: "My Copy", parameters: { x: "val" } },
                { organizationId: 1, userId: "u1" }
            );
            expect(result).toMatchObject({ id: 10, name: "My Copy" });
        });
    });

    describe("startWizardSession", () => {
        it("throws NotFoundError when template not found", async () => {
            mockSelect.mockReturnValue(createChain([]));
            await expect(
                templatesService.startWizardSession(999, { organizationId: 1, userId: "u1" })
            ).rejects.toThrow("Template not found");
        });

        it("returns session with draft pipeline and template config", async () => {
            const template = {
                id: 1,
                name: "T1",
                description: "D",
                config: { triggerType: "manual", steps: [] },
                parameterSchema: {},
            };
            const draftPipeline = { id: 5, name: "T1 (Draft)" };
            mockSelect.mockReturnValue(createChain([template]));
            mockInsert.mockReturnValue(createChain([draftPipeline]));
            const result = await templatesService.startWizardSession(1, { organizationId: 1, userId: "u1" });
            expect(result.sessionId).toBe(5);
            expect(result.pipelineId).toBe(5);
            expect(result.templateConfig).toEqual(template.config);
            expect(result.parameterSchema).toEqual({});
        });
    });
});
