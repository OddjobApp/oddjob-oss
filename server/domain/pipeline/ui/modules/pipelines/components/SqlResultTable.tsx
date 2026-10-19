
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Copy } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export function SqlResultTable({ data }: { data: any }) {
    const { toast } = useToast();
    let rows: any[] = [];

    // Parse data if string
    let parsedData = data;
    if (typeof data === 'string') {
        try {
            parsedData = JSON.parse(data);
        } catch {
            return <div className="p-4 text-destructive">Invalid JSON format</div>;
        }
    }

    if (Array.isArray(parsedData)) {
        rows = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
        // Handle single object response (rare for SQL but possible)
        // Or maybe raw Postgres response format
        if (parsedData.rows && Array.isArray(parsedData.rows)) {
            rows = parsedData.rows;
        } else {
            rows = [parsedData];
        }
    }

    if (rows.length === 0) return <div className="p-4 text-center text-muted-foreground">No records returned.</div>;

    const columns = Object.keys(rows[0]);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
        toast({ description: "Copied to clipboard" });
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Results Table</h4>
                <Button variant="ghost" size="sm" onClick={copyToClipboard}>
                    <Copy className="h-3 w-3 mr-2" />
                    Copy JSON
                </Button>
            </div>
            <div className="border rounded-md">
                <ScrollArea className="h-[400px]">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {columns.map((col) => (
                                    <TableHead key={col} className="bg-muted/50 sticky top-0 font-bold whitespace-nowrap">
                                        {col}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row, i) => (
                                <TableRow key={i} className="hover:bg-muted/20">
                                    {columns.map((col) => (
                                        <TableCell key={`${i}-${col}`} className="whitespace-nowrap max-w-[300px] truncate" title={String(row[col])}>
                                            {row[col] === null ? <span className="text-muted-foreground italic">null</span> :
                                                typeof row[col] === 'object' ? JSON.stringify(row[col]) :
                                                    String(row[col])}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
                <div className="p-2 bg-muted/50 border-t text-xs text-muted-foreground flex justify-between">
                    <span>{columns.length} columns</span>
                    <span>{rows.length} rows</span>
                </div>
            </div>
        </div>
    );
}

