import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FormRenderer, { FormSchema } from "@domain-ui/core/ui/components/shared/FormRenderer";

describe("FormRenderer — Live Query & Weather App capabilities", () => {
  let queryClient: QueryClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    queryClient.clear();
  });

  it("renders a live query field and displays external API data", async () => {
    // Mock the /api/integrations/http-connector/query endpoint response
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/integrations/http-connector/query")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            status: 200,
            data: 72.4,
            cached: false,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const schema: FormSchema = {
      fields: [
        {
          key: "city",
          type: "text",
          label: "City",
          defaultValue: "San Francisco",
        },
        {
          key: "currentTemp",
          type: "query",
          label: "Current Temperature",
          url: "https://api.open-meteo.com/v1/forecast",
          params: { city: "{{city}}" },
          jsonPath: "temperature",
          unit: "°F",
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <FormRenderer schema={schema} onSubmit={() => {}} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Current Temperature")).toBeDefined();
    expect(screen.getByText("LIVE API")).toBeDefined();

    // Verify fetched live temperature and unit render
    await waitFor(() => {
      expect(screen.getByText(/72\.4\s*°F/)).toBeDefined();
    });
  });

  it("renders a multi-metric key-value report when query returns an object", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/integrations/http-connector/query")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            status: 200,
            data: {
              condition: "Partly Cloudy",
              windspeed: "14 mph",
              humidity: "65%",
            },
            cached: true,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const schema: FormSchema = {
      fields: [
        {
          key: "weatherReport",
          type: "query",
          label: "Weather Snapshot",
          url: "https://api.weather.com/v1/snapshot",
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <FormRenderer schema={schema} onSubmit={() => {}} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Partly Cloudy")).toBeDefined();
      expect(screen.getByText("14 mph")).toBeDefined();
      expect(screen.getByText("65%")).toBeDefined();
      expect(screen.getByText("(cached)")).toBeDefined();
    });
  });
});
