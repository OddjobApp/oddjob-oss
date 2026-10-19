import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Download, Edit3, ExternalLink, History, Package, RefreshCcw, Search, ShieldCheck, X } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SystemDependency {
  id: number;
  name: string;
  version: string;
  license: string | null;
  feature: string | null;
  securityAlertsCount: number;
  vulnerabilityDetails: unknown[];
  lastSyncedAt: string;
}

type RiskFilter = "all" | "attention" | "clear";

function formatSyncTime(value?: string) {
  if (!value) return "Not yet scanned";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Scan time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function DependencyTrackerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: dependencies = [], isLoading, isError, refetch } = useQuery<SystemDependency[]>({
    queryKey: ["system-dependencies"],
    queryFn: async () => {
      const response = await fetch("/api/admin/system/dependencies");
      if (!response.ok) throw new Error("Failed to fetch dependencies");
      return response.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/system/dependencies/sync", { method: "POST" });
      if (!response.ok) throw new Error("Registry scan failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-dependencies"] });
      toast({ title: "Registry scan complete", description: "Dependency and security data is up to date." });
    },
    onError: (error: Error) => toast({ title: "Registry scan failed", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, feature }: { id: number; feature: string }) => {
      const response = await fetch(`/api/admin/system/dependencies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature }),
      });
      if (!response.ok) throw new Error("Feature assignment could not be saved");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-dependencies"] });
      setEditingId(null);
      toast({ title: "Feature assignment updated" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const alertCount = useMemo(() => dependencies.reduce((total, dependency) => total + dependency.securityAlertsCount, 0), [dependencies]);
  const affectedCount = useMemo(() => dependencies.filter((dependency) => dependency.securityAlertsCount > 0).length, [dependencies]);
  const filteredDependencies = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return dependencies.filter((dependency) => {
      const matchesQuery = !query || [dependency.name, dependency.feature, dependency.version, dependency.license]
        .some((value) => value?.toLowerCase().includes(query));
      const matchesRisk = riskFilter === "all"
        || (riskFilter === "attention" && dependency.securityAlertsCount > 0)
        || (riskFilter === "clear" && dependency.securityAlertsCount === 0);
      return matchesQuery && matchesRisk;
    });
  }, [dependencies, riskFilter, searchQuery]);

  const latestSync = dependencies.reduce<string | undefined>((latest, dependency) => {
    if (!latest) return dependency.lastSyncedAt;
    return new Date(dependency.lastSyncedAt) > new Date(latest) ? dependency.lastSyncedAt : latest;
  }, undefined);

  const exportSbom = () => {
    if (!filteredDependencies.length) return;
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Package", "Version", "License", "Feature", "Security alerts", "Last synced"],
      ...filteredDependencies.map((dependency) => [dependency.name, dependency.version, dependency.license ?? "Unknown", dependency.feature ?? "Unassigned", dependency.securityAlertsCount, dependency.lastSyncedAt]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `software-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const metrics = [
    { label: "Dependencies", value: dependencies.length, detail: "packages inventoried", icon: Package, tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
    { label: "Security alerts", value: alertCount, detail: `${affectedCount} packages affected`, icon: AlertTriangle, tone: alertCount ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    { label: "Clear packages", value: dependencies.length - affectedCount, detail: "no active alerts", icon: ShieldCheck, tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    { label: "Feature coverage", value: dependencies.filter((dependency) => dependency.feature).length, detail: `${dependencies.filter((dependency) => !dependency.feature).length} need ownership`, icon: Check, tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <main className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", alertCount ? "bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.6)]" : "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.6)]")} />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Platform Maintenance / Software Audit</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Software Audit</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">Review dependency inventory, security exposure, licensing, and feature ownership from one operational view.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Last registry scan</p><p className="mt-1 text-xs font-semibold">{formatSyncTime(latestSync)}</p></div>
            <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="h-11 rounded-xl px-5 text-[10px] font-black uppercase">
              <RefreshCcw className={cn("mr-2 h-4 w-4", syncMutation.isPending && "animate-spin")} />{syncMutation.isPending ? "Scanning…" : "Run registry scan"}
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Audit summary">
          {metrics.map((metric) => { const Icon = metric.icon; return (
            <Card key={metric.label} className="border-foreground/10 bg-foreground/[0.04]"><CardContent className="flex items-center justify-between gap-4 p-4">
              <div><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{metric.label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p></div>
              <div className={cn("rounded-xl border p-3", metric.tone)}><Icon className="h-5 w-5" /></div>
            </CardContent></Card>
          ); })}
        </section>

        <Card className="border-foreground/10 bg-foreground/[0.04]">
          <CardHeader className="gap-4 border-b border-foreground/10 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div><CardTitle className="text-sm font-black uppercase tracking-widest">Dependency inventory</CardTitle><p className="mt-1 text-xs text-muted-foreground">{filteredDependencies.length} of {dependencies.length} packages shown</p></div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search dependencies" placeholder="Search package, feature, version…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="h-10 rounded-xl border-foreground/10 bg-background/40 pl-9 text-xs" /></div>
              <div className="relative"><select aria-label="Filter by security status" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)} className="h-10 w-full appearance-none rounded-xl border border-foreground/10 bg-background/40 pl-3 pr-9 text-xs font-semibold text-foreground sm:w-44"><option value="all">All security states</option><option value="attention">Needs attention</option><option value="clear">No active alerts</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /></div>
              <Button variant="outline" onClick={exportSbom} disabled={!filteredDependencies.length} className="h-10 rounded-xl border-foreground/10 px-4 text-[10px] font-black uppercase"><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}</div>
            ) : isError ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"><AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-300" /><div><p className="font-semibold">Dependency inventory could not be loaded</p><p className="mt-1 text-xs text-muted-foreground">Check the service connection and try again.</p></div><Button variant="outline" onClick={() => refetch()} className="rounded-xl">Try again</Button></div>
            ) : filteredDependencies.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center"><Search className="h-7 w-7 text-muted-foreground" /><p className="font-semibold">No dependencies match these filters</p><Button variant="ghost" onClick={() => { setSearchQuery(""); setRiskFilter("all"); }}>Clear filters</Button></div>
            ) : (
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow className="border-foreground/10 hover:bg-transparent"><TableHead className="h-12 px-4 text-[10px] font-black uppercase tracking-widest">Package</TableHead><TableHead className="text-[10px] font-black uppercase tracking-widest">Feature ownership</TableHead><TableHead className="text-[10px] font-black uppercase tracking-widest">Version</TableHead><TableHead className="text-[10px] font-black uppercase tracking-widest">License</TableHead><TableHead className="px-4 text-right text-[10px] font-black uppercase tracking-widest">Security</TableHead></TableRow></TableHeader>
                <TableBody>{filteredDependencies.map((dependency) => (
                  <TableRow key={dependency.id} className="border-foreground/10">
                    <TableCell className="px-4 py-3"><div className="flex items-center gap-3"><div className="rounded-lg border border-foreground/10 bg-foreground/[0.04] p-2"><Package className="h-4 w-4 text-muted-foreground" /></div><span className="text-sm font-semibold">{dependency.name}</span></div></TableCell>
                    <TableCell>{editingId === dependency.id ? (
                      <div className="flex min-w-56 items-center gap-2"><Input value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") updateMutation.mutate({ id: dependency.id, feature: editValue }); if (event.key === "Escape") setEditingId(null); }} autoFocus className="h-9 text-xs" /><Button aria-label="Save feature assignment" size="icon" variant="ghost" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: dependency.id, feature: editValue })}><Check className="h-4 w-4" /></Button><Button aria-label="Cancel editing" size="icon" variant="ghost" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button></div>
                    ) : (
                      <button onClick={() => { setEditingId(dependency.id); setEditValue(dependency.feature ?? ""); }} className="group flex items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Badge variant="outline" className={cn("border-foreground/10 text-[10px]", !dependency.feature && "text-muted-foreground")}>{dependency.feature || "Unassigned"}</Badge><Edit3 className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></button>
                    )}</TableCell>
                    <TableCell className="font-mono text-xs">{dependency.version}</TableCell><TableCell><span className="text-xs font-semibold">{dependency.license || "Unknown"}</span></TableCell>
                    <TableCell className="px-4 text-right">{dependency.securityAlertsCount > 0 ? <Badge className="border border-amber-400/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"><AlertTriangle className="mr-1 h-3.5 w-3.5" />{dependency.securityAlertsCount} alert{dependency.securityAlertsCount === 1 ? "" : "s"}</Badge> : <Badge variant="outline" className="border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Clear</Badge>}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table></div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 text-xs text-muted-foreground sm:flex-row sm:items-center"><div className="flex items-center gap-2"><History className="h-4 w-4" /><span>Audit snapshots are timestamped when the registry scan completes.</span></div><a href="/platform-maintenance/snapshots" className="inline-flex items-center font-semibold text-foreground hover:underline">View maintenance snapshots <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></div>
      </main>
    </div>
  );
}
