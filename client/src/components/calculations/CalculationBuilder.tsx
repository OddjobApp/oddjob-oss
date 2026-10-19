import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Sparkles, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface CalculationBuilderProps {
    onCreated?: () => void;
}

const OPERATIONS = [
    { value: "FORMULA", label: "Basic Formula (Arithmetic AST)", group: "Arithmetic" },
    { value: "SUM", label: "Aggregation (Sum)", group: "Arithmetic" },
    { value: "AVERAGE", label: "Aggregation (Average)", group: "Arithmetic" },
    { value: "MOVING_AVERAGE", label: "Temporal (Moving Average)", group: "Temporal" },
    { value: "YEAR_OVER_YEAR", label: "Temporal (Year-over-Year Growth)", group: "Temporal" },
    { value: "CAGR", label: "Temporal (Compound Annual Growth)", group: "Temporal" },
    { value: "MONTE_CARLO_SIMULATION", label: "Probabilistic (Monte Carlo Simulation)", group: "Probabilistic" },
    { value: "BAYESIAN_INFERENCE", label: "Probabilistic (Bayesian Inference)", group: "Probabilistic" },
    { value: "RULE_VALIDATION", label: "Constraint (Rule Validation)", group: "Constraints" },
    { value: "CONSTRAINT_CHECK", label: "Constraint (Range & Boundaries)", group: "Constraints" },
    { value: "POLICY_ENFORCEMENT", label: "Constraint (Policy Gate)", group: "Constraints" },
    { value: "GATE_CONDITION", label: "Constraint (Conditional Logic Gate)", group: "Constraints" },
    { value: "PAGERANK", label: "Graph Algorithm (PageRank)", group: "Graph" },
    { value: "INFLUENCE_PROPAGATION", label: "Graph Algorithm (Influence Propagation)", group: "Graph" },
    { value: "MODEL_PREDICTION", label: "ML Inference (Model Prediction)", group: "ML" },
    { value: "CLASSIFICATION", label: "ML Inference (Classification)", group: "ML" },
    { value: "ANOMALY_DETECTION", label: "ML Inference (Anomaly Detection)", group: "ML" },
];

const CONSTRAINT_TYPES = [
    { value: "RANGE", label: "Numeric Range ([min, max])" },
    { value: "EQUALITY", label: "Exact Equality Match" },
    { value: "EXISTENCE", label: "Key Existence Check" },
    { value: "SET_MEMBERSHIP", label: "Allowed Set Membership" },
    { value: "CUSTOM", label: "Custom Boolean Expression" },
];

const ENFORCEMENT_ACTIONS = [
    { value: "LOG", label: "Log Only (Observability)" },
    { value: "WARN", label: "Warn (Raise Alert)" },
    { value: "BLOCK", label: "Block (Gate / Prevent Action)" },
];

