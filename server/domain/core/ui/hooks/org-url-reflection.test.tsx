/**
 * The active organization is now written into the URL.
 *
 * Org precedence is URL > sessionStorage > the user's default, but only the first is
 * visible. A page resolved from sessionStorage looked org-agnostic while every API
 * call it made carried an org, so the same link meant different things depending on
 * invisible state.
 *
 * Concretely: /operations/workstreams/393 reported "Pipeline not found" for a user
 * whose OWN default org owns pipeline 393, because sessionStorage was still pinned to
 * another org from an earlier page. Nothing on screen said which org was being read as.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const mockUser: { current: any } = { current: { username: "tester", defaultOrgId: 473 } };
// Mock the specifier the hook actually imports, not the barrel next to it.
vi.mock("@domain-ui/auth/ui/modules/auth/hooks/use-auth", () => ({
    useAuth: () => ({ user: mockUser.current }),
}));

import { OrgProvider } from "./use-org-context";

const setUrl = (href: string) => window.history.replaceState({}, "", href);

beforeEach(() => {
    sessionStorage.clear();
    setUrl("/operations/workstreams/393");
    mockUser.current = { username: "tester", defaultOrgId: 473 };
});
afterEach(() => sessionStorage.clear());

const renderProvider = () => render(<OrgProvider><div /></OrgProvider>);

describe("OrgProvider — the active org is visible in the URL", () => {
    it("writes the org resolved from sessionStorage into the URL", async () => {
        sessionStorage.setItem("selectedOrganizationId", "342");
        renderProvider();
        await waitFor(() => expect(new URL(window.location.href).searchParams.get("orgId")).toBe("342"));
    });

    it("writes the user's default org when nothing else selected one", async () => {
        renderProvider();
        await waitFor(() => expect(new URL(window.location.href).searchParams.get("orgId")).toBe("473"));
    });

    it("leaves an org already named in the URL alone — it has highest precedence", async () => {
        setUrl("/operations/workstreams/393?orgId=291");
        sessionStorage.setItem("selectedOrganizationId", "342");
        renderProvider();
        await waitFor(() => expect(new URL(window.location.href).searchParams.get("orgId")).toBe("291"));
    });

    it("preserves the path and any other query parameters", async () => {
        setUrl("/operations/workstreams/393?tab=runs");
        sessionStorage.setItem("selectedOrganizationId", "342");
        renderProvider();
        await waitFor(() => {
            const url = new URL(window.location.href);
            expect(url.pathname).toBe("/operations/workstreams/393");
            expect(url.searchParams.get("tab")).toBe("runs");
            expect(url.searchParams.get("orgId")).toBe("342");
        });
    });

    it("does not add a history entry — this describes the page, it is not a navigation", async () => {
        sessionStorage.setItem("selectedOrganizationId", "342");
        const before = window.history.length;
        renderProvider();
        await waitFor(() => expect(new URL(window.location.href).searchParams.get("orgId")).toBe("342"));
        expect(window.history.length).toBe(before);
    });
});
