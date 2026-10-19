
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SchemaMappingEditor, SchemaColumn } from '../shared/SchemaMappingEditor.js';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import {
    ChevronLeft,
    ChevronRight,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Search,
    Trash2,
    Loader2,
    MoreHorizontal,
    Filter,
    Calendar,
    Type,
    Hash,
    Check,
    X,
    Download,
    Upload,
    Wand2,
} from "lucide-react";
import { format } from "date-fns";
import { DatasetItem } from "@shared/schema/datasets";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";


function getIconForType(type: string) {
    switch (type) {
        case 'string': return <Type className="h-3.5 w-3.5 text-indigo-400/70" />;
        case 'number': return <Hash className="h-3.5 w-3.5 text-indigo-400/70" />;
        case 'boolean': return <Check className="h-3.5 w-3.5 text-indigo-400/70" />;
        case 'date': return <Calendar className="h-3.5 w-3.5 text-indigo-400/70" />;
        default: return <Type className="h-3.5 w-3.5 text-indigo-400/70" />;
    }
}

function renderCell(item: any, key: string, type: string) {
    const value = item.data[key];
    if (value === undefined || value === null) return <span className="text-muted-foreground">NULL</span>;
    if (type === 'boolean') return value ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-rose-500" />;
    if (type === 'date') return <span className="text-foreground">{format(new Date(value), "MMM d, yyyy")}</span>;
    if (typeof value === 'object') return <span className="font-mono text-[10px] text-indigo-400 bg-indigo-500/5 px-1 rounded">{JSON.stringify(value).substring(0, 30)}...</span>;
    return <span className="truncate block max-w-[250px] text-foreground group-hover:text-foreground transition-colors" title={String(value)}>{String(value)}</span>;
}

interface DatasetTableProps {
    datasetId: number;
}

