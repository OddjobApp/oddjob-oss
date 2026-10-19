
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import {
    Loader2,
    Save,
    AlertCircle,
    CheckCircle2,
    Undo,
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Type,
    Hash,
    Check,
    Calendar,
    AlertTriangle
} from "lucide-react";
import { DatasetItem, DatasetValidationRules } from "@shared/schema/datasets";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";

interface DatasetSpreadsheetProps {
    datasetId: number;
    validationRules?: DatasetValidationRules;
}

// Client-side validation helper
function validateCell(value: any, fieldRules: any[]): string | null {
    if (!fieldRules || fieldRules.length === 0) return null;

    for (const rule of fieldRules) {
        if ((value === undefined || value === null || value === '') && rule.type !== 'required') {
            continue;
        }

        switch (rule.type) {
            case 'required':
                if (value === undefined || value === null || value === '') return rule.message || "Required";
                break;
            case 'regex':
                if (rule.params?.pattern && !new RegExp(rule.params.pattern).test(String(value))) {
                    return rule.message || "Invalid format";
                }
                break;
            case 'number_range':
                const num = Number(value);
                if (isNaN(num)) return "Must be a number";
                if (rule.params?.min !== undefined && num < rule.params.min) return rule.message || `Min ${rule.params.min}`;
                if (rule.params?.max !== undefined && num > rule.params.max) return rule.message || `Max ${rule.params.max}`;
                break;
            case 'email':
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return rule.message || "Invalid email";
                break;
            case 'url':
                try {
                    new URL(String(value));
                } catch {
                    return rule.message || "Invalid URL";
                }
                break;
            case 'enum':
                if (Array.isArray(rule.params?.values) && !rule.params.values.includes(value)) {
                    return rule.message || `Must be one of: ${rule.params.values.join(', ')}`;
                }
                break;
        }
    }
    return null;
}

export function DatasetSpreadsheet({ datasetId, validationRules }: DatasetSpreadsheetProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [edits, setEdits] = useState<Record<number, Record<string, any>>>({}); // itemId -> field -> value
    const [localData, setLocalData] = useState<DatasetItem[]>([]);

    // Fetch Data
    const { data, isLoading } = useQuery<{ items: DatasetItem[], total: number }>({
        queryKey: [`/api/datasets/${datasetId}/items`, page, pageSize],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/datasets/${datasetId}/items?page=${page}&limit=${pageSize}`);
            return res.json();
        }
    });

    // Sync local data when fetched
    useEffect(() => {
        if (data?.items) {
            setLocalData(data.items);
            // Clear edits for this page (or keep them if we want to persist across pages? complicated)
            // For safety, warn if unsaved changes when changing page?
            // For now, simple approach: edits are cleared on page change if not saved.
            setEdits({});
        }
    }, [data]);

    // Fetch Keys
    const { data: keys = [] } = useQuery<{ key: string; type: string }[]>({
        queryKey: [`/api/datasets/${datasetId}/keys`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/datasets/${datasetId}/keys`);
            return res.json();
        }
    });

    const handleCellChange = (itemId: number, key: string, value: string) => {
        setEdits(prev => ({
            ...prev,
            [itemId]: {
                ...(prev[itemId] || {}),
                [key]: value
            }
        }));
    };

    const hasChanges = Object.keys(edits).length > 0;

    const saveMutation = useMutation({
        mutationFn: async () => {
            const updates = edits;
            const res = await apiRequest("PATCH", `/api/datasets/${datasetId}/records`, { updates });
            return res.json();
        },
        onSuccess: (data) => {
            toast({ title: "Saved Changes", description: `Updated ${data.updated} records` });
            setEdits({});
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/items`] });
        },
        onError: (err: any) => {
            toast({ title: "Save Failed", description: err.message, variant: "destructive" });
        }
    });

    const totalPages = data ? Math.ceil(data.total / pageSize) : 1;

    // Helper to get current value (edited or original)
    const getValue = (item: DatasetItem, key: string) => {
        if (edits[item.id] && edits[item.id][key] !== undefined) {
            return edits[item.id][key];
        }
        return (item.data as any)[key] ?? "";
    };

    const getValidationError = (item: DatasetItem, key: string) => {
        if (!validationRules || !validationRules[key]) return null;
        const val = getValue(item, key);
        return validateCell(val, validationRules[key]);
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center bg-muted/30 p-2 rounded-lg border">
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Spreadsheet Mode
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                        {Object.keys(edits).length} pending edits
                    </span>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEdits({})}
                        disabled={!hasChanges}
                    >
                        <Undo className="w-4 h-4 mr-2" /> Discard
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => saveMutation.mutate()}
                        disabled={!hasChanges || saveMutation.isPending}
                    >
                        {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            <div className="rounded-md border overflow-x-auto bg-background">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead className="w-[50px]">ID</TableHead>
                            {keys.map(k => (
                                <TableHead key={k.key} className="min-w-[150px]">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1 font-semibold text-foreground">
                                            {k.key}
                                            {validationRules?.[k.key] && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger>
                                                            <div className="h-2 w-2 rounded-full bg-blue-500" />
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p className="text-xs">Has validation rules</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                        <span className="text-[10px] uppercase text-muted-foreground font-mono">{k.type}</span>
                                    </div>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={keys.length + 1} className="h-32 text-center text-muted-foreground">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                    Loading data...
                                </TableCell>
                            </TableRow>
                        ) : localData.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={keys.length + 1} className="h-24 text-center">No items found</TableCell>
                            </TableRow>
                        ) : (
                            localData.map(item => {
                                const hasEdits = !!edits[item.id];
                                 return (
                                     <TableRow key={item.id} className={hasEdits ? "bg-primary/5" : ""}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{item.id}</TableCell>
                                        {keys.map(k => {
                                            const error = getValidationError(item, k.key);
                                            const isEdited = edits[item.id]?.[k.key] !== undefined;
                                            return (
                                                <TableCell key={k.key} className="p-1 relative group">
                                                    <div className="relative">
                                                         <Input
                                                             className={`h-8 text-xs px-2 border-transparent bg-transparent group-hover:bg-muted/50 group-hover:border-input focus:bg-background focus:border-ring transition-colors ${error ? 'pr-8 border-destructive/50 bg-destructive/5 focus:border-destructive' : ''} ${isEdited ? 'font-medium text-primary' : ''}`}
                                                             value={getValue(item, k.key)}
                                                             onChange={(e) => handleCellChange(item.id, k.key, e.target.value)}
                                                         />
                                                        {error && (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500">
                                                                            <AlertTriangle className="h-3 w-3" />
                                                                        </div>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top">
                                                                        <p className="text-xs font-semibold text-red-500">{error}</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            );
                                        })}
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                </div>
                <div className="space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                    >
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

