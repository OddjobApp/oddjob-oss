import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CrewCycleAppCanvas, type CycleFleetApp } from "./CrewCycleAppCanvas";
import type { PendingSurfaceRequest } from "./CrewSurfaceRequestCard";

const apps: CycleFleetApp[] = [{
    id: 101, appId: 11, title: "SDLC Workbench", description: null,
    slug: "sdlc-workbench", publicSlug: "sdlc-workbench",
    publicPath: "/app/sdlc-workbench?embed=cycle", status: "active",
    isLive: true, blueprint: "hybrid-sdlc",
}];

function mountCanvas(onInputRequest: (request: PendingSurfaceRequest) => void, extra: Partial<Parameters<typeof CrewCycleAppCanvas>[0]> = {}) {
    render(<CrewCycleAppCanvas apps={apps} roomKey="room" organizationId={7} onInputRequest={onInputRequest} onClose={vi.fn()} {...extra} />);
    return document.querySelector("iframe")!;
}

function surfaceRequest(frame: HTMLIFrameElement, data: Record<string, unknown>, overrides: { origin?: string; source?: MessageEventSource | null } = {}) {
    fireEvent(window, new MessageEvent("message", {
        origin: overrides.origin ?? window.location.origin,
        source: overrides.source ?? frame.contentWindow,
        data,
    }));
}

const validQuestion = (requestId: string) => ({
    source: "crew-surface-request", version: 1, roomKey: "room", requestId,
    kind: "question", title: "Priority?", fields: [{ key: "p", label: "P" }],
});