export function DatasetTable({ datasetId }: DatasetTableProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // State
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [sortBy, setSortBy] = useState<string>("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [filterField, setFilterField] = useState<string>("");
    const [filterValue, setFilterValue] = useState<string>("");
    const [searchInput, setSearchInput] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isDedupeOpen, setIsDedupeOpen] = useState(false);
    const [dedupeField, setDedupeField] = useState("");

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchInput.includes(":")) {
                const [f, v] = searchInput.split(":");
                setFilterField(f.trim());
                setFilterValue(v.trim());
            } else {
                if (!searchInput) {
                    setFilterField("");
                    setFilterValue("");
                }
            }
            setPage(1); 
        }, 500);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch Data
    const { data, isLoading } = useQuery<{ items: DatasetItem[], total: number }>({
        queryKey: [`/api/datasets/${datasetId}/items`, page, pageSize, sortBy, sortOrder, filterField, filterValue],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append("page", page.toString());
            params.append("limit", pageSize.toString());
            if (sortBy) params.append("sortBy", sortBy);
            if (sortOrder) params.append("sortOrder", sortOrder);
            if (filterField && filterValue) {
                params.append("filterField", filterField);
                params.append("filterValue", filterValue);
            }

            const res = await apiRequest("GET", `/api/datasets/${datasetId}/items?${params.toString()}`);
            return res.json();
        }
    });

    const totalPages = data ? Math.ceil(data.total / pageSize) : 1;

    // Handlers
    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
        } else {
            setSortBy(field);
            setSortOrder("desc"); 
        }
    };

    const toggleSelectAll = (checked: boolean) => {
        if (checked && data?.items) {
            const newSelected = new Set(selectedIds);
            data.items.forEach(item => newSelected.add(item.id));
            setSelectedIds(newSelected);
        } else if (!checked && data?.items) {
            const newSelected = new Set(selectedIds);
            data.items.forEach(item => newSelected.delete(item.id));
            setSelectedIds(newSelected);
        }
    };

    const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);

    const toggleSelect = (id: number, event?: React.MouseEvent) => {
        const newSelected = new Set(selectedIds);

        if (event?.shiftKey && lastSelectedId !== null && data?.items) {
            const items = data.items;
            const lastIndex = items.findIndex(i => i.id === lastSelectedId);
            const currIndex = items.findIndex(i => i.id === id);

            if (lastIndex !== -1 && currIndex !== -1) {
                const start = Math.min(lastIndex, currIndex);
                const end = Math.max(lastIndex, currIndex);

                for (let i = start; i <= end; i++) {
                    newSelected.add(items[i].id);
                }
            }
        } else {
            if (newSelected.has(id)) {
                newSelected.delete(id);
            } else {
                newSelected.add(id);
                setLastSelectedId(id);
            }
        }
        setSelectedIds(newSelected);
    };

    // Fetch Keys
    const { data: keys = [] } = useQuery<{ key: string; type: string; nullCount: number }[]>({
        queryKey: [`/api/datasets/${datasetId}/keys`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/datasets/${datasetId}/keys`);
            return res.json();
        }
    });

    const batchDeleteMutation = useMutation({
        mutationFn: async (ids: number[]) => {
            const res = await apiRequest("POST", `/api/datasets/${datasetId}/items/batch-delete`, { itemIds: ids });
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/items`] });
            setSelectedIds(new Set());
            toast({ title: "Success", description: `Deleted ${data.count} items` });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const handleBulkDelete = async () => {
        const ids = Array.from(selectedIds);
        if (!confirm(`Delete ${ids.length} items?`)) return;
        batchDeleteMutation.mutate(ids);
    };

    const dedupeMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/datasets/${datasetId}/deduplicate`, { field: dedupeField });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/items`] });
            setIsDedupeOpen(false);
            setDedupeField("");
            toast({ title: "Deduplication Complete", description: "Duplicates removed." });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const normalizeMutation = useMutation({
        mutationFn: async (columns: SchemaColumn[]) => {
            const res = await apiRequest("POST", `/api/datasets/${datasetId}/normalize`, { columns });
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/items`] });
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/keys`] });
            toast({ title: "Normalization Complete", description: `Updated ${data.count} items.` });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const fileInputRef = { current: null as HTMLInputElement | null };

    const importMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`/api/datasets/${datasetId}/import-csv`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Import failed');
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/items`] });
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${datasetId}/keys`] });
            toast({ title: "Import Complete", description: data.message || `Imported ${data.imported} rows.` });
        },
        onError: (err: any) => {
            toast({ title: "Import Failed", description: err.message, variant: "destructive" });
        }
    });

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            importMutation.mutate(file);
        }
        e.target.value = '';
    };

    return (
        <div className="w-full space-y-6 p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-2">
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
                        <div className="relative flex items-center bg-background/40 border border-foreground/5 rounded-xl px-3 py-1">
                            <Search className="h-4 w-4 text-muted-foreground mr-2" />
                            <Input
                                placeholder="Interrogate data..."
                                title="Interrogate data"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                className="border-none bg-transparent focus-visible:ring-0 text-foreground placeholder:text-muted-foreground w-[200px] h-8 text-xs font-mono"
                            />
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input type="file" accept=".csv" title="Upload CSV" placeholder="Upload CSV" aria-label="Upload CSV" onChange={handleFileSelect} ref={el => fileInputRef.current = el} className="hidden" />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importMutation.isPending}
                        className="rounded-xl bg-foreground/5 border border-foreground/5 hover:bg-foreground/10 text-foreground font-mono text-[10px] uppercase tracking-wider"
                    >
                        {importMutation.isPending ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Upload className="mr-2 h-3.5 w-3.5" />
                        )}
                        IMPORT CSV
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-xl bg-foreground/5 border border-foreground/5 hover:bg-foreground/10 text-foreground font-mono text-[10px] uppercase tracking-wider" onClick={() => {
                        const params = new URLSearchParams();
                        if (sortBy) params.append("sortBy", sortBy);
                        if (sortOrder) params.append("sortOrder", sortOrder);
                        if (filterField && filterValue) {
                            params.append("filterField", filterField);
                            params.append("filterValue", filterValue);
                        }
                        window.open(`/api/datasets/${datasetId}/export?${params.toString()}`, "_blank");
                    }}>
                        <Download className="mr-2 h-3.5 w-3.5" /> EXPORT CSV
                    </Button>

                    <SchemaMappingEditor
                        availableKeys={keys.map(k => k.key)}
                        sampleData={(data?.items?.[0] ? data.items[0].data : undefined) as Record<string, any> | undefined}
                        onSave={(result) => normalizeMutation.mutate(result.columns)}
                        trigger={
                            <Button variant="ghost" size="sm" className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 text-indigo-400 font-mono text-[10px] uppercase tracking-wider">
                                <Wand2 className="mr-2 h-3.5 w-3.5" /> NORMALIZE
                            </Button>
                        }
                    />

                    <Dialog open={isDedupeOpen} onOpenChange={setIsDedupeOpen}>
                        <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="rounded-xl bg-foreground/5 border border-foreground/5 hover:bg-foreground/10 text-foreground font-mono text-[10px] uppercase tracking-wider">
                                CLEAN DATA
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="glass-panel-deep border-foreground/10">
                            <DialogHeader>
                                <DialogTitle className="text-xl font-black text-foreground uppercase tracking-widest">Deduplication Mesh</DialogTitle>
                                <DialogDescription className="text-muted-foreground text-sm">
                                    Surgically remove duplicate nodes based on identity fields.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="py-6 space-y-4">
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest">Target Field Identifier</Label>
                                    <Input
                                        placeholder="e.g. 'externalId' or 'email'"
                                        value={dedupeField}
                                        onChange={(e) => setDedupeField(e.target.value)}
                                        className="bg-background/40 border-foreground/10 text-foreground focus:ring-indigo-500/50"
                                    />
                                </div>
                                <p className="text-[10px] text-muted-foreground font-mono uppercase leading-relaxed">
                                    System will prioritize original records. All subsequent duplicate entities will be purged from the active mesh.
                                </p>
                            </div>
                            <DialogFooter>
                                <Button onClick={() => dedupeMutation.mutate()} disabled={!dedupeField || dedupeMutation.isPending} className="w-full bg-indigo-600 hover:bg-indigo-500">
                                    {dedupeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    EXECUTE PURGE
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-3 ml-2 pl-4 border-l border-foreground/10">
                            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest leading-none">{selectedIds.size} NODES LOCKED</span>
                            <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={batchDeleteMutation.isPending} className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 rounded-xl px-4 py-0 h-8 font-mono text-[10px] uppercase">
                                {batchDeleteMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                <Trash2 className="mr-1.5 h-3 w-3" /> PURGE BATCH
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-foreground/5 bg-background/40 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-foreground/5 border-b border-foreground/5">
                            <TableRow className="hover:bg-transparent border-foreground/5">
                                <TableHead className="w-[50px] py-4 pl-6">
                                    <Checkbox
                                        checked={(data?.items.length || 0) > 0 && data?.items?.every(i => selectedIds.has(i.id))}
                                        onCheckedChange={(c) => toggleSelectAll(!!c)}
                                        className="border-foreground/20 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                                    />
                                </TableHead>
                                <TableHead className="w-[80px] py-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">SYS ID</TableHead>
                                <TableHead className="min-w-[120px] py-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">TIMESTAMP</TableHead>
                                {keys.map(k => (
                                    <TableHead key={k.key} className="min-w-[180px] py-4">
                                        <div className="flex items-center space-x-2 group">
                                            {getIconForType(k.type)}
                                            <span className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">{k.key}</span>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="glass-panel-deep border-foreground/10 backdrop-blur-3xl min-w-[180px]">
                                                    <DropdownMenuLabel className="text-[10px] font-mono text-muted-foreground uppercase px-3 pt-3">Field Control</DropdownMenuLabel>
                                                    <DropdownMenuSeparator className="bg-foreground/5" />
                                                    <DropdownMenuItem className="text-xs py-2 px-3 focus:bg-indigo-600 focus:text-foreground cursor-pointer" onClick={() => { setSortBy(k.key); setSortOrder("asc"); }}>
                                                        <ArrowUp className="mr-2 h-3.5 w-3.5 text-indigo-400" />
                                                        Sort Ascending
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-xs py-2 px-3 focus:bg-indigo-600 focus:text-foreground cursor-pointer" onClick={() => { setSortBy(k.key); setSortOrder("desc"); }}>
                                                        <ArrowDown className="mr-2 h-3.5 w-3.5 text-indigo-400" />
                                                        Sort Descending
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-foreground/5" />
                                                    <DropdownMenuItem className="text-xs py-2 px-3 focus:bg-indigo-600 focus:text-foreground cursor-pointer" onClick={() => { setFilterField(k.key); setSearchInput(`${k.key}:`); }}>
                                                        <Filter className="mr-2 h-3.5 w-3.5 text-indigo-400" />
                                                        Isolate Field
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            {sortBy === k.key && (
                                                sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-indigo-400" /> : <ArrowDown className="h-3 w-3 text-indigo-400" />
                                            )}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow className="hover:bg-transparent border-foreground/5">
                                    <TableCell colSpan={keys.length + 3} className="h-48 text-center">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                                            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.5em] animate-pulse">Scanning Records...</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : data?.items.length === 0 ? (
                                <TableRow className="hover:bg-transparent border-foreground/5">
                                    <TableCell colSpan={keys.length + 3} className="h-48 text-center">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <X className="h-10 w-10 text-foreground mb-2" />
                                            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Null Record Set Detected</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                data?.items.map(item => (
                                    <TableRow 
                                        key={item.id} 
                                        data-state={selectedIds.has(item.id) && "selected"}
                                        className="group border-foreground/5 hover:bg-foreground/5 transition-all cursor-default"
                                    >
                                        <TableCell className="pl-6 py-4">
                                            <Checkbox
                                                checked={selectedIds.has(item.id)}
                                                onCheckedChange={() => { /* Handled by parent click */ }}
                                                onClick={(e) => toggleSelect(item.id, e)}
                                                className="border-foreground/10 group-hover:border-foreground/30 transition-colors data-[state=checked]:bg-indigo-600"
                                            />
                                        </TableCell>
                                        <TableCell className="text-[10px] font-mono text-muted-foreground group-hover:text-muted-foreground transition-colors">{item.id}</TableCell>
                                        <TableCell className="text-[10px] font-mono text-muted-foreground group-hover:text-muted-foreground whitespace-nowrap transition-colors">
                                            {format(new Date(item.createdAt), "MM/dd HH:mm:ss")}
                                        </TableCell>
                                        {keys.map(k => (
                                            <TableCell key={k.key} className="py-4 font-normal text-sm">
                                                {renderCell(item, k.key, k.type)}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <div className="flex items-center justify-between py-6">
                <div className="flex items-center gap-4">
                    <div className="flex items-center bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mr-3">Page Index</span>
                        <span className="text-xs font-bold text-foreground">{page} <span className="text-muted-foreground mx-1">/</span> {totalPages}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Total Entities: {data?.total || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-foreground/10 text-muted-foreground disabled:opacity-20 transition-all font-mono text-[10px] uppercase"
                    >
                        <ChevronLeft className="h-4 w-4 mr-1.5" /> PREV
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-foreground/10 text-muted-foreground disabled:opacity-20 transition-all font-mono text-[10px] uppercase"
                    >
                        NEXT <ChevronRight className="h-4 w-4 ml-1.5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

