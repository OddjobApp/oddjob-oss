"use client"

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@domain-ui/core/ui/components/ui/table";

export interface Column<T = any> {
  header: string;
  accessorKey?: string;
  key?: string; // alias for accessorKey
  cell?: (row: T) => React.ReactNode;
  render?: (row: T) => React.ReactNode; // alias for cell
}

interface DataTableProps<T = any> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
}

export function DataTable<T = any>({
  columns,
  data,
  isLoading,
  searchPlaceholder,
  searchKeys
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = React.useState("");

  const filteredData = React.useMemo(() => {
    if (!searchQuery || !searchKeys || searchKeys.length === 0) {
      return data;
    }

    return data.filter((item) => {
      return searchKeys.some((key) => {
        const value = (item as any)[key];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(searchQuery.toLowerCase());
      });
    });
  }, [data, searchQuery, searchKeys]);

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-4">
      {searchPlaceholder && (
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            className="pl-8 max-w-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}
      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={index} className="h-10">
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {columns.map((column, colIndex) => (
                    <TableCell key={colIndex}>
                      {column.cell
                        ? column.cell(row)
                        : column.render
                          ? column.render(row)
                          : (column.accessorKey || column.key)
                            ? (row as any)[(column.accessorKey || column.key) as string]
                            : null}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

