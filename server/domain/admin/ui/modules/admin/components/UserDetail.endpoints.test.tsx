import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * Endpoint regression guard for UserDetail.
 *
 * Every write on this page pointed at a URL nobody serves. `/api/users` mounts
 * a router with a single `GET "/"`, and auth.routes adds `/api/users/current` —
 * there is no `GET`, `PATCH` or `DELETE` for `/api/users/:id` anywhere in the
 * server. So loading a user 404'd, "Save" 404'd, and delete 404'd, while the
 * equivalent handlers existed the whole time on the admin router
 * (server/domain/admin/admin.route.ts: GET/PUT/DELETE `/users/:id`, mounted at
 * `/api/admin`).
 *
 * These tests pin the URLs and verbs, because the failure was invisible from
 * reading the component: the call looked perfectly reasonable.
 */

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn(async () => ({ json: async () => ({}) })) }));
vi.mock("@/lib/queryClient", async () => {
    const actual = await vi.importActual<any>("@/lib/queryClient");
    return { ...actual, apiRequest };
});

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("@domain-ui/auth/ui/modules/auth", () => ({
    useAuth: () => ({ user: { username: "admin" } }),
}));

vi.mock("wouter", async () => {
    const actual = await vi.importActual<any>("wouter");
    return {
        ...actual,
        useRoute: (pattern: string) =>
            pattern === "/account-admin/users/:id" ? [true, { id: "42" }] : [false, null],
        useLocation: () => ["/account-admin/users/42", vi.fn()],
        Link: ({ children }: any) => <a>{children}</a>,
    };
});

import UserDetail from "./UserDetail";

const fetchMock = vi.fn();

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <UserDetail />
        </QueryClientProvider>,
    );
}

describe("UserDetail endpoints", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                id: "42",
                email: "ada@example.com",
                firstName: "Ada",
                lastName: "Lovelace",
                username: "ada",
            }),
        });
        vi.stubGlobal("fetch", fetchMock);
    });

    it("loads the user from the admin router, not /api/users/:id", async () => {
        renderPage();

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));

        expect(urls).toContain("/api/admin/users/42");
        // The route that does not exist.
        expect(urls.some((u) => /^\/api\/users\/\d+$/.test(u))).toBe(false);
    });

    it("saves with PUT to the admin router", async () => {
        renderPage();
        await waitFor(() => expect(screen.getByText(/Ada/)).toBeInTheDocument());

        fireEvent.click(screen.getByTestId("button-edit"));
        fireEvent.click(screen.getByTestId("button-save"));

        await waitFor(() => expect(apiRequest).toHaveBeenCalled());
        const [verb, url] = apiRequest.mock.calls[0] as any[];
        expect(verb).toBe("PUT");
        expect(url).toBe("/api/admin/users/42");
    });

    it("does not claim a password was reset when nothing resets it", async () => {
        renderPage();
        await waitFor(() => expect(screen.getByText(/Ada/)).toBeInTheDocument());

        fireEvent.change(screen.getByTestId("input-reset-password"), {
            target: { value: "correct-horse-battery" },
        });
        fireEvent.change(screen.getByTestId("input-confirm-reset-password"), {
            target: { value: "correct-horse-battery" },
        });
        fireEvent.click(screen.getByTestId("button-reset-password"));

        await waitFor(() => expect(toast).toHaveBeenCalled());
        const said = toast.mock.calls.map((c: any[]) => JSON.stringify(c[0])).join(" ");
        expect(said).not.toMatch(/successfully reset/i);
        expect(said).toMatch(/not available/i);
    });
});
