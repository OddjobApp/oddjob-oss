import { describe, it, expect, vi } from "vitest";
import { datasetAnalyticsTool } from "../../core/dataset-analytics-tool.service.js";

// Mock datasetService
vi.mock("../../../../domain/knowledge/core/dataset-service.js", () => {
    return {
        datasetService: {
            list: vi.fn().mockResolvedValue([
                { id: 89, name: "service_requests", description: "San Francisco municipal work orders", itemCount: 150 },
                { id: 98, name: "Service Requests", description: "Customer work orders", itemCount: 98 },
            ]),
            getItems: vi.fn().mockResolvedValue({
                items: [
                    { data: { id: "WO-101", city: "San Francisco", status: "resolved", resolutionTimeHours: 4.5 } },
                    { data: { id: "WO-102", city: "San Francisco", status: "resolved", resolutionTimeHours: 6.5 } },
                    { data: { id: "WO-103", city: "San Francisco", status: "open", resolutionTimeHours: 12.0 } },
                    { data: { id: "WO-104", city: "Oakland", status: "resolved", resolutionTimeHours: 2.0 } },
                ],
                total: 4,
            }),
        },
    };
});

describe("DatasetAnalyticsToolService", () => {
    const mockOrgContext: any = { organizationId: 1 };

    it("lists available datasets", async () => {
        const datasets = await datasetAnalyticsTool.listDatasets(mockOrgContext);
        expect(datasets.length).toBe(2);
        expect(datasets[0].name).toBe("service_requests");
    });

    it("fetches dataset items with filtering", async () => {
        const result = await datasetAnalyticsTool.getDatasetItems(89, mockOrgContext, {
            filterField: "city",
            filterValue: "San Francisco",
        });
        expect(result.items.length).toBe(4);
    });

    it("calculates average resolution time for resolved work orders in San Francisco", async () => {
        const metric = await datasetAnalyticsTool.calculateMetric(
            {
                datasetName: "service_requests",
                numericField: "resolutionTimeHours",
                aggregation: "avg",
                filters: [
                    { field: "city", value: "San Francisco" },
                    { field: "status", value: "resolved" },
                ],
            },
            mockOrgContext
        );

        expect(metric.datasetId).toBe(89);
        expect(metric.count).toBe(2);
        expect(metric.value).toBe(5.5); // (4.5 + 6.5) / 2 = 5.5
        expect(metric.summaryText).toContain("AVG of resolutionTimeHours = 5.5");
    });

    it("resolves dataset via fuzzy alias dictionary (e.g. 'work orders' -> 'service_requests')", async () => {
        const metric = await datasetAnalyticsTool.calculateMetric(
            {
                datasetName: "work orders",
                numericField: "resolutionTimeHours",
                aggregation: "avg",
            },
            mockOrgContext
        );

        expect(metric.datasetId).toBe(89);
        expect(metric.datasetName).toBe("service_requests");
    });
});


describe('Financial dataset aggregation', () => {
  it('sums exact decimal values with their verified currency', async () => {
    const { datasetService } = await import('../../../../domain/knowledge/core/dataset-service.js');
    vi.mocked(datasetService.getItems).mockResolvedValueOnce({ items: [{ data: { amount: 0.1, currency: 'USD' } }, { data: { amount: 0.2, currency: 'USD' } }], total: 2 } as any);
    expect(await datasetAnalyticsTool.calculateMetric({ datasetId: 89, numericField: 'amount', aggregation: 'sum' }, { organizationId: 1 } as any)).toMatchObject({ value: 0.3, currency: 'USD', truncated: false });
  });
  it.each([
    [{ amount: 10, currency: 'USD' }, { amount: 20, currency: 'EUR' }],
    [{ amount: 10, currency: 'USD' }, { amount: null, currency: 'USD' }],
    [{ amount: 10, currency: null }],
  ])('refuses mixed currencies or invalid financial data', async (...rows) => {
    const { datasetService } = await import('../../../../domain/knowledge/core/dataset-service.js');
    vi.mocked(datasetService.getItems).mockResolvedValueOnce({ items: rows.map(data => ({ data })), total: rows.length } as any);
    await expect(datasetAnalyticsTool.calculateMetric({ datasetId: 89, numericField: 'amount', aggregation: 'sum' }, { organizationId: 1 } as any)).rejects.toThrow();
  });
});
