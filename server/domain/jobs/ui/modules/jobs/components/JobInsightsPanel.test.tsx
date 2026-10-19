import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobInsightsPanel } from "./JobInsightsPanel";

/**
 * The panel reads three endpoints that were mounted with nothing calling them. What
 * matters here is that it shows what the job has actually done, and says nothing where
 * the platform knows nothing — an invented zero reads as a measurement.
 */

const routes: Record<string, unknown> = {};
const fetchMock = vi.fn(async (url: string) => {
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "not stubbed" } as any;
    return { ok: true, status: 200, json: async () => body } as any;
});

function renderPanel(jobId = 7) {
    return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <JobInsightsPanel jobId={jobId} />
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    for (const key of Object.keys(routes)) delete routes[key];
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("JobInsightsPanel", () => {
    it("shows the health score, spend and requests a job has recorded", async () => {
        routes["/api/jobs/7/health"] = {
            overall: 82, successRate: 95, avgResponseTimeScore: 70, errorRateTrend: 88, recencyScore: 74,
            performance: { p95ExecutionTimeMs: 2400 },
            errorCategories: { rate_limit: 3 },
        };
        routes["/api/jobs/7/tokens"] = {
            totalRequests: 12, totalTokens: 48_000, totalCost: 1.23, avgLatency: 900,
            byModel: { "gemini-2.5-flash": { tokens: 48_000, cost: 1.23, requests: 12 } },
        };
        routes["/api/jobs/7/history/stats"] = { totalRequests: 20, successRate: 95, responseTime: { avg: 640 } };

        renderPanel();
        const panel = await screen.findByTestId("job-insights");

        expect(await within(panel).findByText("82")).toBeInTheDocument();
        expect(within(panel).getByText("$1.23")).toBeInTheDocument();
        expect(within(panel).getByText("20")).toBeInTheDocument();
        // Request-history latency wins over the token average: it measures the job, not its AI calls.
        expect(within(panel).getByText("640ms")).toBeInTheDocument();
        expect(within(panel).getByText("gemini-2.5-flash")).toBeInTheDocument();
        expect(within(panel).getByText(/rate limit · 3/)).toBeInTheDocument();
        expect(within(panel).getByText("2.4s")).toBeInTheDocument();
    });

    it("says a job has recorded nothing rather than showing zeros as measurements", async () => {
        routes["/api/jobs/7/health"] = { overall: 0, successRate: 0 };
        routes["/api/jobs/7/tokens"] = { totalRequests: 0, totalCost: 0 };
        routes["/api/jobs/7/history/stats"] = { totalRequests: 0 };

        renderPanel();
        expect(await screen.findByTestId("job-insights-empty")).toHaveTextContent("has not recorded a request yet");
        expect(screen.getByText("No AI calls recorded for this job.")).toBeInTheDocument();
    });

    it("reports what could not be loaded instead of showing a healthy-looking blank", async () => {
        routes["/api/jobs/7/tokens"] = { totalRequests: 0, totalCost: 0 };
        routes["/api/jobs/7/history/stats"] = { totalRequests: 0 };
        // health is left unstubbed: it 404s.

        renderPanel();
        expect(await screen.findByTestId("job-insights-error")).toHaveTextContent("Some of this could not be loaded");
    });

    it("asks for nothing when there is no job to ask about", () => {
        renderPanel(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