export function CalculationBuilder({ onCreated }: CalculationBuilderProps) {
    const [nodeId, setNodeId] = useState<string>("");
    const [operation, setOperation] = useState<string>("FORMULA");
    const [formula, setFormula] = useState<string>("");
    const [constraintType, setConstraintType] = useState<string>("RANGE");
    const [enforcementAction, setEnforcementAction] = useState<string>("LOG");
    const [outputUnit, setOutputUnit] = useState<string>("");
    const [submitting, setSubmitting] = useState<boolean>(false);
    const { toast } = useToast();

    const isConstraintOp = ["RULE_VALIDATION", "CONSTRAINT_CHECK", "POLICY_ENFORCEMENT", "GATE_CONDITION"].includes(operation);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nodeId) {
            toast({ title: "Node ID required", description: "Please enter a target Knowledge Node ID", variant: "destructive" });
            return;
        }
        // Every calculation stores its formula (the column is NOT NULL), so an empty
        // one used to fail on insert with an opaque server error.
        if (!formula.trim()) {
            toast({
                title: isConstraintOp ? "Condition required" : "Formula required",
                description: isConstraintOp
                    ? "Enter the rule the constraint checks, e.g. latency_ms <= 200."
                    : "Enter the expression to calculate, e.g. revenue - expenses.",
                variant: "destructive",
            });
            return;
        }

        setSubmitting(true);
        try {
            await apiRequest("POST", "/api/calculations", {
                nodeId: Number(nodeId),
                operation,
                formula: formula.trim(),
                constraintType: isConstraintOp ? constraintType : undefined,
                enforcementAction: isConstraintOp ? enforcementAction : undefined,
                outputUnit: outputUnit || undefined,
            });

            toast({ title: "Calculation Node Created", description: `Node #${nodeId} is now configured with ${operation}` });
            setNodeId("");
            setFormula("");
            setOutputUnit("");
            onCreated?.();
        } catch (err: any) {
            toast({ title: "Failed to create calculation", description: err.message, variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card className="w-full border border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-indigo-500" />
                    <CardTitle className="text-base font-semibold">New Neuro-Symbolic Calculation Node</CardTitle>
                </div>
            </CardHeader>
            <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="nodeId" className="text-xs font-medium">Target Knowledge Node ID</Label>
                            <Input
                                id="nodeId"
                                type="number"
                                placeholder="e.g. 105"
                                value={nodeId}
                                onChange={(e) => setNodeId(e.target.value)}
                                className="h-8 text-xs font-mono bg-background/50"
                                required
                            />
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="operation" className="text-xs font-medium">Operation Family</Label>
                            <Select value={operation} onValueChange={setOperation}>
                                <SelectTrigger className="h-8 text-xs bg-background/50">
                                    <SelectValue placeholder="Select operation" />
                                </SelectTrigger>
                                <SelectContent className="max-h-64">
                                    {OPERATIONS.map((op) => (
                                        <SelectItem key={op.value} value={op.value} className="text-xs">
                                            <span className="font-mono text-[10px] text-muted-foreground mr-1.5">[{op.group}]</span>
                                            {op.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {isConstraintOp ? (
                        <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 space-y-3">
                            <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-xs">
                                <ShieldCheck className="h-4 w-4" />
                                <span>Constraint & Governance Configuration</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Constraint Type</Label>
                                    <Select value={constraintType} onValueChange={setConstraintType}>
                                        <SelectTrigger className="h-8 text-xs bg-background/50">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {CONSTRAINT_TYPES.map((ct) => (
                                                <SelectItem key={ct.value} value={ct.value} className="text-xs">
                                                    {ct.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Enforcement Action</Label>
                                    <Select value={enforcementAction} onValueChange={setEnforcementAction}>
                                        <SelectTrigger className="h-8 text-xs bg-background/50">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ENFORCEMENT_ACTIONS.map((ea) => (
                                                <SelectItem key={ea.value} value={ea.value} className="text-xs">
                                                    {ea.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="space-y-1">
                        <Label htmlFor="formula" className="text-xs font-medium">
                            {isConstraintOp ? "Condition / Expression Rule" : "Formula / Expression"}
                        </Label>
                        <Input
                            id="formula"
                            placeholder={isConstraintOp ? "e.g. latency_ms <= 200 && error_rate == 0" : "e.g. revenue - expenses or a * 1.05"}
                            value={formula}
                            onChange={(e) => setFormula(e.target.value)}
                            className="h-8 text-xs font-mono bg-background/50"
                            required
                        />
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="outputUnit" className="text-xs font-medium">Output Unit / Badge (Optional)</Label>
                        <Input
                            id="outputUnit"
                            placeholder="e.g. USD, %, ms, score, status"
                            value={outputUnit}
                            onChange={(e) => setOutputUnit(e.target.value)}
                            className="h-8 text-xs bg-background/50"
                        />
                    </div>
                </CardContent>
                <CardFooter className="pt-2 flex justify-end">
                    <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm" disabled={submitting}>
                        <PlusCircle className="h-4 w-4 mr-1.5" />
                        {submitting ? "Creating..." : "Create Calculation Node"}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
