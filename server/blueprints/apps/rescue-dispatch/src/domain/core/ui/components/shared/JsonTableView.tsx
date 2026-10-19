
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";

export function JsonTableView({ data }: { data: any }) {
    if (Array.isArray(data)) {
        if (data.length === 0) return <div className="p-2 text-xs text-muted-foreground">Empty Array</div>;

        // Get all unique keys from first few items to build headers
        const keys = Array.from(new Set(data.slice(0, 5).flatMap(obj =>
            typeof obj === 'object' && obj !== null ? Object.keys(obj) : []
        )));

        if (keys.length === 0) {
            // Array of primitives
            return (
                <div className="p-2 text-xs font-mono bg-muted/10 rounded">
                    {JSON.stringify(data, null, 2)}
                </div>
            );
        }

        return (
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {keys.map(k => <TableHead key={k} className="h-8 text-xs">{k}</TableHead>)}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((row, i) => (
                            <TableRow key={i} className="hover:bg-muted/5">
                                {keys.map(k => (
                                    <TableCell key={k} className="py-2 text-xs max-w-[200px] truncate font-mono" title={typeof row[k] === 'object' ? JSON.stringify(row[k]) : String(row[k])}>
                                        {typeof row[k] === 'object' ? (
                                            <span className="text-muted-foreground">{'{...}'}</span>
                                        ) : (
                                            String(row[k] ?? '')
                                        )}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        );
    }

    if (typeof data === 'object' && data !== null) {
        return (
            <Table>
                <TableBody>
                    {Object.entries(data).map(([k, v]) => (
                        <TableRow key={k} className="hover:bg-muted/5 border-b-0">
                            <TableCell className="py-1.5 text-xs font-medium w-1/3 text-muted-foreground bg-muted/20">{k}</TableCell>
                            <TableCell className="py-1.5 text-xs font-mono break-all">
                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        );
    }

    return <pre className="text-xs">{JSON.stringify(data, null, 2)}</pre>;
}
