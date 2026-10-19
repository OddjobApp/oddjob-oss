import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { AppLaunchCard } from "./AppLaunchCard";

/**
 * Characterization tests for a card lifted out of AgentChatPanel.
 *
 * The part worth pinning is the postMessage listener. An embedded workbench app
 * talks to the room through window messages, and the handler checks e.origin
 * against window.location.origin before trusting anything in the payload —
 * without that check, any page the author happens to have open could post a
 * message that the room reports as something the app did.
 *
 * A security property enforced by one early `return` is precisely what a
 * refactor drops silently, because nothing else changes when it goes.
 */
const app = (overrides: Record<string, any> = {}) =>
    ({
        title: "Shelfie Workbench",
        mode: "link",
        href: "/app/shelfie",
        ...overrides,
    }) as any;

const post = (data: unknown, origin = window.location.origin) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin }));

afterEach(cleanup);

describe("AppLaunchCard", () => {
    it("renders the app so it can be opened", () => {
        render(<AppLaunchCard app={app()} />);

        expect(screen.getByTestId("turn-app-launch")).toBeInTheDocument();
        expect(screen.getByText("Shelfie Workbench")).toBeInTheDocument();
    });

    it("reports a save made inside an embedded app", async () => {
        const onEvent = vi.fn();
        render(<AppLaunchCard app={app({ mode: "embed" })} onEvent={onEvent} />);

        post({ source: "workbench", version: 1, type: "saved", payload: { summary: "Renamed a column" } });

        await waitFor(() =>
            expect(onEvent).toHaveBeenCalledWith('[APP_EVENT] Saved in "Shelfie Workbench": Renamed a column'),
        );
    });

    it("reports a cycle triggered from inside an embedded app", async () => {
        const onEvent = vi.fn();
        render(<AppLaunchCard app={app({ mode: "embed" })} onEvent={onEvent} />);

        post({ source: "workbench", version: 1, type: "trigger-cycle", payload: { cycleSlug: "nightly" } });

        await waitFor(() =>
            expect(onEvent).toHaveBeenCalledWith('[APP_EVENT] Triggered cycle "nightly" from "Shelfie Workbench"'),
        );
    });

    it("ignores a message from another origin", async () => {
        // The security property. Without the origin check, any other page the
        // author has open could make the room report something the app did not do.
        const onEvent = vi.fn();
        render(<AppLaunchCard app={app({ mode: "embed" })} onEvent={onEvent} />);

        post(
            { source: "workbench", version: 1, type: "saved", payload: { summary: "Injected" } },
            "https://evil.example",
        );

        await new Promise((r) => setTimeout(r, 20));
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("ignores a message that is not from the workbench protocol", async () => {
        const onEvent = vi.fn();
        render(<AppLaunchCard app={app({ mode: "embed" })} onEvent={onEvent} />);

        post({ source: "something-else", version: 1, type: "saved" });
        post({ source: "workbench", version: 99, type: "saved" });
        post("a bare string");
        post(null);

        await new Promise((r) => setTimeout(r, 20));
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("describes a save that arrives without a summary", async () => {
        const onEvent = vi.fn();
        render(<AppLaunchCard app={app({ mode: "embed" })} onEvent={onEvent} />);

        post({ source: "workbench", version: 1, type: "saved", payload: {} });

        await waitFor(() =>
            expect(onEvent).toHaveBeenCalledWith('[APP_EVENT] Saved in "Shelfie Workbench": User saved changes'),
        );
    });

    it("stops listening once the card is gone", async () => {
        const onEvent = vi.fn();
        const { unmount } = render(<AppLaunchCard app={app({ mode: "embed" })} onEvent={onEvent} />);

        unmount();
        post({ source: "workbench", version: 1, type: "saved", payload: { summary: "After unmount" } });

        await new Promise((r) => setTimeout(r, 20));
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("does not listen at all for a non-embedded app", async () => {
        // A link-mode app has no frame to talk to it, so a message claiming to
        // come from one is not the app.
        const onEvent = vi.fn();
        render(<AppLaunchCard app={app({ mode: "link" })} onEvent={onEvent} />);

        post({ source: "workbench", version: 1, type: "saved", payload: { summary: "Nope" } });

        await new Promise((r) => setTimeout(r, 20));
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("renders live interactive iframe when mode is embed and href is provided", () => {
        render(<AppLaunchCard app={app({ mode: "embed", href: "/app/budgetmaster-workbench?focusId=rec_42" })} />);

        const iframe = screen.getByTestId("tokenized-live-iframe").querySelector("iframe");
        expect(iframe).toBeInTheDocument();
        expect(iframe).toHaveAttribute("src", "/app/budgetmaster-workbench?focusId=rec_42&embedded=true");
        expect(screen.getByTestId("tokenized-surface-refresh")).toBeInTheDocument();
    });

    it("keeps a studio-marked app as a compact card rather than a transcript iframe", () => {
        render(<AppLaunchCard app={app({ mode: "embed", href: "/app/wayfare-342", studioSurface: "cycle_canvas", publicSlug: "wayfare-342" })} />);

        expect(screen.queryByTestId("tokenized-live-iframe")).not.toBeInTheDocument();
        expect(screen.getByTestId("turn-app-launch")).toBeInTheDocument();
        expect(screen.getByTestId("app-launch-open")).toHaveTextContent("Open in App Studio");
    });

    it("opens the App Studio canvas in place instead of a new window", () => {
        const listener = vi.fn();
        window.addEventListener("crew-cycle-app:open", listener);
        try {
            render(<AppLaunchCard app={app({ mode: "embed", href: "/app/wayfare-342", studioSurface: "cycle_canvas", publicSlug: "wayfare-342", deploymentId: 30 })} />);

            fireEvent.click(screen.getByTestId("app-launch-open"));

            expect(listener).toHaveBeenCalledOnce();
            expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
                publicSlug: "wayfare-342",
                deploymentId: 30,
            });
        } finally {
            window.removeEventListener("crew-cycle-app:open", listener);
        }
    });
});

