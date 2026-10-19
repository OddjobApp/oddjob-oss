/**
 * Templates Service Tests
 *
 * Tests template instantiation (parameter substitution + pipeline creation),
 * getTemplate, and schema mapping CRUD — the methods that were missing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB ──────────────────────────────────────────────────────────────────
const mockReturning = vi.fn();
const mockWhere     = vi.fn();
const mockLimit     = vi.fn();
const mockOrderBy   = vi.fn();
const mockFrom      = vi.fn();
const mockSelect    = vi.fn();
const mockInsert    = vi.fn();
const mockDelete    = vi.fn();
const mockValues    = vi.fn();
const mockUpdate    = vi.fn();

vi.mock("@server/database_service.js", () => ({
    db: {
        select:  vi.fn(),
        insert:  vi.fn(),
        delete:  vi.fn(),
        update:  vi.fn(),
    },
}));

beforeEach(() => {
    vi.clearAllMocks();
});

vi.mock("drizzle-orm", () => ({
    eq:   vi.fn((_col, val) => `eq_${val}`),
    desc: vi.fn((col) => `desc_${String(col)}`),
    and:  vi.fn((...args) => args.join("_and_")),
}));

vi.mock("@shared/schema/index.js", () => ({
    pipelineTemplates:     "pipelineTemplates",
    schemaMappingTemplates:"schemaMappingTemplates",
    pipelines:             "pipelines",
    pipelineSteps:         "pipelineSteps",
    jobs:                  "jobs",
}));

vi.mock("@server/utils/errors.js", () => ({
    NotFoundError:   class NotFoundError   extends Error { constructor(m: string) { super(m); } },
    ForbiddenError:  class ForbiddenError  extends Error { constructor(m: string) { super(m); } },
    BadRequestError: class BadRequestError extends Error { constructor(m: string) { super(m); } },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSelectChain(result: any[]) {
    const chain: any = {
        from:    vi.fn().mockReturnThis(),
        where:   vi.fn().mockReturnThis(),
        limit:   vi.fn().mockImplementation(function() { return Promise.resolve(result); }),
        then:    (onfulfilled: any) => Promise.resolve(result).then(onfulfilled),
        catch:   (onrejected: any) => Promise.resolve(result).catch(onrejected),
    };
    chain.orderBy = vi.fn().mockReturnValue(chain);
    return chain;
}

function makeInsertChain(result: any) {
    return {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([result]),
        }),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("templatesService.getTemplate", () => {
    it("returns the template when found", async () => {
        const fakeTemplate = { id: 1, name: "My Template", config: { steps: [] } };
        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValue(makeSelectChain([fakeTemplate]));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        const result = await templatesService.getTemplate(1);
        expect(result).toEqual(fakeTemplate);
    });

    it("returns null when not found", async () => {
        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValue(makeSelectChain([]));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        const result = await templatesService.getTemplate(99);
        expect(result).toBeNull();
    });
});

describe("templatesService.instantiateTemplate — parameter substitution", () => {
    beforeEach(() => vi.resetModules());

    it("substitutes {{placeholders}} in config before creating the pipeline", async () => {
        const config = {
            steps: [],
            jobs: [],
            description: "Pipeline for {{client_name}} report",
            triggerType: "manual",
        };
        const fakeTemplate = { id: 2, name: "Report Template", config };

        const { db } = await import("@server/database_service.js") as any;
        // getTemplate lookup
        db.select.mockReturnValueOnce(makeSelectChain([fakeTemplate]));

        const createdPipeline = { id: 55, name: "Acme Report" };
        db.insert.mockReturnValue(makeInsertChain(createdPipeline));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        const result = await templatesService.instantiateTemplate(
            2,
            { name: "Acme Report", parameters: { client_name: "Acme Corp" } },
            { organizationId: 1, userId: "user-1" },
        );

        expect(result.id).toBe(55);
        // Verify the insert received a description with the substituted value
        const insertCall = db.insert.mock.results[0].value.values.mock.calls[0][0];
        expect(insertCall.description).toContain("Acme Corp");
    });

    it("uses template name as default when no name supplied", async () => {
        const config = { steps: [], jobs: [], triggerType: "manual" };
        const fakeTemplate = { id: 3, name: "Base Template", config };

        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValueOnce(makeSelectChain([fakeTemplate]));
        db.insert.mockReturnValue(makeInsertChain({ id: 10, name: "Base Template (Copy)" }));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        const result = await templatesService.instantiateTemplate(
            3,
            {},
            { organizationId: 1, userId: "user-1" },
        );

        const insertCall = db.insert.mock.results[0].value.values.mock.calls[0][0];
        expect(insertCall.name).toContain("Copy");
    });

    it("throws NotFoundError when template does not exist", async () => {
        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValueOnce(makeSelectChain([]));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        await expect(
            templatesService.instantiateTemplate(999, {}, { organizationId: 1, userId: "u" }),
        ).rejects.toThrow("not found");
    });

    it("throws BadRequestError when config has no steps", async () => {
        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValueOnce(makeSelectChain([{ id: 1, name: "Bad", config: null }]));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        await expect(
            templatesService.instantiateTemplate(1, {}, { organizationId: 1, userId: "u" }),
        ).rejects.toThrow();
    });
});

describe("templatesService.listSchemaMappingTemplates", () => {
    beforeEach(() => vi.resetModules());

    it("queries by organizationId", async () => {
        const { db } = await import("@server/database_service.js") as any;
        const chain = makeSelectChain([{ id: 1, name: "Map A" }]);
        db.select.mockReturnValue(chain);

        const { templatesService } = await import("../infrastructure/templates.service.js");
        const results = await templatesService.listSchemaMappingTemplates(42);
        expect(results).toHaveLength(1);
        expect(chain.where).toHaveBeenCalledWith("eq_42");
    });
});

describe("templatesService.createSchemaMappingTemplate", () => {
    beforeEach(() => vi.resetModules());

    it("inserts and returns the new template", async () => {
        const { db } = await import("@server/database_service.js") as any;
        const created = { id: 7, name: "New Map" };
        db.insert.mockReturnValue(makeInsertChain(created));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        const result = await templatesService.createSchemaMappingTemplate({
            name: "New Map",
            mappingConfig: { fields: [] },
            organizationId: 1,
        });

        expect(result.id).toBe(7);
    });
});

describe("templatesService.deleteSchemaMappingTemplate", () => {
    beforeEach(() => vi.resetModules());

    it("throws NotFoundError when template does not belong to org", async () => {
        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValue(makeSelectChain([]));

        const { templatesService } = await import("../infrastructure/templates.service.js");
        await expect(
            templatesService.deleteSchemaMappingTemplate(99, 1),
        ).rejects.toThrow("not found");
    });

    it("deletes when found", async () => {
        const { db } = await import("@server/database_service.js") as any;
        db.select.mockReturnValue(makeSelectChain([{ id: 5 }]));
        db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

        const { templatesService } = await import("../infrastructure/templates.service.js");
        await expect(
            templatesService.deleteSchemaMappingTemplate(5, 1),
        ).resolves.not.toThrow();
    });
});

// ── MCP handler: instantiate_template ─────────────────────────────────────────
describe("handleInstantiateTemplate MCP handler", () => {
    beforeEach(() => vi.resetModules());

    it("returns error when no org context provided", async () => {
        const { handleInstantiateTemplate } = await import("../../../mcp/handlers/templates.js");
        const result = await handleInstantiateTemplate({ templateId: 1 }, undefined);
        // successResponse / errorResponse produce content arrays
        const text = (result as any).content?.[0]?.text ?? "";
        expect(text).toContain("context required");
    });

    it("returns error when templateId missing", async () => {
        const { handleInstantiateTemplate } = await import("../../../mcp/handlers/templates.js");
        const result = await handleInstantiateTemplate({}, { organizationId: 1, userId: "u" } as any);
        const text = (result as any).content?.[0]?.text ?? "";
        expect(text.length).toBeGreaterThan(0);
    });
});
