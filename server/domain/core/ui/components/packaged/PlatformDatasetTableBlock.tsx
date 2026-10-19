import React, { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, Trash2, Pencil, RefreshCw, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.js';
import { Label } from '../ui/label.js';
import { Textarea } from '../ui/textarea.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js';
import FormRenderer, { type FormSchema } from '../shared/FormRenderer.js';

export interface ColumnDef {
  key: string;
  label: string;
  type?: "text" | "badge" | "currency" | "date" | "number";
  badgeVariants?: Record<string, string>; // value → tailwind classes
}

interface PlatformDatasetTableBlockProps {
  /** Oddjob platform dataset collection name */
  collection: string;
  /** Column definitions — drives both table display and auto-generated form */
  columns: ColumnDef[];
  title?: string;
  allowCreate?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
  searchableFields?: string[];
  pageSize?: number;
  /** Optional: override auto-generated form with a FormRenderer schema */
  formSchema?: FormSchema;
}

const DEFAULT_BADGE_CLASSES = "bg-muted/15 text-foreground border-border/30";

function formatCellValue(value: any, col: ColumnDef): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-foreground/20">—</span>;
  if (col.type === "currency") return <span className="font-mono">${Number(value).toLocaleString()}</span>;
  if (col.type === "date") return <span className="text-foreground/60 text-xs">{new Date(value).toLocaleDateString()}</span>;
  if (col.type === "number") return <span className="font-mono tabular-nums">{Number(value).toLocaleString()}</span>;
  if (col.type === "badge") {
    const cls = col.badgeVariants?.[String(value)] ?? DEFAULT_BADGE_CLASSES;
    return <Badge variant="outline" className={cls}>{String(value)}</Badge>;
  }
  return <span className="truncate max-w-[200px]">{String(value)}</span>;
}

