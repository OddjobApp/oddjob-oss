import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import {
  resolveTutorialForElement,
  useGlobalHoverTutorial,
  DEFAULT_HOVER_TUTORIAL_DELAY_MS,
  getHoverTutorialDelay,
} from "./useHoverTutorial";
import { TUTORIAL_SNIPPETS } from "@shared/tutorials/registry";

describe("useHoverTutorial engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as any).__ODDJOB_HOVER_TUTORIAL_DELAY_MS;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("resolveTutorialForElement", () => {
    it("resolves elements with explicit data-tutorial-snippet", () => {
      const container = document.createElement("div");
      container.setAttribute("data-tutorial-snippet", "snippet:crew-roster");
      const child = document.createElement("button");
      container.appendChild(child);
      document.body.appendChild(container);

      const resolved = resolveTutorialForElement(child);
      expect(resolved).not.toBeNull();
      expect(resolved?.snippetId).toBe("snippet:crew-roster");
      expect(resolved?.anchorEl).toBe(container);
    });

    it("resolves elements with data-component-id matching registry", () => {
      const el = document.createElement("div");
      el.setAttribute("data-component-id", "header-mission-ticker");
      document.body.appendChild(el);

      const resolved = resolveTutorialForElement(el);
      expect(resolved).not.toBeNull();
      expect(resolved?.snippetId).toBe("snippet:telemetry");
      expect(resolved?.anchorEl).toBe(el);
    });

    it("resolves ad-hoc snippets with data-tutorial-title and data-tutorial-description", () => {
      const el = document.createElement("div");
      el.setAttribute("data-tutorial-title", "Custom Graph Widget");
      el.setAttribute("data-tutorial-description", "Interactive 3D visualization widget.");
      el.setAttribute("data-tutorial-action", "Renders Eulerian topological mesh on canvas.");
      document.body.appendChild(el);

      const resolved = resolveTutorialForElement(el);
      expect(resolved).not.toBeNull();
      expect(resolved?.def).toBeDefined();
      expect(resolved?.def?.name).toBe("Custom Graph Widget");
      expect(resolved?.def?.steps[0].description).toBe("Interactive 3D visualization widget.");
      expect(resolved?.def?.steps[0].action).toBe("Renders Eulerian topological mesh on canvas.");
    });

    it("resolves a button to a semantic ad-hoc def with both description and action", () => {
      const btn = document.createElement("button");
      btn.textContent = "Create Mission";
      document.body.appendChild(btn);

      const resolved = resolveTutorialForElement(btn);
      expect(resolved).not.toBeNull();
      expect(resolved?.def?.name).toBe("Create Mission");
      expect(resolved?.def?.steps[0].description).toContain("Creates a new");
      expect(resolved?.def?.steps[0].action).toBe("Creates a new mission.");
    });

    it("prefers aria-label over text content for buttons", () => {
      const btn = document.createElement("button");
      btn.setAttribute("aria-label", "Close panel");
      btn.textContent = "×";
      document.body.appendChild(btn);

      const resolved = resolveTutorialForElement(btn);
      expect(resolved?.def?.name).toBe("Close panel");
    });

    it("resolves an input field using its placeholder", () => {
      const input = document.createElement("input");
      input.setAttribute("placeholder", "Search agents...");
      document.body.appendChild(input);

      const resolved = resolveTutorialForElement(input);
      expect(resolved).not.toBeNull();
      expect(resolved?.def?.steps[0].description).toContain("search agents");
    });

    it("resolves a data-testid element with a generated description", () => {
      const el = document.createElement("div");
      el.setAttribute("data-testid", "agent-status-badge");
      document.body.appendChild(el);

      const resolved = resolveTutorialForElement(el);
      expect(resolved).not.toBeNull();
      expect(resolved?.def?.steps[0].description).toContain("agent status badge");
    });

    it("returns null for ordinary non-interactive elements with no tutorial associations", () => {
      const plain = document.createElement("p");
      plain.textContent = "Plain text";
      document.body.appendChild(plain);

      expect(resolveTutorialForElement(plain)).toBeNull();
    });
  });

  describe("getHoverTutorialDelay", () => {
    it("returns default 3,000ms delay", () => {
      expect(DEFAULT_HOVER_TUTORIAL_DELAY_MS).toBe(3000);
      expect(getHoverTutorialDelay(null)).toBe(3000);
    });

    it("respects data-tutorial-delay attribute override", () => {
      const el = document.createElement("div");
      el.setAttribute("data-tutorial-delay", "3000");
      expect(getHoverTutorialDelay(el)).toBe(3000);
    });

    it("respects window.__ODDJOB_HOVER_TUTORIAL_DELAY_MS global override", () => {
      (window as any).__ODDJOB_HOVER_TUTORIAL_DELAY_MS = 2500;
      expect(getHoverTutorialDelay(null)).toBe(2500);
    });
  });

  describe("useGlobalHoverTutorial hook", () => {
    function TestHost({ isTutorialActive = false }: { isTutorialActive?: boolean }) {
      useGlobalHoverTutorial(isTutorialActive);
      return (
        <div>
          <div
            data-testid="test-crew-roster"
            data-tutorial-snippet="snippet:crew-roster"
            className="roster-box"
          >
            <span data-testid="test-child-button">Agent Card</span>
          </div>
          <div data-testid="test-plain-box">No tutorial here</div>
        </div>
      );
    }

    it("does not set triggered=true before 5 seconds elapse", () => {
      function PreviewCheck() {
        const preview = useGlobalHoverTutorial(false);
        return <div data-testid="triggered">{String(preview?.triggered ?? "null")}</div>;
      }
      render(<PreviewCheck />);
      const element = document.createElement("div");
      element.setAttribute("data-tutorial-snippet", "snippet:crew-roster");
      document.body.appendChild(element);

      fireEvent.mouseOver(element);

      // Advance by 2.9 seconds (below 3s threshold)
      act(() => {
        vi.advanceTimersByTime(2900);
      });

      expect(screen.getByTestId("triggered").textContent).not.toBe("true");
    });

    it("sets triggered=true on preview after hovering for 5 seconds (no oddjob:start-tutorial event)", () => {
      const startSpy = vi.fn();
      window.addEventListener("oddjob:start-tutorial", startSpy);

      function PreviewCheck() {
        const preview = useGlobalHoverTutorial(false);
        return (
          <div>
            <div data-testid="test-crew-roster" data-tutorial-snippet="snippet:crew-roster" />
            <div data-testid="triggered">{String(preview?.triggered ?? "null")}</div>
            <div data-testid="title">{preview?.title ?? ""}</div>
          </div>
        );
      }

      render(<PreviewCheck />);
      const element = screen.getByTestId("test-crew-roster");

      fireEvent.mouseOver(element);

      // Advance full 5 seconds
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // No full tour event is fired
      expect(startSpy).not.toHaveBeenCalled();
      // Preview becomes triggered with the right title
      expect(screen.getByTestId("triggered").textContent).toBe("true");
      expect(screen.getByTestId("title").textContent).toBe(TUTORIAL_SNIPPETS["snippet:crew-roster"].title);

      window.removeEventListener("oddjob:start-tutorial", startSpy);
    });

    it("cancels timer if user moves mouse away before 5 seconds", () => {
      const startSpy = vi.fn();
      window.addEventListener("oddjob:start-tutorial", startSpy);

      render(<TestHost />);
      const element = screen.getByTestId("test-crew-roster");
      const outside = screen.getByTestId("test-plain-box");

      fireEvent.mouseOver(element);

      // Hover for 2 seconds, then leave
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      fireEvent.mouseOut(element, { relatedTarget: outside });

      // Advance past the 5s mark
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(startSpy).not.toHaveBeenCalled();
      window.removeEventListener("oddjob:start-tutorial", startSpy);
    });

    it("preserves timer if cursor moves within child elements of the component", () => {
      const startSpy = vi.fn();
      window.addEventListener("oddjob:start-tutorial", startSpy);

      function PreviewCheck() {
        const preview = useGlobalHoverTutorial(false);
        return (
          <div>
            <div data-testid="test-crew-roster" data-tutorial-snippet="snippet:crew-roster">
              <span data-testid="test-child-button">Agent Card</span>
            </div>
            <div data-testid="triggered">{String(preview?.triggered ?? "null")}</div>
          </div>
        );
      }

      render(<PreviewCheck />);
      const parent = screen.getByTestId("test-crew-roster");
      const child = screen.getByTestId("test-child-button");

      fireEvent.mouseOver(parent);

      // 2 seconds in, cursor moves over child inside parent
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      fireEvent.mouseOut(parent, { relatedTarget: child });
      fireEvent.mouseOver(child);

      // 3 more seconds in (5s total)
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // No full tour event — info bubble is displayed instead
      expect(startSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("triggered").textContent).toBe("true");
      window.removeEventListener("oddjob:start-tutorial", startSpy);
    });

    it("does not trigger hover snippet if a tutorial is already actively open", () => {
      const startSpy = vi.fn();
      window.addEventListener("oddjob:start-tutorial", startSpy);

      render(<TestHost isTutorialActive={true} />);
      const element = screen.getByTestId("test-crew-roster");

      fireEvent.mouseOver(element);

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(startSpy).not.toHaveBeenCalled();
      window.removeEventListener("oddjob:start-tutorial", startSpy);
    });

    it("shows nothing during 3-second wait, then displays info bubble when triggered", () => {
      const startSpy = vi.fn();
      window.addEventListener("oddjob:start-tutorial", startSpy);

      function PreviewTestHost() {
        const preview = useGlobalHoverTutorial(false);
        return (
          <div>
            <div data-testid="target-box" data-tutorial-snippet="snippet:crew-roster">Target</div>
            <div data-testid="has-preview">{String(!!preview)}</div>
            <div data-testid="triggered">{String(preview?.triggered ?? false)}</div>
            {preview?.triggered && (
              <div data-testid="info-bubble">
                <span data-testid="bubble-title">{preview.title}</span>
                <span data-testid="bubble-description">{preview.description}</span>
                <span data-testid="bubble-action">{preview.action}</span>
                <button data-testid="dismiss-btn" onClick={preview.dismiss}>Dismiss</button>
              </div>
            )}
          </div>
        );
      }

      render(<PreviewTestHost />);
      const target = screen.getByTestId("target-box");

      fireEvent.mouseOver(target);

      // Immediately after hover — preview exists but bubble is NOT triggered yet
      expect(screen.getByTestId("has-preview").textContent).toBe("true");
      expect(screen.getByTestId("triggered").textContent).toBe("false");
      expect(screen.queryByTestId("info-bubble")).not.toBeInTheDocument();

      // Advance to just under 3s — still not triggered
      act(() => { vi.advanceTimersByTime(2900); });
      expect(screen.queryByTestId("info-bubble")).not.toBeInTheDocument();

      // Advance past 3s — bubble appears
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByTestId("triggered").textContent).toBe("true");
      expect(screen.getByTestId("info-bubble")).toBeInTheDocument();
      expect(screen.getByTestId("bubble-title").textContent).toBe(TUTORIAL_SNIPPETS["snippet:crew-roster"].title);
      expect(screen.getByTestId("bubble-action").textContent).toBe(TUTORIAL_SNIPPETS["snippet:crew-roster"].action);

      // No full tour event fired
      expect(startSpy).not.toHaveBeenCalled();

      window.removeEventListener("oddjob:start-tutorial", startSpy);
    });
  });
});
