import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { STUDIO_FIELD_TYPES, studioFieldSchema, type StudioDefinition } from "@shared/form-studio";
import type { FlowStepProposal } from "@shared/flow-studio-crew";
import StudioRenderer from "@/modules/forms/StudioRenderer";

describe("Form Studio & Flow Studio — HTTP Connector & Query Extensions", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("includes 'query' in STUDIO_FIELD_TYPES and parses query field schema correctly", () => {
    expect((STUDIO_FIELD_TYPES as readonly string[]).includes("query")).toBe(true);

    const parsed = studioFieldSchema.safeParse({
      key: "live_temperature",
      label: "Live Temperature",
      type: "query",
      url: "https://api.open-meteo.com/v1/forecast",
      jsonPath: "current.temperature_2m",
      params: { latitude: 37.77, longitude: -122.41 },
      cacheTtlSeconds: 300,
      unit: "°C",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("query");
      expect((parsed.data as any).url).toBe("https://api.open-meteo.com/v1/forecast");
      expect((parsed.data as any).jsonPath).toBe("current.temperature_2m");
      expect((parsed.data as any).cacheTtlSeconds).toBe(300);
    }
  });

  it("verifies FlowStepProposal supports httpConnectorConfig", () => {
    const step: FlowStepProposal = {
      jobId: 101,
      jobName: "Fetch Live Weather",
      jobType: "http_connector",
      outputName: "weather_response",
      status: "ready",
      httpConnectorConfig: {
        url: "https://api.open-meteo.com/v1/forecast",
        method: "GET",
        params: { latitude: "{{lat}}", longitude: "{{lng}}" },
        jsonPath: "current",
        cacheTtlSeconds: 120,
      },
    };

    expect(step.jobType).toBe("http_connector");
    expect(step.httpConnectorConfig?.url).toBe("https://api.open-meteo.com/v1/forecast");
    expect(step.httpConnectorConfig?.jsonPath).toBe("current");
    expect(step.outputName).toBe("weather_response");
  });

  it("renders a live query field in StudioRenderer with LIVE API badge and data", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/integrations/http-connector/query")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            status: 200,
            data: { temp: 18.2, status: "Sunny" },
            cached: false,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const definition: StudioDefinition = {
      fields: [
        {
          key: "forecast",
          label: "Current Forecast",
          type: "query",
          url: "https://api.open-meteo.com/v1/forecast",
          jsonPath: "current",
        } as any,
      ],
      studio: {
        version: 1,
        pages: [{ id: "page_1", title: "Page 1", html: "" }],
        sources: [],
        navigation: { allowBack: true, showProgress: true, reviewBeforeSubmit: false },
        stages: [],
        groups: [],
        scales: [],
        rules: [],
        decisionRules: [],
        actions: [],
        results: [],
        cohorts: [],
        issues: [],
        tests: [],
      },
    };

    render(
      <StudioRenderer
        definition={definition}
        initialInputs={{}}
      />
    );

    expect(screen.getByText("Current Forecast")).toBeDefined();
    expect(screen.getByText("LIVE API")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Sunny")).toBeDefined();
      expect(screen.getByText("18.2")).toBeDefined();
    });
  });
});
