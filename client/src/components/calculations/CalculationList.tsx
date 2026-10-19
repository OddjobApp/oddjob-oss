import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, Play, RefreshCw, Layers, Sparkles, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface CalculationItem {
    id: number;
    nodeId: number;
    operation: string;
    formula: string;
    status: string;
    cachedResult?: number | null;
    lastCalculatedAt?: string | null;
    outputUnit?: string | null;
    validationError?: string | null;
}

export function CalculationList({ onSelect }: { onSelect?: (calc: CalculationItem) => void }) {
    const [calculations, setCalculations] = useState<CalculationItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [executingId, setExecutingId] = useState<number | null>(null);
    const [filter, setFilter] = useState<string>("ALL");
    const { toast } = useToast();

    const fetchCalculations = async () => {
        setLoading(true);
        try {
            const res = await apiRequest("GET", "/api/calculations");
            const data = await res.json();
            setCalculations(data.calculations || []);
        } catch (err: any) {
            toast({ title: "Failed to load calculations", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCalculations();
    }, []);

    const executeCalculation = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setExecutingId(id);
        try {
            const res = await apiRequest("POST", `/api/calculations/${id}/execute`, { forceRecalculate: true });
            const data = await res.json();
            toast({
                title: "Calculation executed",
                description: `Result: ${data.result?.value ?? "N/A"} (${data.result?.executionTimeMs ?? 0}ms)`
            });
            fetchCalculations();
        } catch (err: any) {
            toast({ title: "Execution failed", description: err.message, variant: "destructive" });
        } finally {
            setExecutingId(null);
        }
    };

    const filteredCalculations = calculations.filter(c => {
        if (filter === "ACTIVE") return c.status === "ACTIVE";
        if (filter === "ERROR") return c.status === "ERROR";
        if (filter === "CONSTRAINTS") return ["RULE_VALIDATION", "CONSTRAINT_CHECK", "POLICY_ENFORCEMENT", "GATE_CONDITION"].includes(c.operation);
        return true;
    });

    const getOperationBadgeColor = (op: string) => {
        if (["RULE_VALIDATION", "CONSTRAINT_CHECK", "POLICY_ENFORCEMENT", "GATE_CONDITION"].includes(op)) {
            return "bg-amber-500/10 text-amber-400 border-amber-500/30";
        }
        if (["PAGERANK", "INFLUENCE_PROPAGATION"].includes(op)) {
            return "bg-purple-500/10 text-purple-400 border-purple-500/30";
        }
        if (["MODEL_PREDICTION", "CLASSIFICATION", "ANOMALY_DETECTION"].includes(op)) {
            return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
        }
        if (["MOVING_AVERAGE", "YEAR_OVER_YEAR", "CAGR"].includes(op)) {
            return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
        }
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/30";
    };

    return (
        <Card className="w-full shadow-sm border border-border/60 bg-card/60 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                        <Calculator className="h-5 w-5" />
                    </div>
                    <div>
                        <CardTitle className="text-base font-semibold">Knowledge Calculation Nodes</CardTitle>
                        <p className="text-xs text-muted-foreground">Neuro-Symbolic formulas, graph metrics & constraint gates</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-black/20 rounded-lg p-0.5 border border-white/5 text-[10px]">
                        {["ALL", "ACTIVE", "CONSTRAINTS", "ERROR"].map((f) => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => setFilter(f)}
                                className={`px-2 py-1 rounded-md font-medium capitalize transition-all ${
                                    filter === f
                                        ? "bg-indigo-600 text-white shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {f.toLowerCase()}
                            </button>
                        ))}
                    </div>
                    <Button size="sm" variant="outline" className="h-8 text-xs bg-background/50" onClick={fetchCalculations} disabled={loading}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">Loading calculation nodes...</div>
                ) : filteredCalculations.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-white/10 rounded-xl p-6">
                        No calculation nodes matching filter "{filter}".
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredCalculations.map((calc) => (
                            <div
                                key={calc.id}
                                onClick={() => onSelect?.(calc)}
                                className="p-3.5 rounded-xl border border-border/60 hover:border-indigo-500/50 bg-background/40 hover:bg-accent/30 cursor-pointer transition-all flex flex-col justify-between gap-2.5 shadow-sm"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Badge variant="outline" className={`font-mono text-[9px] uppercase px-1.5 py-0.5 ${getOperationBadgeColor(calc.operation)}`}>
                                                {calc.operation}
                                            </Badge>
                                            <span className="font-semibold text-xs text-foreground truncate">
                                                Node #{calc.nodeId}
                                            </span>
                                        </div>
                                        <p className="text-[11px] font-mono mt-1 text-muted-foreground truncate" title={calc.formula}>
                                            {calc.formula || "No explicit formula string"}
                                        </p>
                                    </div>
                                    <Badge
                                        className="capitalize text-[10px]"
                                        variant={calc.status === "ACTIVE" ? "default" : calc.status === "ERROR" ? "destructive" : "secondary"}
                                    >
                                        {calc.status}
                                    </Badge>
                                </div>

                                {calc.validationError && (
                                    <div className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 flex items-center gap-1.5 truncate">
                                        <ShieldAlert className="h-3 w-3 shrink-0" />
                                        <span className="truncate">{calc.validationError}</span>
                                    </div>
                                )}

                                <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                                    <div className="flex items-center gap-1 text-indigo-400 font-mono text-[11px]">
                                        <Sparkles className="h-3 w-3 shrink-0" />
                                        <span>
                                            {calc.cachedResult !== null && calc.cachedResult !== undefined
                                                ? `${calc.cachedResult} ${calc.outputUnit || ""}`
                                                : "Unevaluated"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {calc.lastCalculatedAt && (
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                <Clock className="h-2.5 w-2.5" />
                                                {new Date(calc.lastCalculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-lg text-xs"
                                            onClick={(e) => executeCalculation(calc.id, e)}
                                            disabled={executingId === calc.id}
                                        >
                                            <Play className={`h-3 w-3 mr-1 ${executingId === calc.id ? "animate-pulse" : ""}`} />
                                            {executingId === calc.id ? "Running..." : "Run"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

