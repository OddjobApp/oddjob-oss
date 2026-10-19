import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OntologyUnitSurface } from "./OntologyUnitSurface";

/**
 * Characterization tests for a surface lifted out of AgentChatPanel.
 *
 * Almost all of this component is shape-normalisation: the ontology tools return
 * three different payload shapes and it flattens them into one list. That is
 * exactly the kind of logic a later refactor simplifies by accident, because the
 * branches look redundant until you know which tool produces which shape.
 */
const surface = (payload: Record<string, any>) => render(<OntologyUnitSurface payload={payload} />);

describe("OntologyUnitSurface", () => {
    it("reads a traversal payload from data.objects", () => {
        surface({
            type: "ontology_traversal",
            title: "Linked",
            data: { objects: [{ name: "Acme Corp" }, { name: "Globex" }] },
        });

        expect(screen.getByText("Acme Corp")).toBeInTheDocument();
        expect(screen.getByText("Globex")).toBeInTheDocument();
        expect(screen.getByText("2 items")).toBeInTheDocument();
    });

    it("reads a list payload straight from data", () => {
        surface({ type: "ontology_objects", data: [{ name: "One" }] });
        expect(screen.getByText("One")).toBeInTheDocument();
    });

    it("wraps a single object into a list of one", () => {
        // ontology_get_object returns the object itself, not an array.
        surface({ type: "ontology_object", data: { name: "Solo" } });

        expect(screen.getByText("Solo")).toBeInTheDocument();
        expect(screen.getByText("1 item")).toBeInTheDocument();
    });

    it("says so rather than rendering an empty frame", () => {
        surface({ type: "ontology_objects", data: null });
        expect(screen.getByText(/no related objects found/i)).toBeInTheDocument();
    });

    it("falls back through the naming chain rather than showing a blank row", () => {
        // A row can arrive with any one of these, and an unnamed row still has
        // to be identifiable.
        surface({
            type: "ontology_objects",
            data: [{ title: "By title" }, { label: "By label" }, { externalId: "EXT-1" }, {}],
        });

        expect(screen.getByText("By title")).toBeInTheDocument();
        expect(screen.getByText("By label")).toBeInTheDocument();
        expect(screen.getByText("EXT-1")).toBeInTheDocument();
        expect(screen.getByText("Item 4")).toBeInTheDocument();
    });

    it("caps the list at twelve rows while counting them all", () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({ name: `Row ${i + 1}` }));
        surface({ type: "ontology_objects", data: rows });

        expect(screen.getByText("Row 12")).toBeInTheDocument();
        expect(screen.queryByText("Row 13")).not.toBeInTheDocument();
        // The badge reports the real total, so the cap does not misreport the data.
        expect(screen.getByText("20 items")).toBeInTheDocument();
    });

    it("flags a partial result instead of presenting it as complete", () => {
        surface({ type: "ontology_traversal", data: { objects: [{ name: "A" }], complete: false } });
        expect(screen.getByText(/partial result/i)).toBeInTheDocument();
    });

    it("does not flag a complete result", () => {
        surface({ type: "ontology_traversal", data: { objects: [{ name: "A" }], complete: true } });
        expect(screen.queryByText(/partial result/i)).not.toBeInTheDocument();
    });

    it("names the relationship a traversal followed", () => {
        surface({
            type: "ontology_traversal",
            data: {
                objects: [{ name: "A" }],
                link: { sourceType: "Account", name: "owns", targetType: "Asset" },
            },
        });

        const header = screen.getByTestId("ontology-unit-surface");
        expect(header.textContent).toContain("Account");
        expect(header.textContent).toContain("owns");
        expect(header.textContent).toContain("Asset");
    });

    it("calls an untyped target polymorphic rather than leaving it blank", () => {
        surface({
            type: "ontology_traversal",
            data: { objects: [{ name: "A" }], link: { sourceType: "Account", name: "relates" } },
        });

        expect(screen.getByTestId("ontology-unit-surface").textContent).toContain("polymorphic");
    });
});
