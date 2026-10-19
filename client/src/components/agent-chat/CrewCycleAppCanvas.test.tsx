import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CrewCycleAppCanvas, type CycleFleetApp } from "./CrewCycleAppCanvas";

describe("CrewCycleAppCanvas", () => {
    const mockApps: CycleFleetApp[] = [
        {
            id: 101,
            appId: 11,
            title: "SDLC Workbench",
            description: "Main software engineering portal",
            slug: "sdlc-workbench",
            publicSlug: "sdlc-workbench",
            publicPath: "/app/sdlc-workbench?embed=cycle",
            status: "active",
            isLive: true,
            stage: "architecture",
            blueprint: "hybrid-sdlc",
        },
        {
            id: 102,
            appId: 12,
            title: "QA Matrix",
            description: "Automated regression tester",
            slug: "qa-workbench",
            publicSlug: "qa-workbench",
            publicPath: "/app/qa-workbench?embed=cycle",
            status: "active",
            isLive: true,
            stage: "qa",
            blueprint: "hybrid-sdlc",
        },
    ];

    it('offers recovery when the frame fails and reloads it on Retry', () => {
        vi.useFakeTimers();
        try {
        render(<CrewCycleAppCanvas apps={mockApps} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        act(() => vi.advanceTimersByTime(20000));
        expect(screen.getByRole('status')).toHaveTextContent('did not finish loading');
        fireEvent.click(screen.getByRole('button', { name: 'Retry app surface' }));
        expect(document.querySelector('iframe')).not.toBe(frame);
        expect(screen.getByRole('status')).toHaveTextContent('Loading app surface');
        } finally { vi.useRealTimers(); }
    });

    it('hides a cached assistant panel and expands workbench data when mounted in CREW', () => {
        render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" onActivity={vi.fn()} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        const frameDocument = frame.contentDocument!;
        frameDocument.open();
        frameDocument.write('<html><head></head><body></body></html>');
        frameDocument.close();
        frameDocument.body.innerHTML = '<div class="grid"><div id="work">QA results</div><div id="assistant"><div class="shadow-2xl"><input placeholder="Ask the agent a question..."></div></div></div>';
        fireEvent.load(frame);
        expect(frameDocument.querySelector('style[data-crew-app-presentation]')).not.toBeNull();
        expect(frame.contentWindow!.getComputedStyle(frameDocument.getElementById('assistant')!).display).toBe('none');
        expect(frame.contentWindow!.getComputedStyle(frameDocument.querySelector('.grid')!).gridTemplateColumns).toBe('minmax(0,1fr)');
    });

    it('returns from a child workbench to the previous app screen', () => {
        render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" organizationId={342} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        const home = frame.getAttribute('src')!;
        fireEvent.load(frame);
        frame.src = '/app/sdlc-workbench/pm-workbench?embed=cycle&crewRoom=room&orgId=342';
        fireEvent.load(frame);
        expect(screen.getByRole('button', { name: /^Back$/ })).not.toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
        expect(document.querySelector('iframe')?.getAttribute('src')).toBe(home);
    });

    it('accepts activity only from the mounted same-origin iframe and room', () => {
        const receive = vi.fn();
        render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" organizationId={342} onActivity={receive} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        expect(frame.src).toContain('crewActivity=chat');
        const data = { source: 'crew-app-activity', version: 1, roomKey: 'room', events: [] };
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data }));
        window.dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.example', source: frame.contentWindow, data }));
        expect(receive).not.toHaveBeenCalled();
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
        expect(receive).toHaveBeenCalledWith({ appTitle: 'SDLC Workbench', events: [] });
    });

    it('returns from fullscreen to chat, toggles the room rail, and exits explicitly', () => {
        const showChat = vi.fn();
        const toggleRail = vi.fn();
        const close = vi.fn();
        render(<CrewCycleAppCanvas apps={mockApps} onClose={close} onShowChat={showChat} rightRailCollapsed onToggleRightRail={toggleRail} />);
        fireEvent.click(screen.getByTitle('Fullscreen Canvas (100%)'));
        fireEvent.click(screen.getByRole('button', { name: 'Show chat' }));
        expect(showChat).toHaveBeenCalledOnce();
        expect(screen.getByTestId('crew-app-studio-canvas')).not.toHaveClass('fixed');
        fireEvent.click(screen.getByRole('button', { name: 'Show right rail' }));
        expect(toggleRail).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: /^Exit$/ }));
        expect(close).toHaveBeenCalledOnce();
    });

    it("renders iframe canvas with selected app surface and auto-appends embedded=true", () => {
        const onClose = vi.fn();
        render(
            <CrewCycleAppCanvas
                cycleSlug="hybrid-sdlc"
                cycleName="Enterprise Hybrid AI SDLC"
                stageName="Architecture Review"
                apps={mockApps}
                onClose={onClose}
            />
        );

        expect(screen.getByText("App Studio")).toBeDefined();
        const iframe = document.querySelector("iframe");
        expect(iframe).not.toBeNull();
        expect(iframe?.getAttribute("src")).toBe("/app/sdlc-workbench?embed=cycle&embedded=true");
    });

    it("toggles viewport modes between split (50%), wide (75%), and fullscreen (100%)", () => {
        const onClose = vi.fn();
        const { container } = render(
            <CrewCycleAppCanvas
                cycleSlug="hybrid-sdlc"
                apps={mockApps}
                onClose={onClose}
            />
        );

        // Split view by default
        expect(container.firstChild).toHaveClass("max-w-[50vw]");

        // Toggle Wide view
        const wideBtn = screen.getByTitle("Wide View (75%)");
        fireEvent.click(wideBtn);
        expect(container.firstChild).toHaveClass("max-w-[75vw]");

        // Toggle Fullscreen view
        const fullscreenBtn = screen.getByTitle("Fullscreen Canvas (100%)");
        fireEvent.click(fullscreenBtn);
        expect(screen.getByTestId("crew-app-studio-canvas")).toHaveClass("fixed");
        expect(screen.getByTestId("crew-app-studio-canvas")).toHaveClass("inset-0");
    });

    it("calls onClose when close button is clicked", () => {
        const onClose = vi.fn();
        render(
            <CrewCycleAppCanvas
                cycleSlug="hybrid-sdlc"
                apps={mockApps}
                onClose={onClose}
            />
        );

        const closeBtn = screen.getByTitle("Close Canvas");
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('only prepares cycle requests from this room and mounted iframe, and acknowledges without launching', () => {
        const prepare = vi.fn();
        render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" onRequestCycle={prepare} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        const ack = vi.spyOn(frame.contentWindow!, 'postMessage');
        const data = { source: 'workbench', version: 1, roomKey: 'room', type: 'trigger-cycle', requestId: 'r-1' };
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data }));
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { ...data, roomKey: 'other' } }));
        expect(prepare).not.toHaveBeenCalled();
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
        expect(prepare).toHaveBeenCalledOnce();
        expect(ack).toHaveBeenCalledWith(expect.objectContaining({ status: 'prepared', requestId: 'r-1', roomKey: 'room' }), window.location.origin);
    });

    it('passes only a validated handoff reference to the CREW draft callback', () => {
        const prepare = vi.fn();
        render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" onRequestCycle={prepare} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        const handoffId = 'a'.repeat(64);
        const data = { source: 'workbench', version: 1, roomKey: 'room', type: 'trigger-cycle', requestId: 'handoff-review', payload: { reason: 'Untrusted app text', payload: { handoffId } } };
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
        expect(prepare).toHaveBeenCalledWith(mockApps[0], { handoffId });
        prepare.mockClear();
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { ...data, payload: { payload: { handoffId: 'not-a-valid-receipt' } } } }));
        expect(prepare).not.toHaveBeenCalled();
    });

    it('tracks client-side workbench navigation only from the mounted room iframe', () => {
        const surface = vi.fn();
        render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" onSurfaceChange={surface} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        const data = { source: 'crew-app-view', version: 1, roomKey: 'room', pathname: '/qa-workbench' };
        window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data }));
        expect(surface).not.toHaveBeenCalled();
        fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
        expect(surface).toHaveBeenCalledWith(expect.objectContaining({ path: '/app/sdlc-workbench/qa-workbench' }));
        fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { ...data, pathname: '/devops-workbench' } }));
        fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
        expect(document.querySelector('iframe')?.getAttribute('src')).toContain('/app/sdlc-workbench/qa-workbench?');
        expect(document.querySelector('iframe')?.getAttribute('src')).toContain('crewRoom=room');
        surface.mockClear();
        fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { ...data, pathname: '/app/another-tenant/qa-workbench' } }));
        expect(surface).not.toHaveBeenCalled();
    });

    it('deduplicates surface input and cancels it when the canvas closes', () => {
        const receive = vi.fn();
        const { unmount } = render(<CrewCycleAppCanvas apps={mockApps} roomKey="room" onInputRequest={receive} onClose={vi.fn()} />);
        const frame = document.querySelector('iframe')!;
        const reply = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
        const data = { source: 'crew-surface-request', version: 1, roomKey: 'room', requestId: 'input-1', kind: 'question', title: 'Priority?', fields: [{ key: 'priority', label: 'Priority', required: true }] };
        fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data }));
        expect(receive).not.toHaveBeenCalled();
        fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
        fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
        expect(receive).toHaveBeenCalledOnce();
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', requestId: 'input-1' }), window.location.origin);
        unmount();
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }), window.location.origin);
        expect(() => receive.mock.calls[0][0].finish('submitted', { priority: 'High' })).toThrow('no longer active');
    });

    it("shows empty state when no apps are provided", () => {
        const onClose = vi.fn();
        render(
            <CrewCycleAppCanvas
                cycleSlug="hybrid-sdlc"
                apps={[]}
                onClose={onClose}
            />
        );

        expect(screen.getByText("No Connected App Surfaces")).toBeDefined();
        const closeBtn = screen.getByRole("button", { name: /close canvas/i });
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });
});