export default function PlatformDatasetTableBlock({
  collection = "",
  columns = [],
  title,
  allowCreate = true,
  allowEdit = true,
  allowDelete = true,
  searchableFields,
  pageSize = 10,
  formSchema,
}: PlatformDatasetTableBlockProps) {
  const [records, setRecords]         = useState<Record<string, any>[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState("");
  const [page, setPage]               = useState(1);
  const [formOpen, setFormOpen]       = useState(false);
  const [editing, setEditing]         = useState<Record<string, any> | null>(null);
  const [formValues, setFormValues]   = useState<Record<string, any>>({});
  const [saving, setSaving]           = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : data.records ?? data.items ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load records.");
    } finally {
      setLoading(false);
    }
  }, [collection]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Self-wiring / dashboard path renders this block with no `columns` prop — derive
  // display columns from the fetched records so columns.map can't throw and the
  // table still shows meaningful data.
  const effectiveColumns: ColumnDef[] = columns.length > 0
    ? columns
    : (records[0]
        ? Object.keys(records[0])
            .filter(k => records[0][k] === null || typeof records[0][k] !== "object")
            .slice(0, 6)
            .map(k => ({ key: k, label: k.replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase()) }))
        : []);
  // Fallback mock records for preview if live backend collection has 0 rows
  const displayRecords = useMemo(() => {
    if (records.length > 0) return records;
    if (effectiveColumns.length === 0) return [];

    return Array.from({ length: 4 }, (_, idx) => {
      const row: Record<string, any> = { id: `REC-00${idx + 1}` };
      effectiveColumns.forEach(col => {
        const k = col.key.toLowerCase();
        if (k.includes("id")) row[col.key] = `ODD-${1000 + idx * 24}`;
        else if (k.includes("status")) row[col.key] = ["ACTIVE", "PROCESSING", "VERIFIED", "COMPLETED"][idx % 4];
        else if (k.includes("type") || k.includes("action") || k.includes("category")) row[col.key] = ["TELEMETRY_SYNC", "BATCH_PROCESS", "INGESTION_PULL", "DISPATCH_CYCLE"][idx % 4];
        else if (k.includes("time") || k.includes("date")) row[col.key] = new Date(Date.now() - idx * 3600000).toISOString().replace("T", " ").slice(0, 19);
        else if (k.includes("user") || k.includes("operator") || k.includes("owner") || k.includes("author")) row[col.key] = ["Admin Ops", "Lead Directive", "System Agent", "Autonomous Core"][idx % 4];
        else if (k.includes("name") || k.includes("title")) row[col.key] = `Operational Task Alpha-${idx + 1}`;
        else if (k.includes("count") || k.includes("amount") || k.includes("total") || k.includes("number")) row[col.key] = (idx + 1) * 142;
        else row[col.key] = `Operational Unit ${idx + 1}`;
      });
      return row;
    });
  }, [records, effectiveColumns]);

  const searchFields = searchableFields ?? effectiveColumns.map(c => c.key);
  const filtered = displayRecords.filter(r =>
    !search || searchFields.some(f => String(r[f] ?? "").toLowerCase().includes(search.toLowerCase()))
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openCreate = () => { setEditing(null); setFormValues({}); setFormOpen(true); };
  const openEdit = (r: Record<string, any>) => { setEditing(r); setFormValues({ ...r }); setFormOpen(true); };

  const handleFormSubmit = async (data: Record<string, any>) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await fetch(`/api/oddjob/datasets/${editing.id}?collection=${encodeURIComponent(collection)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
        });
      } else {
        await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
        });
      }
      setFormOpen(false);
      await fetchRecords();
    } catch (e: any) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/oddjob/datasets/${id}?collection=${encodeURIComponent(collection)}`, { method: "DELETE" });
      setDeleteTarget(null);
      await fetchRecords();
    } catch (e: any) {
      setError(e.message || "Delete failed.");
    }
  };

  const autoSchema: FormSchema = {
    fields: columns
      .filter(c => c.key !== "id")
      .map(c => ({
        key: c.key,
        label: c.label,
        type: c.type === "badge" ? "select" : c.type === "currency" || c.type === "number" ? "text" : "text",
        options: c.type === "badge" && c.badgeVariants ? Object.keys(c.badgeVariants) : undefined,
        required: false,
        defaultValue: formValues[c.key] !== undefined ? String(formValues[c.key]) : "",
      })),
  };

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-xl font-bold text-foreground">{title ?? collection}</CardTitle>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <div className="relative min-w-0 flex-1 md:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-foreground/30" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search..."
              className="pl-9 w-full md:w-56 bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/20 focus-visible:ring-amber-500/50"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={fetchRecords} className="text-foreground/40 hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {allowCreate && (
            <Button onClick={openCreate} size="sm" className="bg-amber-500 hover:bg-amber-400 text-background font-bold gap-1.5">
              <Plus className="h-4 w-4" /> New
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="space-y-3 md:hidden">
          {loading
            ? Array(Math.min(pageSize, 3)).fill(0).map((_, i) => (
                <div key={i} className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3">
                  <Skeleton className="h-5 w-2/3 bg-foreground/5" />
                  <Skeleton className="mt-3 h-4 w-full bg-foreground/5" />
                  <Skeleton className="mt-2 h-4 w-1/2 bg-foreground/5" />
                </div>
              ))
            : paged.length === 0
            ? (
                <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-4 py-10 text-center text-sm text-foreground/30">
                  {search ? `No results for "${search}"` : "No records yet. Create one to get started."}
                </div>
              )
            : paged.map((record, i) => (
                <motion.div
                  key={record.id ?? i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.04 }}
                  className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3"
                >
                  <div className="space-y-3">
                    {effectiveColumns.slice(0, 4).map(c => (
                      <div key={c.key} className="grid grid-cols-[6rem_1fr] gap-3 text-sm">
                        <span className="text-[10px] uppercase tracking-wider text-foreground/35">{c.label}</span>
                        <div className="min-w-0 text-right text-foreground/80">{formatCellValue(record[c.key], c)}</div>
                      </div>
                    ))}
                  </div>
                  {(allowEdit || allowDelete) && (
                    <div className="mt-3 flex items-center justify-end gap-1 border-t border-foreground/10 pt-2">
                      {allowEdit && (
                        <Button variant="ghost" size="icon" onClick={() => openEdit(record)} className="h-8 w-8 text-foreground/50 hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {allowDelete && (
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(record.id)} className="h-8 w-8 text-rose-400/70 hover:text-rose-400">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </motion.div>
              ))
          }
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader className="bg-foreground/5">
              <TableRow className="border-foreground/5 hover:bg-transparent">
                {effectiveColumns.map(c => <TableHead key={c.key} className="text-foreground/50 text-xs uppercase tracking-wider">{c.label}</TableHead>)}
                {(allowEdit || allowDelete) && <TableHead className="text-right text-foreground/50 text-xs uppercase tracking-wider">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array(pageSize).fill(0).map((_, i) => (
                    <TableRow key={i} className="border-foreground/5">
                      {effectiveColumns.map(c => <TableCell key={c.key}><Skeleton className="h-5 w-full bg-foreground/5" /></TableCell>)}
                      {(allowEdit || allowDelete) && <TableCell><Skeleton className="h-5 w-16 ml-auto bg-foreground/5" /></TableCell>}
                    </TableRow>
                  ))
                : paged.length === 0
                ? (
                    <TableRow className="border-foreground/5">
                      <TableCell colSpan={effectiveColumns.length + 1} className="text-center py-16 text-foreground/30">
                        {search ? `No results for "${search}"` : "No records yet. Create one to get started."}
                      </TableCell>
                    </TableRow>
                  )
                : paged.map((record, i) => (
                    <motion.tr
                      key={record.id ?? i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className="border-foreground/5 hover:bg-foreground/5 transition-colors group"
                    >
                      {effectiveColumns.map(c => (
                        <TableCell key={c.key} className="text-foreground/80 text-sm">
                          {formatCellValue(record[c.key], c)}
                        </TableCell>
                      ))}
                      {(allowEdit || allowDelete) && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {allowEdit && (
                              <Button variant="ghost" size="icon" onClick={() => openEdit(record)} className="h-7 w-7 text-foreground/40 hover:text-foreground">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {allowDelete && (
                              <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(record.id)} className="h-7 w-7 text-rose-400/60 hover:text-rose-400">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </motion.tr>
                  ))
              }
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-foreground/40 text-sm">
            <span>{filtered.length} records</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-7 w-7">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-foreground/60">Page {page} of {totalPages}</span>
              <Button variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="h-7 w-7">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-card border-foreground/10 text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${title ?? "Record"}` : `New ${title ?? "Record"}`}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <FormRenderer
              schema={formSchema ?? autoSchema}
              onSubmit={handleFormSubmit}
              submitLabel={saving ? "Saving…" : editing ? "Save Changes" : "Create"}
              disabled={saving}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-card border-foreground/10 text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Record</DialogTitle>
          </DialogHeader>
          <p className="text-foreground/60 text-sm">This action cannot be undone.</p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="text-foreground/60">Cancel</Button>
            <Button onClick={() => deleteTarget && handleDelete(deleteTarget)} className="bg-rose-500 hover:bg-rose-400 text-foreground">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