describe("CREW app surface — adversarial boundaries", () => {
    it('opens a discussion draft only for the mounted app and matching room', () => {
        const discuss=vi.fn(),show=vi.fn();
        const frame=mountCanvas(vi.fn(),{onDiscuss:discuss,onShowChat:show});
        const request={source:'crew-app-discuss',version:1,roomKey:'room'};
        surfaceRequest(frame,request,{origin:'https://evil.example'});
        surfaceRequest(frame,{...request,roomKey:'other'});
        expect(discuss).not.toHaveBeenCalled();
        surfaceRequest(frame,request);
        expect(discuss).toHaveBeenCalledWith(apps[0]);
        expect(show).toHaveBeenCalledOnce();
    });
    it("rejects a spoofed origin on crew-surface-request", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        surfaceRequest(frame, validQuestion("spoofed"), { origin: "https://evil.example" });
        expect(receive).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
    });

    it("rejects a request whose roomKey belongs to another room", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        surfaceRequest(frame, { ...validQuestion("cross-room"), roomKey: "attacker-room" });
        expect(receive).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
    });

    it("rejects oversized requestId and roomKey at the schema boundary", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        surfaceRequest(frame, validQuestion("x".repeat(151)));
        surfaceRequest(frame, { ...validQuestion("ok"), roomKey: "y".repeat(151) });
        expect(receive).not.toHaveBeenCalled();
    });

    it("rejects malformed envelopes: approval without approvalId, question without fields", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        surfaceRequest(frame, { source: "crew-surface-request", version: 1, roomKey: "room", requestId: "a1", kind: "approval", title: "Approve?" });
        surfaceRequest(frame, { source: "crew-surface-request", version: 1, roomKey: "room", requestId: "a2", kind: "question", title: "No fields" });
        surfaceRequest(frame, { source: "crew-surface-request", version: 1, roomKey: "room", requestId: "a3", kind: "approval", title: "Wrong shape", approvalId: 5, fields: [{ key: "k", label: "K" }] });
        expect(receive).not.toHaveBeenCalled();
    });

    it("caps pending input requests at 20 and ignores the 21st", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        for (let i = 0; i < 20; i++) surfaceRequest(frame, validQuestion(`req-${i}`));
        expect(receive).toHaveBeenCalledTimes(20);
        surfaceRequest(frame, validQuestion("req-20-overflow"));
        expect(receive).toHaveBeenCalledTimes(20);
        expect(reply.mock.calls.filter(([msg]: any) => msg?.status === "accepted")).toHaveLength(20);
    });

    it("auto-cancels a request when the frame navigated before finish (stale surface)", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        surfaceRequest(frame, validQuestion("stale-1"));
        expect(receive).toHaveBeenCalledOnce();
        const finish: PendingSurfaceRequest["finish"] = receive.mock.calls[0][0].finish;
        // Navigate the mounted frame — the snapshot the request was bound to is gone.
        frame.setAttribute("src", "/app/sdlc-workbench/qa-workbench?embed=cycle");
        finish("submitted", { p: "High" });
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "stale-1", status: "cancelled" }),
            window.location.origin,
        );
        expect(reply).not.toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "stale-1", status: "submitted" }),
            window.location.origin,
        );
    });

    it("strips a malformed selectedRecord instead of forwarding it to the room", () => {
        const surface = vi.fn();
        render(<CrewCycleAppCanvas apps={apps} roomKey="room" organizationId={7} onSurfaceChange={surface} onClose={vi.fn()} />);
        const frame = document.querySelector("iframe")!;
        const view = (selectedRecord: unknown) => fireEvent(window, new MessageEvent("message", {
            origin: window.location.origin, source: frame.contentWindow,
            data: { source: "crew-app-view", version: 1, roomKey: "room", pathname: "/qa-workbench", selectedRecord },
        }));
        view({ collection: "tickets; DROP TABLE", recordId: "1" });
        view({ collection: "tickets", recordId: "r".repeat(151) });
        view({ collection: 42, recordId: "x" });
        for (const call of surface.mock.calls) expect(call[0].selectedRecord).toBeUndefined();
        surface.mockClear();
        view({ collection: "qa_workbench_defects", recordId: "def-9" });
        expect(surface).toHaveBeenCalledWith(expect.objectContaining({ selectedRecord: { collection: "qa_workbench_defects", recordId: "def-9" } }));
    });

    it("ignores crew-surface-cancel for a requestId that is not pending", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        surfaceRequest(frame, validQuestion("kept"));
        // Cancel a different requestId — the live one must not be cancelled.
        surfaceRequest(frame, { source: "crew-surface-cancel", version: 1, roomKey: "room", requestId: "other" });
        const finish: PendingSurfaceRequest["finish"] = receive.mock.calls[0][0].finish;
        finish("submitted", { p: "High" });
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "kept", status: "submitted" }),
            window.location.origin,
        );
    });

    it("end-to-end: mount → crew-app-view → select record → approval → crew-host-event", () => {
        const surface = vi.fn();
        const receive = vi.fn();
        const frame = mountCanvas(receive, { onSurfaceChange: surface });
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});

        // 1. The mounted frame reports its view with a selected record.
        fireEvent(window, new MessageEvent("message", {
            origin: window.location.origin, source: frame.contentWindow,
            data: { source: "crew-app-view", version: 1, roomKey: "room", pathname: "/qa-workbench",
                    selectedRecord: { collection: "qa_workbench_defects", recordId: "def-42" } },
        }));
        expect(surface).toHaveBeenCalledWith(expect.objectContaining({
            path: "/app/sdlc-workbench/qa-workbench",
            selectedRecord: { collection: "qa_workbench_defects", recordId: "def-42" },
        }));

        // 2. The surface raises a bound approval for a persisted proposal.
        surfaceRequest(frame, {
            source: "crew-surface-request", version: 1, roomKey: "room", requestId: "approval-1",
            kind: "approval", title: "Close defect DEF-42?", approvalId: 777,
        });
        expect(receive).toHaveBeenCalledOnce();
        const pending = receive.mock.calls[0][0];
        expect(pending.request.kind).toBe("approval");
        expect(pending.approvalUrl).toBe("/api/crew/room/surface-approval/777?orgId=7&app=%2Fapp%2Fsdlc-workbench%3Fembed%3Dcycle");
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "approval-1", status: "accepted" }),
            window.location.origin,
        );

        // 3. The human approves in the room → the iframe is told via crew-host-event.
        pending.finish("submitted", { approved: true });
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "approval-1", status: "submitted" }),
            window.location.origin,
        );
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({ source: "crew-host-event", version: 1, roomKey: "room",
                type: "approval-resolved", approvalId: 777, data: { approved: true } }),
            window.location.origin,
        );
    });

    it("does not let finish() fire twice on the same request", () => {
        const receive = vi.fn();
        const frame = mountCanvas(receive);
        const reply = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        surfaceRequest(frame, validQuestion("once"));
        const finish: PendingSurfaceRequest["finish"] = receive.mock.calls[0][0].finish;
        finish("submitted", { p: "Low" });
        expect(() => finish("submitted", { p: "High" })).toThrow("no longer active");
        expect(reply.mock.calls.filter(([msg]: any) => msg?.status === "submitted")).toHaveLength(1);
    });
});
