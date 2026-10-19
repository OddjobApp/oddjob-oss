import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A saved query as an assembly unit: run once, consumed as a chat table, as
 * markdown for documents, and by agents.
 *
 * The projection is the whole point. The query builder returns graph nodes with
 * arbitrary properties; documents and agents want rows and columns. Doing that
 * conversion in one place is what makes a deck, a chat table and an agent
 * describe the same query identically.
 */

const executeQueryMock = vi.fn();
const getSavedQueriesMock = vi.fn();
const trackQueryExecutionMock = vi.fn();

vi.mock("../core/query-builder.service.js", () => ({
    queryBuilderService: {
        executeQuery: (...a: any[]) => executeQueryMock(...a),
        getSavedQueries: (...a: any[]) => getSavedQueriesMock(...a),
        trackQueryExecution: (...a: any[]) => trackQueryExecutionMock(...a),
    },
}));

const { queryAssemblyService } = await import("../core/query-assembly.service.js");

const orgContext: any = { userId: "u1", organizationId: 7, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };

const savedQuery = {
    id: 11,
    name: "Open Incidents",
    description: "Incidents still open",
    queryStructure: { nodes: [{ id: "n1", label: "Incident" }], relationships: [], returnClause: { items: [] } },
};

describe("query projection", () => {
    beforeEach(() => {
        executeQueryMock.mockReset();
        getSavedQueriesMock.mockReset();
        trackQueryExecutionMock.mockReset();
        getSavedQueriesMock.mockResolvedValue([savedQuery]);
        trackQueryExecutionMock.mockResolvedValue(undefined);
    });

    it("projects graph nodes into render_table's exact shape", () => {
        const { columns, rows } = queryAssemblyService.project([
            { id: "a", label: "Incident", data: { severity: "high", count: 3 } },
            { id: "b", label: "Incident", data: { severity: "low", count: 1 } },
        ]);

        // Column keys and row keys must agree, or render_table emits blank cells.
        expect(columns.map((c) => c.key)).toEqual(["label", "nodeId", "severity", "count"]);
        expect(rows[0]).toEqual({ label: "Incident", nodeId: "a", severity: "high", count: 3 });

        // Types are inferred so numbers align and format as numbers downstream.
        expect(columns.find((c) => c.key === "count")?.type).toBe("number");
        expect(columns.find((c) => c.key === "severity")?.type).toBe("text");
    });

    it("keeps a column when only some nodes carry it, rather than dropping it", () => {
        const { columns, rows } = queryAssemblyService.project([
            { id: "a", label: "Incident", data: { severity: "high" } },
            { id: "b", label: "Incident", data: { owner: "ops" } },
        ]);

        // Sparse data must stay visible: dropping a column because one node
        // lacks it would silently hide real values from the other.
        expect(columns.map((c) => c.key)).toContain("severity");
        expect(columns.map((c) => c.key)).toContain("owner");
        expect(rows[0].owner).toBe("");
        expect(rows[1].severity).toBe("");
    });

    it("flattens nested values instead of rendering [object Object]", () => {
        const { rows } = queryAssemblyService.project([
            { id: "a", label: "X", data: { meta: { nested: true } } },
        ]);
        expect(rows[0].meta).toBe('{"nested":true}');
    });

    it("reads properties from either `data` or `properties`", () => {
        const { rows } = queryAssemblyService.project([
            { id: "a", label: "X", properties: { via: "properties" } },
        ]);
        expect(rows[0].via).toBe("properties");
    });
});

