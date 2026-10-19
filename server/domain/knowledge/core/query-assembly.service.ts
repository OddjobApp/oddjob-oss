import { queryBuilderService, type VisualQuery } from "./query-builder.service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("QueryAssemblyService");

/**
 * A saved query, run and projected into something other parts of the platform
 * can actually consume.
 *
 * The query builder returns a graph shape — `{ nodes, edges }`, each node
 * carrying arbitrary properties. Documents and agents want rows and columns.
 * This is the projection between them, and it is deliberately the only place
 * that conversion happens, so a deck, a chat table and an agent all describe
 * the same query the same way.
 *
 * Columns match the `render_table` contract exactly (`{ key, label, type,
 * align }` + row objects keyed by column key), so a result can be handed to
 * that tool untouched rather than reshaped at each call site.
 */
export interface QueryColumn {
    key: string;
    label: string;
    type: "text" | "number" | "currency" | "percent" | "boolean";
    align: "left" | "center" | "right";
}

export interface QueryResultSet {
    queryId: number | null;
    name: string;
    description?: string | null;
    /** The executable visual-query definition, preserved for report lineage. */
    queryDefinition?: VisualQuery;
    columns: QueryColumn[];
    rows: Array<Record<string, string | number | boolean>>;
    /** Nodes matched before the query's own limit was applied. */
    totalMatched: number;
    truncated: boolean;
    executionTimeMs: number;
}

/** Node properties live under `data` or `properties` depending on the writer. */
function nodeProperties(node: any): Record<string, any> {
    return (node?.data && typeof node.data === "object" ? node.data : node?.properties) || {};
}

/** Cells must be primitives — a nested object would render as "[object Object]". */
function toCell(value: unknown): string | number | boolean {
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function inferType(values: unknown[]): QueryColumn["type"] {
    const present = values.filter((v) => v !== null && v !== undefined && v !== "");
    if (present.length === 0) return "text";
    if (present.every((v) => typeof v === "boolean")) return "boolean";
    if (present.every((v) => typeof v === "number")) return "number";
    return "text";
}

function humanize(key: string): string {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

export class QueryAssemblyService {
    /**
     * Finds a saved query by id or by exact name, within the caller's org.
     *
     * Name lookup exists because an agent or a document template refers to a
     * query the way a person does — "Open Incidents" — not by a numeric id it
     * has no way to know. Resolution goes through getSavedQueries, so the org
     * scoping is the same one the UI gets rather than a second, looser path.
     */
    async resolve(ref: number | string, orgContext: OrgContext) {
        const saved = await queryBuilderService.getSavedQueries(orgContext);

        if (typeof ref === "number") {
            return saved.find((q: any) => q.id === ref) ?? null;
        }
        const needle = ref.trim().toLowerCase();
        return (
            saved.find((q: any) => String(q.name).toLowerCase() === needle) ??
            saved.find((q: any) => String(q.name).toLowerCase().includes(needle)) ??
            null
        );
    }

    async list(orgContext: OrgContext) {
        const saved = await queryBuilderService.getSavedQueries(orgContext);
        return saved.map((q: any) => ({
            id: q.id,
            name: q.name,
            description: q.description ?? null,
            lastRunAt: q.lastRunAt ?? null,
            runCount: q.runCount ?? 0,
        }));
    }

    /**
     * Runs a saved query and projects it to rows and columns.
     *
     * Columns are the union of every property present across the returned
     * nodes, so a result stays honest about sparse data — a node missing a
     * property gets an empty cell rather than the column disappearing for
     * everyone.
     */
    async run(ref: number | string, orgContext: OrgContext): Promise<QueryResultSet> {
        const query = await this.resolve(ref, orgContext);
        if (!query) {
            throw new Error(
                `No saved query "${ref}" in this organization. Call list_saved_queries to see what exists.`,
            );
        }

        const structure = (query as any).queryStructure as VisualQuery;
        const result = await queryBuilderService.executeQuery(structure, orgContext);

        const projected = this.project(result.nodes ?? []);

        // Best-effort: a failed history write must not fail the read.
        try {
            await queryBuilderService.trackQueryExecution(
                (query as any).id,
                (query as any).cypherQuery ?? (query as any).name,
                result.executionTimeMs,
                result.nodes?.length ?? 0,
                "success",
                null,
                orgContext,
            );
        } catch (err: any) {
            logger.warn(`Could not record execution of query ${(query as any).id}: ${err.message}`);
        }

        return {
            queryId: (query as any).id ?? null,
            name: (query as any).name,
            description: (query as any).description ?? null,
            queryDefinition: structure,
            columns: projected.columns,
            rows: projected.rows,
            totalMatched: result.totalNodes ?? result.nodes?.length ?? 0,
            truncated: !!result.truncated,
            executionTimeMs: result.executionTimeMs,
        };
    }

    /** Graph nodes → columns and rows. Exposed for tests and direct callers. */
    project(nodes: any[]): { columns: QueryColumn[]; rows: Array<Record<string, string | number | boolean>> } {
        const propertyKeys: string[] = [];
        for (const node of nodes) {
            for (const key of Object.keys(nodeProperties(node))) {
                if (!propertyKeys.includes(key)) propertyKeys.push(key);
            }
        }

        const rows = nodes.map((node) => {
            const props = nodeProperties(node);
            const row: Record<string, string | number | boolean> = {
                label: toCell(node?.label ?? ""),
                nodeId: toCell(node?.id ?? ""),
            };
            for (const key of propertyKeys) row[key] = toCell(props[key]);
            return row;
        });

        const columns: QueryColumn[] = [
            { key: "label", label: "Label", type: "text", align: "left" },
            { key: "nodeId", label: "Node ID", type: "text", align: "left" },
            ...propertyKeys.map((key) => ({
                key,
                label: humanize(key),
                type: inferType(rows.map((r) => r[key])),
                align: "left" as const,
            })),
        ];

        return { columns, rows };
    }

    /**
     * A markdown table, for the document generators.
     *
     * They take markdown and distill it into blocks, so this is the form a
     * query takes when it becomes part of a deck or a report rather than a
     * chat surface.
     */
    toMarkdown(resultSet: QueryResultSet): string {
        const { columns, rows, name, totalMatched, truncated } = resultSet;

        if (rows.length === 0) {
            return `### ${name}\n\n_No rows matched._\n`;
        }

        const header = `| ${columns.map((c) => c.label).join(" | ")} |`;
        const divider = `| ${columns.map(() => "---").join(" | ")} |`;
        const body = rows
            .map((row) => `| ${columns.map((c) => String(row[c.key] ?? "")).join(" | ")} |`)
            .join("\n");

        // Stating the truncation matters: a reader given 5 of 100 rows with no
        // note will read them as the whole answer.
        const footer = truncated
            ? `\n_Showing ${rows.length} of ${totalMatched} matched nodes._\n`
            : `\n_${rows.length} row${rows.length === 1 ? "" : "s"}._\n`;

        return `### ${name}\n\n${header}\n${divider}\n${body}\n${footer}`;
    }
}

export const queryAssemblyService = new QueryAssemblyService();
