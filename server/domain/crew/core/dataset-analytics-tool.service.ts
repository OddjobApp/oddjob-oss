import { sumMoneyNumber, decimalUnits, currencyScale } from '@shared/financial-money.js';
import { formatCrewMoney } from '@shared/crew-money.js';
import { datasetService } from "../../knowledge/core/dataset-service.js";
import type { OrgContext } from "../../jobs/job.service.js";

/**
 * Dataset Analytics & Query Tool Service for CREW Agents
 *
 * Enables CREW agents to discover datasets, retrieve records, and compute
 * ad-hoc statistical aggregations (averages, sums, medians, resolution times)
 * across structured dataset rows.
 */

export interface DatasetSummary {
    id: number;
    name: string;
    description?: string | null;
    itemCount?: number;
    schema?: Record<string, any>;
}

export interface MetricAggregationRequest {
    datasetId?: number;
    datasetName?: string;
    numericField: string;
    aggregation: "avg" | "sum" | "median" | "min" | "max" | "count" | "summary";
    filters?: Array<{ field: string; value: string | number | boolean }>;
}

export interface MetricAggregationResult {
    datasetId: number;
    datasetName: string;
    metric: string;
    aggregation: string;
    value: number | null;
    count: number;
    /** True when the aggregate covers only a prefix of the dataset — the value is a sample. */
    truncated: boolean;
    rowsScanned: number;
    totalRows: number;
    summaryText: string;
    currency?: string;
    sampleRows?: any[];
}

