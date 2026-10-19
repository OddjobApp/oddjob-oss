import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MermaidRenderer } from "../../server/blueprints/apps/product-launch-workbench/app/components/MermaidRenderer";
import { AdvancedFilterBar, type FilterState } from "../../server/blueprints/apps/product-launch-workbench/app/components/AdvancedFilterBar";
import { CollateralDiffView } from "../../server/blueprints/apps/product-launch-workbench/app/components/CollateralDiffView";

// Mock mermaid module
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg data-testid='mermaid-gtm-svg'>flowchart</svg>" }),
  },
}));

describe("Product Launch Workbench Components", () => {
  describe("MermaidRenderer", () => {
    it("renders GTM launch roadmap and toggles code view", async () => {
      const chart = `graph TD\n  Research --> GTM\n  GTM --> Content\n  Content --> Beta\n  Beta --> Launch`;
      render(<MermaidRenderer chart={chart} scope="product-launch" />);

      expect(screen.getByText("Live Launch Roadmap & Dependency Graph")).toBeDefined();
      expect(screen.getByText("Interactive Flow")).toBeDefined();

      // Toggle to Mermaid Syntax
      const codeBtn = screen.getByRole("button", { name: /Mermaid Syntax/i });
      fireEvent.click(codeBtn);

      expect(screen.getByText(/Research --> GTM/i)).toBeDefined();
    });
  });

  describe("AdvancedFilterBar", () => {
    it("handles search queries, status toggles, type toggles, and clear-all", () => {
      let currentFilters: FilterState = {};
      const onFiltersChange = vi.fn((f) => {
        currentFilters = f;
      });

      const { rerender } = render(
        <AdvancedFilterBar
          filters={currentFilters}
          onFiltersChange={onFiltersChange}
          placeholder="Filter launch milestones..."
        />
      );

      // Search input
      const searchInput = screen.getByPlaceholderText("Filter launch milestones...");
      fireEvent.change(searchInput, { target: { value: "Press Release" } });
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: "Press Release" }));

      // Status toggle
      const approvedBtn = screen.getByRole("button", { name: "Approved" });
      fireEvent.click(approvedBtn);
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["approved"] }));

      // Type toggle
      const landingPageBtn = screen.getByRole("button", { name: "Landing Page" });
      fireEvent.click(landingPageBtn);
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ types: ["Landing Page"] }));

      // Test active filter clear
      rerender(
        <AdvancedFilterBar
          filters={{ search: "Press Release", statuses: ["approved"] }}
          onFiltersChange={onFiltersChange}
        />
      );
      const clearBtn = screen.getByRole("button", { name: /Clear/i });
      fireEvent.click(clearBtn);
      expect(onFiltersChange).toHaveBeenCalledWith({});
    });
  });

  describe("CollateralDiffView", () => {
    it("renders split & unified views and handles 1-click sign-off", () => {
      const onApprove = vi.fn();
      render(
        <CollateralDiffView
          originalContent="AI draft copy line 1\nAI draft copy line 2"
          modifiedContent="AI draft copy line 1\nGTM polish line 2\nKey benefits line 3"
          assetTitle="Press Release: Oddjob 5.0"
          assetType="Press Release"
          onApprove={onApprove}
        />
      );

      expect(screen.getByText("Press Release: Oddjob 5.0")).toBeDefined();
      expect(screen.getByText("AI Draft Copy")).toBeDefined();
      expect(screen.getByText("Human Revisions & Polish")).toBeDefined();

      // Toggle to unified
      const unifiedBtn = screen.getByRole("button", { name: /Unified/i });
      fireEvent.click(unifiedBtn);

      // Click sign-off
      const approveBtn = screen.getByRole("button", { name: /Sign-Off & Publish/i });
      fireEvent.click(approveBtn);
      expect(onApprove).toHaveBeenCalled();
      expect(screen.getByText("Approved & Signed-Off")).toBeDefined();
    });
  });
});