describe("resolving and running a saved query", () => {
    beforeEach(() => {
        executeQueryMock.mockReset();
        getSavedQueriesMock.mockReset();
        trackQueryExecutionMock.mockReset();
        getSavedQueriesMock.mockResolvedValue([savedQuery]);
        trackQueryExecutionMock.mockResolvedValue(undefined);
        executeQueryMock.mockResolvedValue({
            nodes: [{ id: "a", label: "Incident", data: { severity: "high" } }],
            edges: [],
            totalNodes: 42,
            truncated: true,
            executionTimeMs: 12,
        });
    });

    it("resolves by name, because that is how an agent refers to a query", async () => {
        const result = await queryAssemblyService.run("Open Incidents", orgContext);
        expect(result.queryId).toBe(11);
        expect(result.rows).toHaveLength(1);
        // Truncation has to survive: 1 of 42 read as the whole answer is wrong.
        expect(result.truncated).toBe(true);
        expect(result.totalMatched).toBe(42);
        // The executable definition must travel with the result so a report can
        // show its source in the Assembly Stack instead of retaining only rows.
        expect(result.queryDefinition).toEqual(savedQuery.queryStructure);
    });

    it("resolves by partial name and by id", async () => {
        expect((await queryAssemblyService.run("incidents", orgContext)).queryId).toBe(11);
        expect((await queryAssemblyService.run(11, orgContext)).queryId).toBe(11);
    });

    it("refuses an unknown query by name rather than running something else", async () => {
        await expect(queryAssemblyService.run("Nonexistent", orgContext)).rejects.toThrow(/No saved query/);
        expect(executeQueryMock).not.toHaveBeenCalled();
    });

    it("goes through the org-scoped list, so another org's query is unreachable", async () => {
        getSavedQueriesMock.mockResolvedValue([]);
        await expect(queryAssemblyService.run(11, orgContext)).rejects.toThrow(/No saved query/);
        expect(getSavedQueriesMock).toHaveBeenCalledWith(orgContext);
    });

    it("still returns rows when recording the execution fails", async () => {
        trackQueryExecutionMock.mockRejectedValue(new Error("history table unavailable"));
        const result = await queryAssemblyService.run(11, orgContext);
        // Telemetry must not decide whether the caller gets an answer.
        expect(result.rows).toHaveLength(1);
    });
});

describe("markdown projection for documents", () => {
    it("renders a table and states the truncation", () => {
        const md = queryAssemblyService.toMarkdown({
            queryId: 1,
            name: "Open Incidents",
            columns: [
                { key: "label", label: "Label", type: "text", align: "left" },
                { key: "severity", label: "Severity", type: "text", align: "left" },
            ],
            rows: [{ label: "Incident", severity: "high" }],
            totalMatched: 42,
            truncated: true,
            executionTimeMs: 5,
        });

        expect(md).toContain("| Label | Severity |");
        expect(md).toContain("| Incident | high |");
        // A reader given 1 of 42 rows with no note reads them as everything.
        expect(md).toContain("Showing 1 of 42");
    });

    it("says so plainly when nothing matched", () => {
        const md = queryAssemblyService.toMarkdown({
            queryId: 1, name: "Empty", columns: [], rows: [],
            totalMatched: 0, truncated: false, executionTimeMs: 1,
        });
        expect(md).toContain("No rows matched");
    });
});

/**
 * A document built from a query.
 *
 * The presentation executor distills markdown into blocks, so a query's table
 * becomes the document's content — a deck that reports rows instead of a
 * paragraph describing them.
 */
describe("documents built from a saved query", () => {
    beforeEach(() => {
        executeQueryMock.mockReset();
        getSavedQueriesMock.mockReset();
        trackQueryExecutionMock.mockReset();
        getSavedQueriesMock.mockResolvedValue([savedQuery]);
        trackQueryExecutionMock.mockResolvedValue(undefined);
        executeQueryMock.mockResolvedValue({
            nodes: [{ id: "a", label: "Incident", data: { severity: "high" } }],
            edges: [], totalNodes: 1, truncated: false, executionTimeMs: 4,
        });
    });

    it("produces markdown a distiller can turn into blocks", async () => {
        const resultSet = await queryAssemblyService.run("Open Incidents", orgContext);
        const md = queryAssemblyService.toMarkdown(resultSet);

        // A heading and a table are what the block distiller looks for.
        expect(md).toMatch(/^### Open Incidents/);
        expect(md).toContain("| Label | Node ID | Severity |");
        expect(md).toContain("| Incident | a | high |");
    });
});