export class DatasetAnalyticsToolService {
    /**
     * Lists all available datasets for an organization.
     */
    public async listDatasets(orgContext: OrgContext): Promise<DatasetSummary[]> {
        try {
            const datasets = await datasetService.list(orgContext);
            return datasets.map((d: any) => ({
                id: d.id,
                name: d.name,
                description: d.description,
                itemCount: d.itemCount ?? 0,
                schema: d.schema,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Retrieves records from a dataset with filtering and pagination.
     */
    public async getDatasetItems(
        datasetId: number,
        orgContext: OrgContext,
        options?: {
            limit?: number;
            offset?: number;
            filterField?: string;
            filterValue?: string;
        }
    ): Promise<{ items: any[]; total: number }> {
        try {
            const filter = options?.filterField && options?.filterValue
                ? { field: options.filterField, value: options.filterValue }
                : undefined;

            const res = await datasetService.getItems(datasetId, orgContext, {
                limit: options?.limit || 50,
                offset: options?.offset || 0,
                filter,
            });

            return {
                items: res.items.map((i: any) => i.data || i),
                total: res.total,
            };
        } catch (err: any) {
            return { items: [], total: 0 };
        }
    }

    /**
     * Computes statistical aggregations (e.g. average resolution time, total spend)
     * over dataset rows matching criteria.
     */
    public async calculateMetric(
        request: MetricAggregationRequest,
        orgContext: OrgContext
    ): Promise<MetricAggregationResult> {
        let datasetId = request.datasetId;
        let datasetName = request.datasetName || "Dataset";

        if (!datasetId && request.datasetName) {
            const all = await this.listDatasets(orgContext);
            const queryNorm = request.datasetName.toLowerCase().replace(/[^a-z0-9]/g, "");

            // 1. Direct or substring match
            let match = all.find(d => {
                const nameNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                return nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm);
            });

            // 2. Domain alias dictionary fallback
            if (!match) {
                const aliasMap: Record<string, string[]> = {
                    service_requests: ["workorders", "servicerequests", "sf311", "tickets", "requests", "cases"],
                    rescue_operations: ["dispatch", "rescue", "emergency", "responders"],
                    pricing_models: ["pricing", "cost", "tariffs", "plans"],
                };

                for (const [canonical, aliases] of Object.entries(aliasMap)) {
                    if (aliases.some(a => queryNorm.includes(a) || a.includes(queryNorm))) {
                        match = all.find(d => d.name.toLowerCase().includes(canonical));
                        if (match) break;
                    }
                }
            }

            if (match) {
                datasetId = match.id;
                datasetName = match.name;
            }
        }

        if (!datasetId) {
            throw new Error(`Dataset "${request.datasetName || "unknown"}" not found.`);
        }

        // Page through the dataset rather than reading one 500-row page.
        //
        // An aggregate computed over an unannounced prefix of the data is not a
        // smaller answer, it is a WRONG one — and this tool is described to agents as
        // producing exact metrics, with an instruction not to guess. So: read every
        // row up to a hard ceiling, and if the ceiling is reached, say so in the
        // summary the agent will quote rather than reporting a partial mean as fact.
        const PAGE = 500;
        const MAX_ROWS = 10_000;
        const rows: any[] = [];
        let offset = 0;
        let total = 0;
        for (;;) {
            const page = await datasetService.getItems(datasetId, orgContext, { limit: PAGE, offset });
            total = page.total ?? rows.length;
            const batch = page.items ?? [];
            rows.push(...batch.map((i: any) => i.data || i));
            offset += batch.length;
            if (batch.length < PAGE || rows.length >= Math.min(total || Infinity, MAX_ROWS)) break;
        }
        const truncated = total > rows.length;

        // Apply filters
        let filtered = rows;
        if (request.filters && request.filters.length > 0) {
            filtered = rows.filter((row: any) => {
                return request.filters!.every(f => {
                    const val = row[f.field];
                    if (val === undefined) return false;
                    return String(val).toLowerCase() === String(f.value).toLowerCase();
                });
            });
        }

        const financial = /^(amount|balance|total|totalamt|currentbalance|unitprice|purchasecost|unappliedamt|amount_paid|cost|price|tax|subtotal|discount)$/i.test(request.numericField)
            && filtered.some(row => row.currency !== undefined || row.CurrencyRef !== undefined);
        let currency: string | undefined;
        if (financial && request.aggregation !== 'count') {
            if (truncated) throw new Error('Financial totals require all matching records; this dataset read is incomplete.');
            const currencies = new Set(filtered.map(row => request.numericField === 'HomeTotalAmt' ? row.homeCurrency : row.currency ?? row.CurrencyRef?.value));
            if (currencies.size !== 1 || ![...currencies][0]) throw new Error('Financial calculations require a single verified currency. Filter by currency; do not combine currencies.');
            currency = [...currencies][0];
            const scale = currencyScale(currency!);
            filtered.forEach(row => decimalUnits(row[request.numericField], scale));
        }

        // Extract numeric values for the requested field
        const values: number[] = [];
        for (const row of filtered) {
            const raw = row[request.numericField];
            if (typeof raw === "number" && !isNaN(raw)) {
                values.push(raw);
            } else if (typeof raw === "string") {
                const parsed = parseFloat(raw.replace(/[^0-9.-]+/g, ""));
                if (!isNaN(parsed)) values.push(parsed);
            }
        }

        let calculatedValue: number | null = null;
        if (values.length > 0) {
            if (request.aggregation === "sum") {
                calculatedValue = currency ? sumMoneyNumber(filtered.map(row => row[request.numericField]), currency) : values.reduce((a, b) => a + b, 0);
            } else if (request.aggregation === "avg" || request.aggregation === "summary") {
                calculatedValue = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
            } else if (request.aggregation === "min") {
                calculatedValue = Math.min(...values);
            } else if (request.aggregation === "max") {
                calculatedValue = Math.max(...values);
            } else if (request.aggregation === "median") {
                const sorted = [...values].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                calculatedValue = sorted.length % 2 !== 0 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
            } else if (request.aggregation === "count") {
                calculatedValue = values.length;
            }
        }

        // Name the dataset actually used. `datasetName` may have come from the fuzzy
        // alias match above, so the caller must be able to see which one answered.
        const scope = truncated
            ? ` NOTE: this is computed over the first ${rows.length} of ${total} rows — it is a SAMPLE, not the true ${request.aggregation}.`
            : "";
        const nonNumeric = filtered.length - values.length;
        const skipped = nonNumeric > 0
            ? ` ${nonNumeric} matched record(s) had no numeric "${request.numericField}" and were excluded.`
            : "";

        const summaryText = calculatedValue !== null
            ? `Calculated ${request.aggregation.toUpperCase()} of ${request.numericField} = ${currency ? `${formatCrewMoney(calculatedValue, currency)} ${currency}` : calculatedValue} across ${values.length} of ${filtered.length} matched records in "${datasetName}".${skipped}${scope}`
            : `No numeric data found for field "${request.numericField}" across ${filtered.length} matched records in "${datasetName}".${scope}`;

        return {
            datasetId,
            datasetName,
            metric: request.numericField,
            ...(currency ? { currency } : {}),
            aggregation: request.aggregation,
            value: calculatedValue,
            count: filtered.length,
            truncated,
            rowsScanned: rows.length,
            totalRows: total,
            summaryText,
            sampleRows: filtered.slice(0, 5),
        };
    }
}

export const datasetAnalyticsTool = new DatasetAnalyticsToolService();
