/**
 * Row and column editing for tables in the Living Document Canvas.
 *
 * The ribbon could only ever insert a whole new table, so an author who wanted
 * one more row had no control that did it — clicking "Insert Table" inside an
 * existing table nests a second one, and a nested table cannot survive the save
 * at all: the manuscript is stored as markdown, GFM has no nested-table syntax,
 * and createTurndownService reads each cell with textContent, so an inner table
 * collapses into the concatenated text of its cells. These operate on the table
 * the caret is already in instead.
 *
 * Every operation keeps the grid rectangular. The turndown rule builds the GFM
 * header separator from the width of row 0, so a row that is one cell short or
 * long does not render as a ragged table — it stops being a table.
 */

/** The editor's own cell styling, so an added cell is not visibly different. */
const CELL_CLASS = "border border-border px-3 py-2 text-foreground";
const HEADER_CELL_CLASS = "border border-border px-3 py-2 font-semibold text-foreground";

/**
 * The table cell containing the caret, or null when it is not in one.
 *
 * Confined to `root` so a selection elsewhere on the page — another station, the
 * chat transcript — cannot be edited through the canvas ribbon.
 */
export function findCellFromSelection(root: HTMLElement | null): HTMLTableCellElement | null {
    if (!root || typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const anchor = selection.anchorNode;
    if (!anchor || !root.contains(anchor)) return null;

    const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    const cell = element?.closest("td, th") ?? null;
    // closest() escapes the editor if the caret sits in a table outside it.
    return cell && root.contains(cell) ? (cell as HTMLTableCellElement) : null;
}

/** The table a cell belongs to, ignoring any table that merely contains it. */
function ownerTable(cell: HTMLTableCellElement): HTMLTableElement | null {
    return cell.closest("table");
}

/** Column index counted in cells, which is what the markdown rule also counts. */
function columnIndexOf(cell: HTMLTableCellElement): number {
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return -1;
    return Array.from(row.cells).indexOf(cell);
}

/** Every row of this table, excluding rows belonging to a nested one. */
function ownRows(table: HTMLTableElement): HTMLTableRowElement[] {
    return Array.from(table.rows).filter((r) => r.closest("table") === table);
}

function makeCell(header: boolean, text = ""): HTMLTableCellElement {
    const cell = document.createElement(header ? "th" : "td");
    cell.className = header ? HEADER_CELL_CLASS : CELL_CLASS;
    cell.textContent = text;
    return cell;
}

/**
 * Insert an empty row directly below the caret's row.
 *
 * A new row is always a body row even when the caret is in the header, because
 * GFM allows exactly one header row: a second would be read as data anyway.
 */
export function addRowBelow(cell: HTMLTableCellElement): boolean {
    const table = ownerTable(cell);
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!table || !row) return false;

    const width = row.cells.length;
    const newRow = document.createElement("tr");
    for (let i = 0; i < width; i++) newRow.appendChild(makeCell(false));

    if (row.parentElement?.tagName === "THEAD") {
        // Below the header means the top of the body, not inside the head.
        const body = table.tBodies[0] ?? table.appendChild(document.createElement("tbody"));
        body.insertBefore(newRow, body.firstChild);
    } else {
        row.parentElement?.insertBefore(newRow, row.nextSibling);
    }
    return true;
}

/**
 * Insert an empty column directly right of the caret's column.
 *
 * Applied to every row, header included, or the table stops being rectangular.
 */
export function addColumnAfter(cell: HTMLTableCellElement): boolean {
    const table = ownerTable(cell);
    const index = columnIndexOf(cell);
    if (!table || index < 0) return false;

    for (const row of ownRows(table)) {
        const isHeaderRow = row.parentElement?.tagName === "THEAD" || row.cells[0]?.tagName === "TH";
        const newCell = makeCell(isHeaderRow);
        // A short row still gets a cell, appended, rather than being skipped.
        const reference = row.cells[index] ?? null;
        if (reference) row.insertBefore(newCell, reference.nextSibling);
        else row.appendChild(newCell);
    }
    return true;
}

/**
 * Remove the caret's row.
 *
 * Removing the last remaining row would leave an empty <table> that turndown
 * renders as nothing, so the table itself goes instead — the visible result an
 * author deleting the final row is asking for.
 */
export function deleteRow(cell: HTMLTableCellElement): "row" | "table" | null {
    const table = ownerTable(cell);
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!table || !row) return null;

    if (ownRows(table).length <= 1) {
        table.remove();
        return "table";
    }
    row.remove();
    return "row";
}

/**
 * Remove the caret's column from every row.
 *
 * Removing the last column removes the table, for the same reason as the last row.
 */
export function deleteColumn(cell: HTMLTableCellElement): "column" | "table" | null {
    const table = ownerTable(cell);
    const index = columnIndexOf(cell);
    if (!table || index < 0) return null;

    const rows = ownRows(table);
    const width = Math.max(...rows.map((r) => r.cells.length));
    if (width <= 1) {
        table.remove();
        return "table";
    }
    for (const row of rows) row.cells[index]?.remove();
    return "column";
}
