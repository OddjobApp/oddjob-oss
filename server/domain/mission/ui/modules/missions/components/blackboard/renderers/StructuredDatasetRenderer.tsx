import React, { useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import type { RendererProps } from "../registry";

const PAGE_SIZE = 20;

function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
    return rows.slice(0, 10).every(r => r[col] === null || r[col] === undefined || typeof r[col] === "number");
}

export function StructuredDatasetRenderer({ label, displayLabel, value, classification }: RendererProps) {
    const [showAll, setShowAll] = useState(false);
    const rows = Array.isArray(value) ? value as Record<string, unknown>[] : [];
    const columns = classification.metadata.columnNames ?? Object.keys(rows[0] ?? {});
    const visible = showAll ? rows : rows.slice(0, PAGE_SIZE);
    const numericCols = new Set(columns.filter(c => isNumericColumn(rows, c)));

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LayoutGrid className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">
                        {displayLabel || label}
                    </span>
                </div>
                <Badge variant="outline" className="text-[9px] h-4 border-violet-400/30 text-violet-400">
                    {rows.length} row{rows.length !== 1 ? "s" : ""} × {columns.length} col{columns.length !== 1 ? "s" : ""}
                </Badge>
            </div>

            <div className="rounded-lg border border-border overflow-hidden max-h-[360px] overflow-y-auto scrollbar-thin scrollbar-thumb-violet-500/20">
                <Table>
                    <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                            {columns.map(col => (
                                <TableHead
                                    key={col}
                                    className={`text-[9px] uppercase font-bold tracking-wider text-muted-foreground py-2 px-3 bg-muted/30 whitespace-nowrap ${numericCols.has(col) ? "text-right" : ""}`}
                                >
                                    {col}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {visible.map((row, i) => (
                            <TableRow key={i} className="border-border/50 hover:bg-muted/20">
                                {columns.map(col => {
                                    const val = row[col];
                                    const display = val === null || val === undefined ? "—" : String(val);
                                    return (
                                        <TableCell
                                            key={col}
                                            className={`text-[11px] font-mono py-1.5 px-3 max-w-[150px] truncate ${numericCols.has(col) ? "text-right text-green-400/80" : "text-foreground/80"}`}
                                            title={display}
                                        >
                                            {display}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {rows.length > PAGE_SIZE && (
                <div className="flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground">
                        Showing {showAll ? rows.length : PAGE_SIZE} of {rows.length} rows
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] text-muted-foreground hover:text-violet-400"
                        onClick={() => setShowAll(s => !s)}
                    >
                        {showAll ? "Show fewer" : "Show all"}
                    </Button>
                </div>
            )}
        </div>
    );
}
