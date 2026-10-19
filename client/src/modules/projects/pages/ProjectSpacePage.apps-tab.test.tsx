/**
 * Project Space -> Apps tab.
 *
 * The cards used to be inert: an app's name, slug and status rendered as plain text
 * with nothing to click, so an app produced by a project could be seen but not opened.
 * Each card is now a link to that app's detail page, where its deployments and launch
 * actions live.
 *
 * The href is deliberately a plain anchor rather than a wouter <Link>. The project
 * space is served by operations.html and /armory/* by armory.html, and client-side
 * routing cannot cross an SPA bundle boundary — OperationsRouting only catches that
 * miss with a window.location.reload() failsafe. These assertions therefore check for
 * a real anchor with an href, which is what makes the navigation work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useProjectApps = vi.fn();
vi.mock("../hooks/use-projects", () => ({ useProjectApps: (...a: any[]) => useProjectApps(...a) }));

import { AppsTab } from "./ProjectSpacePage";

const app = (over: Record<string, unknown> = {}) => ({
    id: 14,
    name: "SDLC Workbench Suite (Org 291)",
    slug: "sdlc-workbench-org291",
    description: "Generated SDLC workbench",
    status: "active",
    ...over,
});

describe("AppsTab", () => {
    beforeEach(() => useProjectApps.mockReset());

    it("links each app to its detail page", () => {
        useProjectApps.mockReturnValue({ data: { apps: [app()] }, isLoading: false });
        render(<AppsTab projectKey="DEMO" />);

        const link = screen.getByTestId("project-app-link-14");
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", "/armory/apps/14");
    });

    it("still shows the app's name, slug and status", () => {
        useProjectApps.mockReturnValue({ data: { apps: [app()] }, isLoading: false });
        render(<AppsTab projectKey="DEMO" />);

        expect(screen.getByText("SDLC Workbench Suite (Org 291)")).toBeInTheDocument();
        expect(screen.getByText("sdlc-workbench-org291")).toBeInTheDocument();
        expect(screen.getByText("active")).toBeInTheDocument();
    });

    it("renders one link per app, each to its own id", () => {
        useProjectApps.mockReturnValue({
            data: { apps: [app(), app({ id: 890, name: "TiCal", slug: "tical" })] },
            isLoading: false,
        });
        render(<AppsTab projectKey="DEMO" />);

        expect(screen.getByTestId("project-app-link-14")).toHaveAttribute("href", "/armory/apps/14");
        expect(screen.getByTestId("project-app-link-890")).toHaveAttribute("href", "/armory/apps/890");
    });

    it("shows the empty state rather than an empty grid", () => {
        useProjectApps.mockReturnValue({ data: { apps: [] }, isLoading: false });
        render(<AppsTab projectKey="DEMO" />);

        expect(screen.queryByTestId("project-apps-list")).toBeNull();
        expect(screen.getByText(/no apps have been produced/i)).toBeInTheDocument();
    });

    it("does not render links while loading", () => {
        useProjectApps.mockReturnValue({ data: undefined, isLoading: true });
        render(<AppsTab projectKey="DEMO" />);

        expect(screen.queryByTestId("project-app-link-14")).toBeNull();
    });
});
