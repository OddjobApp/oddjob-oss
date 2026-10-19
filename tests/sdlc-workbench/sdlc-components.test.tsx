import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MermaidRenderer } from "../../server/blueprints/apps/sdlc-workbench/app/components/MermaidRenderer";
import { AdvancedFilterBar, type FilterState } from "../../server/blueprints/apps/sdlc-workbench/app/components/AdvancedFilterBar";
import { BranchDiffView } from "../../server/blueprints/apps/sdlc-workbench/app/components/BranchDiffView";
import { DiffView } from "../../server/blueprints/apps/sdlc-workbench/app/components/DiffView";

// Mock mermaid module
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg data-testid='mermaid-svg'>flowchart</svg>" }),
  },
}));

describe("SDLC Workbench Components", () => {
  describe("MermaidRenderer", () => {
    it("renders live architecture flowchart and handles code view toggle", async () => {
      const chart = `graph TD\n  Client --> Gateway\n  Gateway --> Service`;
      render(<MermaidRenderer chart={chart} scope="test-scope" />);

      expect(screen.getByText("Live Architecture Flowchart")).toBeDefined();
      expect(screen.getByText("Interactive Mermaid")).toBeDefined();

      // Toggle to Mermaid Syntax view
      const codeBtn = screen.getByRole("button", { name: /Mermaid Syntax/i });
      fireEvent.click(codeBtn);

      expect(screen.getByText(/Client --> Gateway/i)).toBeDefined();
    });
  });

  describe("AdvancedFilterBar", () => {
    it("handles search, status toggle, priority toggle, and clear all", () => {
      let currentFilters: FilterState = {};
      const onFiltersChange = vi.fn((f) => {
        currentFilters = f;
      });

      const { rerender } = render(
        <AdvancedFilterBar
          filters={currentFilters}
          onFiltersChange={onFiltersChange}
        />
      );

      // Search input
      const searchInput = screen.getByPlaceholderText(/Filter by title, key, RFC/i);
      fireEvent.change(searchInput, { target: { value: "PROJ-101" } });
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: "PROJ-101" }));

      // Status pill toggle
      const inReviewBtn = screen.getByRole("button", { name: "In Review" });
      fireEvent.click(inReviewBtn);
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["In Review"] }));

      // Priority pill toggle
      const criticalBtn = screen.getByRole("button", { name: "Critical" });
      fireEvent.click(criticalBtn);
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ priorities: ["Critical"] }));

      // Test active filter clear button
      rerender(
        <AdvancedFilterBar
          filters={{ search: "PROJ-101", statuses: ["In Review"] }}
          onFiltersChange={onFiltersChange}
        />
      );
      const clearBtn = screen.getByRole("button", { name: /Clear/i });
      fireEvent.click(clearBtn);
      expect(onFiltersChange).toHaveBeenCalledWith({});
    });
  });

  describe("BranchDiffView", () => {
    it("does not invent a diff or offer a review without repository evidence", () => {
      render(<BranchDiffView />);
      expect(screen.getByRole('status').textContent).toContain('No repository diff has been loaded');
      expect(screen.queryByRole('button', { name: /Request review/i })).toBeNull();
    });
    it("renders branch comparison bar, file tree, and handles split/unified toggle", () => {
      const onApprove = vi.fn();
      render(
        <BranchDiffView
          baseBranch="main"
          compareBranch="feature/test-branch"
          availableBranches={['main', 'feature/test-branch']}
          files={[{ filename: 'src/engine/orchestrator.ts', originalContent: 'before', modifiedContent: 'after', additions: 1, deletions: 1 }]}
          onApprove={onApprove}
        />
      );

      expect(screen.getAllByText(/changed files/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText("src/engine/orchestrator.ts").length).toBeGreaterThan(0);

      // Toggle to unified
      const unifiedBtn = screen.getByRole("button", { name: /Unified/i });
      fireEvent.click(unifiedBtn);

      // Click sign-off
      const approveBtn = screen.getByRole("button", { name: /Request review/i });
      fireEvent.click(approveBtn);
      expect(onApprove).toHaveBeenCalled();
      expect(screen.getByText("Review requested")).toBeDefined();
      expect(screen.queryByText("Approved & Merged")).toBeNull();
    });
  });

  describe("DiffView", () => {
    it("renders split and unified diffs with line statistics", () => {
      render(
        <DiffView
          original="line 1\nline 2"
          modified="line 1\nline 3\nline 4"
        />
      );

      expect(screen.getByText("Diff Comparison")).toBeDefined();

      // Toggle unified
      const unifiedBtn = screen.getByRole("button", { name: "Unified" });
      fireEvent.click(unifiedBtn);
    });
  });
});
