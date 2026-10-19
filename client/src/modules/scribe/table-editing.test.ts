import { describe, it, expect, beforeEach } from "vitest";
import TurndownService from "turndown";
import { addRowBelow, addColumnAfter, deleteRow, deleteColumn, findCellFromSelection } from "./table-editing";

/**
 * The operations are only correct if the result still round-trips, so these
 * assert the markdown as well as the DOM: a table that loses its rectangle stops
 * being a table in GFM rather than rendering raggedly, and the author would see
 * it collapse on the next save.
 */
const TABLE = `
<table>
  <thead><tr><th>Name</th><th>Qty</th></tr></thead>
  <tbody>
    <tr><td>Milk</td><td>1</td></tr>
    <tr><td>Eggs</td><td>12</td></tr>
  </tbody>
</table>`;

/** The canvas's own rule, so the assertions track what the editor really saves. */
function toMarkdown(table: HTMLTableElement): string {
    const td = new TurndownService();
    td.addRule("table", {
        filter: "table",
        replacement: (_content, node) => {
            const t = node as HTMLTableElement;
            const rows = Array.from(t.rows);
            if (!rows.length) return "";
            return (
                "\n\n" +
                rows
                    .map((row, i) => {
                        const cells = Array.from(row.cells).map((c) => c.textContent?.trim() || "");
                        const rowStr = "| " + cells.join(" | ") + " |";
                        return i === 0 ? rowStr + "\n| " + cells.map(() => "---").join(" | ") + " |" : rowStr;
                    })
                    .join("\n") +
                "\n\n"
            );
        },
    });
    return td.turndown(table.outerHTML).trim();
}

/** Widths of every row, which must stay uniform for GFM to keep the table. */
function widths(table: HTMLTableElement): number[] {
    return Array.from(table.rows).map((r) => r.cells.length);
}

let root: HTMLDivElement;
let table: HTMLTableElement;

beforeEach(() => {
    document.body.innerHTML = `<div id="root">${TABLE}</div>`;
    root = document.getElementById("root") as HTMLDivElement;
    table = root.querySelector("table") as HTMLTableElement;
});

describe("addRowBelow", () => {
    it("adds a row under the caret's row at the same width", () => {
        const milk = table.querySelectorAll("td")[0] as HTMLTableCellElement;
        expect(addRowBelow(milk)).toBe(true);

        expect(widths(table)).toEqual([2, 2, 2, 2]);
        const md = toMarkdown(table);
        expect(md.split("\n")[3]).toBe("|  |  |");
        expect(md).toContain("| Eggs | 12 |");
    });

    it("puts a row added from the header at the top of the body, not in the head", () => {
        const header = table.querySelector("th") as HTMLTableCellElement;
        addRowBelow(header);

        // GFM allows exactly one header row; a second would read as data anyway.
        expect(table.tHead?.rows.length).toBe(1);
        expect(table.tBodies[0].rows.length).toBe(3);
        expect(toMarkdown(table).split("\n")[1]).toBe("| --- | --- |");
    });
});

describe("addColumnAfter", () => {
    it("adds the column to every row so the table stays rectangular", () => {
        const qty = table.querySelectorAll("th")[1] as HTMLTableCellElement;
        expect(addColumnAfter(qty)).toBe(true);

        expect(widths(table)).toEqual([3, 3, 3]);
        const md = toMarkdown(table);
        expect(md).toContain("| Name | Qty |  |");
        expect(md).toContain("| --- | --- | --- |");
        expect(md).toContain("| Milk | 1 |  |");
    });

    it("adds a header cell in the header row and a data cell below it", () => {
        const name = table.querySelector("th") as HTMLTableCellElement;
        addColumnAfter(name);

        expect(table.tHead?.rows[0].cells[1].tagName).toBe("TH");
        expect(table.tBodies[0].rows[0].cells[1].tagName).toBe("TD");
    });
});

describe("deleteRow", () => {
    it("removes just that row", () => {
        const eggs = table.querySelectorAll("td")[2] as HTMLTableCellElement;
        expect(deleteRow(eggs)).toBe("row");

        expect(widths(table)).toEqual([2, 2]);
        expect(toMarkdown(table)).not.toContain("Eggs");
        expect(toMarkdown(table)).toContain("| Milk | 1 |");
    });

    it("removes the table when the last row goes, rather than leaving an empty one", () => {
        // An empty <table> turndowns to nothing, so it would linger invisibly.
        const cells = () => table.querySelectorAll("td, th");
        deleteRow(cells()[2] as HTMLTableCellElement);
        deleteRow(cells()[2] as HTMLTableCellElement);
        expect(deleteRow(cells()[0] as HTMLTableCellElement)).toBe("table");
        expect(root.querySelector("table")).toBeNull();
    });
});

describe("deleteColumn", () => {
    it("removes the column from every row", () => {
        const qty = table.querySelectorAll("th")[1] as HTMLTableCellElement;
        expect(deleteColumn(qty)).toBe("column");

        expect(widths(table)).toEqual([1, 1, 1]);
        const md = toMarkdown(table);
        expect(md).toContain("| Name |");
        expect(md).not.toContain("Qty");
        expect(md).not.toContain("| 12 |");
    });

    it("removes the table when the last column goes", () => {
        deleteColumn(table.querySelectorAll("th")[1] as HTMLTableCellElement);
        expect(deleteColumn(table.querySelector("th") as HTMLTableCellElement)).toBe("table");
        expect(root.querySelector("table")).toBeNull();
    });
});

describe("findCellFromSelection", () => {
    it("returns null when nothing is selected", () => {
        window.getSelection()?.removeAllRanges();
        expect(findCellFromSelection(root)).toBeNull();
    });

    it("finds the cell the caret sits in", () => {
        const milk = table.querySelectorAll("td")[0] as HTMLTableCellElement;
        const range = document.createRange();
        range.selectNodeContents(milk);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        expect(findCellFromSelection(root)).toBe(milk);
    });

    it("ignores a table outside the editor root", () => {
        // The ribbon must not edit the transcript or another station.
        document.body.insertAdjacentHTML("beforeend", '<div id="other"><table><tr><td>X</td></tr></table></div>');
        const outside = document.querySelector("#other td") as HTMLTableCellElement;
        const range = document.createRange();
        range.selectNodeContents(outside);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        expect(findCellFromSelection(root)).toBeNull();
    });
});
