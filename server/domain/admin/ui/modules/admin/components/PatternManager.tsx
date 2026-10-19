import React, { useState, useCallback, useRef } from 'react';
import { Package, Download, Upload, Trash2, Search, Filter, Check, X, AlertCircle, FileJson } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@domain-ui/core/ui/components/ui/dialog';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface ExportedPattern {
    id: string;
    category: string;
    name: string;
    triggers: Array<{ type: string; value: string | number }>;
    diagnosis: { summary: string; explanation?: string };
    fixes: Array<{ id: string; description: string }>;
    stats?: { timesUsed: number };
}

interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    errors: string[];
    patterns: Array<{ id: string; name: string; status: 'imported' | 'skipped' | 'error' }>;
}

interface PatternManagerProps {
    patterns: ExportedPattern[];
    onRefresh: () => void;
    loading?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
    auth: 'bg-red-100 text-red-700',
    rate_limit: 'bg-orange-100 text-orange-700',
    server_error: 'bg-muted text-foreground',
    timeout: 'bg-yellow-100 text-yellow-700',
    network: 'bg-blue-100 text-blue-700',
    deprecated: 'bg-purple-100 text-purple-700',
    permission: 'bg-pink-100 text-pink-700',
    not_found: 'bg-amber-100 text-amber-700',
    unknown: 'bg-muted text-muted-foreground',
};

export function PatternManager({
    patterns,
    onRefresh,
    loading = false,
}: PatternManagerProps) {
    const [search, setSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    // Filter patterns
    const filteredPatterns = patterns.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase()) ||
        p.diagnosis.summary.toLowerCase().includes(search.toLowerCase())
    );

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        if (selectedIds.size === filteredPatterns.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredPatterns.map(p => p.id)));
        }
    }, [filteredPatterns, selectedIds]);

    const handleExport = useCallback(async () => {
        try {
            const response = await apiRequest('POST', '/api/patterns/export', {
                patternIds: selectedIds.size > 0 ? Array.from(selectedIds) : undefined,
            }) as unknown as { version: string; patterns: ExportedPattern[] };

            // Create and download file
            const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `error-patterns-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({
                title: 'Export Complete',
                description: `Exported ${response.patterns.length} patterns`,
            });
        } catch (err: any) {
            toast({ title: 'Export failed', description: err.message, variant: 'destructive' });
        }
    }, [selectedIds, toast]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImporting(true);
        setImportDialogOpen(true);
        setImportResult(null);

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            const result = await apiRequest('POST', '/api/patterns/import', {
                data,
                overwriteExisting: false,
            }) as unknown as ImportResult;

            setImportResult(result);

            if (result.success && result.imported > 0) {
                onRefresh();
            }
        } catch (err: any) {
            setImportResult({
                success: false,
                imported: 0,
                skipped: 0,
                errors: [err.message],
                patterns: [],
            });
        } finally {
            setImporting(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }, [onRefresh]);

    const handleDelete = useCallback(async (patternId: string) => {
        try {
            await apiRequest('DELETE', `/api/patterns/${patternId}`);
            toast({ title: 'Pattern deleted' });
            onRefresh();
        } catch (err: any) {
            toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
        }
    }, [onRefresh, toast]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Package className="h-5 w-5 text-indigo-600" />
                        Error Patterns
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Manage built-in and custom error patterns
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleImportClick}>
                        <Upload className="h-4 w-4 mr-1" />
                        Import
                    </Button>
                    <Button size="sm" onClick={handleExport}>
                        <Download className="h-4 w-4 mr-1" />
                        Export {selectedIds.size > 0 ? `(${selectedIds.size})` : 'All'}
                    </Button>
                </div>
            </div>

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleFileChange}
            />

            {/* Search & Select All */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search patterns..."
                        className="pl-8"
                    />
                </div>
                <Button variant="outline" size="sm" onClick={selectAll}>
                    {selectedIds.size === filteredPatterns.length ? 'Deselect All' : 'Select All'}
                </Button>
            </div>

            {/* Patterns Grid */}
            <div className="grid gap-3">
                {filteredPatterns.map((pattern) => (
                    <Card
                        key={pattern.id}
                        className={cn(
                            "border transition-colors cursor-pointer",
                            selectedIds.has(pattern.id) && "border-indigo-400 bg-indigo-50/30"
                        )}
                        onClick={() => toggleSelect(pattern.id)}
                    >
                        <CardContent className="py-3 px-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <Checkbox
                                        checked={selectedIds.has(pattern.id)}
                                        onCheckedChange={() => toggleSelect(pattern.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-medium text-sm">{pattern.name}</h3>
                                            <Badge
                                                variant="outline"
                                                className={cn("text-xs", CATEGORY_COLORS[pattern.category] || CATEGORY_COLORS.unknown)}
                                            >
                                                {pattern.category}
                                            </Badge>
                                            {pattern.id.startsWith('discovered-') && (
                                                <Badge variant="secondary" className="text-xs">Custom</Badge>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {pattern.diagnosis.summary}
                                        </p>
                                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                                            <span>{pattern.triggers.length} triggers</span>
                                            <span>{pattern.fixes.length} fixes</span>
                                            {pattern.stats && <span>Used {pattern.stats.timesUsed}x</span>}
                                        </div>
                                    </div>
                                </div>
                                {pattern.id.startsWith('discovered-') && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(pattern.id);
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {filteredPatterns.length === 0 && (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center">
                        <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <p className="text-sm text-muted-foreground">
                            {search ? 'No patterns match your search' : 'No patterns available'}
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Import Result Dialog */}
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileJson className="h-5 w-5" />
                            Import Patterns
                        </DialogTitle>
                    </DialogHeader>

                    {importing ? (
                        <div className="py-8 text-center text-muted-foreground">
                            Importing patterns...
                        </div>
                    ) : importResult ? (
                        <div className="space-y-4">
                            {/* Summary */}
                            <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-green-600">{importResult.imported}</div>
                                    <div className="text-xs text-muted-foreground">Imported</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-muted-foreground">{importResult.skipped}</div>
                                    <div className="text-xs text-muted-foreground">Skipped</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-red-600">{importResult.errors.length}</div>
                                    <div className="text-xs text-muted-foreground">Errors</div>
                                </div>
                            </div>

                            {/* Pattern results */}
                            {importResult.patterns.length > 0 && (
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                    {importResult.patterns.map((p, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm">
                                            {p.status === 'imported' && <Check className="h-4 w-4 text-green-600" />}
                                            {p.status === 'skipped' && <X className="h-4 w-4 text-muted-foreground" />}
                                            {p.status === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
                                            <span className={cn(
                                                p.status === 'skipped' && 'text-muted-foreground',
                                                p.status === 'error' && 'text-red-600'
                                            )}>
                                                {p.name}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Errors */}
                            {importResult.errors.length > 0 && (
                                <div className="p-3 bg-red-50 rounded-lg">
                                    <h4 className="text-sm font-medium text-red-800 mb-1">Errors:</h4>
                                    <ul className="text-xs text-red-700 list-disc list-inside">
                                        {importResult.errors.map((err, i) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button onClick={() => setImportDialogOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default PatternManager;

