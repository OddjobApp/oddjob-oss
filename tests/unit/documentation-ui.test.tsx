/**
 * DocumentationManager UI unit tests.
 *
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock wouter
const h = vi.hoisted(() => ({
  search: "",
  navigate: vi.fn(),
  status: null as any,
  features: [] as any[],
  featureSpec: null as any,
  uiSpec: null as any,
  apiSpec: null as any,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/platform-maintenance/documentation", h.navigate],
  useSearch: () => h.search,
  useParams: () => ({}),
  Link: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

// Mock toast and custom UI hooks
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock lucide icons.
//
// Proxy over the REAL module rather than a hand-listed set: the previous
// enumeration silently rotted every time a component imported an icon that
// wasn't on the list (transitively, via XrayCompositionExplorer), and the
// resulting import error meant this file ran ZERO tests while still reporting
// as a single "failure" rather than as lost coverage.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createIcon = (name: string) => {
    const Icon = ({ className }: { className?: string }) => <span data-testid={`icon-${name}`} className={className} />;
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy({} as Record<string, unknown>, {
    get: (cache, prop: string) => {
      if (prop === "__esModule") return true;
      // Non-component exports (createLucideIcon, icon maps) pass through as-is.
      if (typeof prop === "string" && /^[A-Z]/.test(prop)) {
        if (!(prop in cache)) cache[prop] = createIcon(prop);
        return cache[prop];
      }
      return actual[prop];
    },
    has: () => true,
  });
});

// Mock fetch globally
global.fetch = vi.fn().mockImplementation(async (url: string) => {
  if (url.includes("/api/documentation/status")) {
    return {
      ok: true,
      json: async () => h.status,
    } as Response;
  }
  if (url.includes("/api/documentation/features/auth/spec")) {
    return {
      ok: true,
      json: async () => h.featureSpec,
    } as Response;
  }
  if (url.includes("/api/documentation/features")) {
    return {
      ok: true,
      json: async () => ({ features: h.features }),
    } as Response;
  }
  if (url.includes("/api/documentation/specs/ui")) {
    return {
      ok: true,
      json: async () => h.uiSpec,
    } as Response;
  }
  if (url.includes("/api/documentation/specs/api")) {
    return {
      ok: true,
      json: async () => h.apiSpec,
    } as Response;
  }
  if (url.includes("/api/documentation/generate")) {
    return {
      ok: true,
      json: async () => ({ success: true }),
    } as Response;
  }
  return { ok: false, status: 404 } as Response;
});

import DocumentationManager from "../../server/domain/admin/ui/modules/admin/pages/DocumentationManager.tsx";

describe("DocumentationManager UI", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    h.search = "";
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    h.status = {
      overall_status: {
        total_documents: 2,
        up_to_date: 1,
        outdated: 0,
        missing: 1,
        average_age_days: 2,
        oldest_document_days: 5,
        freshness_score: 50,
      },
      features: [
        { feature_id: "auth", name: "Auth", documentation_status: "up-to-date", last_updated: new Date().toISOString(), total_documents: 1, up_to_date: true },
        { feature_id: "jobs", name: "Jobs", documentation_status: "missing", last_updated: new Date().toISOString(), total_documents: 1, up_to_date: false },
      ],
      maintenance_status: {
        scheduler_running: false,
        last_maintenance_run: null,
      },
    };

    h.features = [
      { id: "auth", name: "Auth", description: "Auth module", version: "1.0.0", components: [], apis: ["POST /login"], dependencies: [], relatedResourceTypes: [], mcpTools: [], maintainers: ["Architect"], last_updated: new Date().toISOString(), documentation_status: "up-to-date" },
      { id: "jobs", name: "Jobs", description: "Jobs module", version: "1.0.0", components: [], apis: [], dependencies: [], relatedResourceTypes: [], mcpTools: [], maintainers: ["Architect"], last_updated: new Date().toISOString(), documentation_status: "missing" },
    ];

    h.featureSpec = {
      featureId: "auth",
      title: "Auth — Architecture Reference",
      summary: "Auth summary",
      markdown: "# Auth Spec Markdown Content\nSome description",
      status: "up-to-date",
      generatedAt: new Date().toISOString(),
      persisted: true,
    };

    h.uiSpec = {
      title: "Platform UI Reference",
      summary: "UI Reference",
      markdown: "# UI Spec Content",
      status: "up-to-date",
      generatedAt: new Date().toISOString(),
      persisted: true,
    };

    h.apiSpec = {
      title: "Platform API Reference",
      summary: "API Reference",
      markdown: "# API Spec Content",
      status: "up-to-date",
      generatedAt: new Date().toISOString(),
      persisted: true,
      endpoints: [],
    };
  });

  it("renders page title and header controls", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <DocumentationManager />
      </QueryClientProvider>
    );

    expect(screen.getByText("Platform Documentation")).toBeInTheDocument();
    expect(screen.getByText("Refresh Status")).toBeInTheDocument();
    expect(screen.getByText("Regenerate All")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("50%")).toBeInTheDocument(); // Freshness score
      expect(screen.getByText("2")).toBeInTheDocument(); // Total docs
    });
  });

  it("renders features in the Current Modules tab", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <DocumentationManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Auth")).toBeInTheDocument();
      expect(screen.getByText("Jobs")).toBeInTheDocument();
    });
  });

  it("clicking a feature card navigates to feature URL query param", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <DocumentationManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const card = screen.getByText("Auth").closest(".card") || screen.getByText("Auth");
      fireEvent.click(card);
      expect(h.navigate).toHaveBeenCalledWith(expect.stringContaining("feature=auth"));
    });
  });

  it("renders the Spec Detail View when feature param is active", async () => {
    h.search = "?feature=auth";

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentationManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Auth Spec Markdown Content")).toBeInTheDocument();
      expect(screen.getAllByText("Stored reference")[0]).toBeInTheDocument();
    });
  });

  it("clicking the back button in details view resets search params", async () => {
    h.search = "?feature=auth";

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentationManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const backBtn = screen.getByRole("button", { name: /back/i });
      fireEvent.click(backBtn);
      expect(h.navigate).toHaveBeenCalledWith(expect.stringContaining("tab=modules"));
      expect(h.navigate).not.toHaveBeenCalledWith(expect.stringContaining("feature="));
    });
  });

  it("invalidates documentation status query when regenerating in feature spec view", async () => {
    h.search = "?feature=auth";
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentationManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Auth Spec Markdown Content")).toBeInTheDocument();
    });

    const regenBtn = screen.getByRole("button", { name: /^regenerate$/i });
    fireEvent.click(regenBtn);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/documentation/status"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/documentation/features"] });
    });
  });
});
