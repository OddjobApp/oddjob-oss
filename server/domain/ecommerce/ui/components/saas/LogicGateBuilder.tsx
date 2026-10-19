import React, { useState } from "react";
import { 
    Plus, 
    Trash2, 
    Filter, 
    Settings2, 
    Cpu, 
    Terminal,
    ChevronDown,
    SearchCode,
    Activity,
    ShieldAlert
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@domain-ui/core/ui/components/ui/select";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Field {
    key: string;
    name: string;
    type: string;
}

interface Rule {
    id: string;
    field: string;
    operator: string;
    value: string;
}

interface LogicGateBuilderProps {
    discoveredFields: Field[];
    filters: Record<string, any>;
    onFiltersChange: (newFilters: Record<string, any>) => void;
}

const OPERATORS = [
    { value: "eq", label: "EQUALS" },
    { value: "neq", label: "NOT_EQUALS" },
    { value: "contains", label: "CONTAINS" },
    { value: "ncontains", label: "NOT_CONTAINS" },
    { value: "gt", label: "GREATER_THAN" },
    { value: "lt", label: "LESS_THAN" },
    { value: "exists", label: "EXISTS" }
];

export function LogicGateBuilder({ 
    discoveredFields, 
    filters, 
    onFiltersChange 
}: LogicGateBuilderProps) {
    // Convert current JSON filters to our rule format for internal state
    // For now, we assume simple key-value filters or basic nested objects
    const [rules, setRules] = useState<Rule[]>(() => {
        const initialRules: Rule[] = [];
        Object.entries(filters).forEach(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
                // Handle complex operators if they exist
                Object.entries(val).forEach(([op, value]) => {
                    initialRules.push({
                        id: Math.random().toString(36).substr(2, 9),
                        field: key,
                        operator: op,
                        value: String(value)
                    });
                });
            } else {
                initialRules.push({
                    id: Math.random().toString(36).substr(2, 9),
                    field: key,
                    operator: "eq",
                    value: String(val)
                });
            }
        });
        return initialRules.length > 0 ? initialRules : [];
    });

    const updateSystemFilters = (updatedRules: Rule[]) => {
        const newFilters: Record<string, any> = {};
        updatedRules.forEach(rule => {
            if (!rule.field) return;
            
            if (rule.operator === "eq") {
                newFilters[rule.field] = rule.value;
            } else {
                newFilters[rule.field] = {
                    ...newFilters[rule.field],
                    [rule.operator]: rule.value
                };
            }
        });
        onFiltersChange(newFilters);
    };

    const handleAddRule = () => {
        const newRule = {
            id: Math.random().toString(36).substr(2, 9),
            field: "",
            operator: "eq",
            value: ""
        };
        const updated = [...rules, newRule];
        setRules(updated);
    };

    const handleRemoveRule = (id: string) => {
        const updated = rules.filter(r => r.id !== id);
        setRules(updated);
        updateSystemFilters(updated);
    };

    const handleUpdateRule = (id: string, updates: Partial<Rule>) => {
        const updated = rules.map(r => r.id === id ? { ...r, ...updates } : r);
        setRules(updated);
        updateSystemFilters(updated);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground italic flex items-center">
                        <Settings2 className="w-4 h-4 mr-3 text-blue-400" />
                        Logic_Gate Configuration
                    </h4>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">
                        Define exclusion protocols and data ingestion constraints.
                    </p>
                </div>
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleAddRule}
                    className="h-9 px-4 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[9px] font-black uppercase tracking-widest italic border border-blue-500/20"
                >
                    <Plus className="w-3.5 h-3.5 mr-2" />
                    Append_Rule
                </Button>
            </div>

            <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                    {rules.length === 0 ? (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="p-12 rounded-[2rem] border border-dashed border-foreground/5 bg-foreground/[0.01] flex flex-col items-center justify-center text-center space-y-4"
                        >
                            <div className="w-12 h-12 rounded-full bg-foreground/[0.03] flex items-center justify-center">
                                <Filter className="w-5 h-5 text-foreground/10" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">No Active Gates</div>
                                <p className="text-[8px] font-bold uppercase tracking-widest text-foreground/10 italic">All node data will pass through the primary tunnel.</p>
                            </div>
                        </motion.div>
                    ) : (
                        rules.map((rule) => (
                            <motion.div 
                                key={rule.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="flex items-center gap-3 p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 hover:border-foreground/10 transition-all group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                                    <Cpu className="w-4 h-4" />
                                </div>

                                {/* Field Select */}
                                <div className="flex-[2]">
                                    <Select 
                                        value={rule.field} 
                                        onValueChange={(val) => handleUpdateRule(rule.id, { field: val })}
                                    >
                                        <SelectTrigger className="h-10 bg-background/40 border-foreground/5 rounded-xl text-[9px] font-black uppercase tracking-widest italic text-foreground">
                                            <SelectValue placeholder="SELECT VECTOR..." />
                                        </SelectTrigger>
                                        <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-xl">
                                            {discoveredFields.map(f => (
                                                <SelectItem key={f.key} value={f.key} className="text-[9px] font-black uppercase italic tracking-widest text-foreground">
                                                    {f.name} ({f.key})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Operator Select */}
                                <div className="flex-1">
                                    <Select 
                                        value={rule.operator} 
                                        onValueChange={(val) => handleUpdateRule(rule.id, { operator: val })}
                                    >
                                        <SelectTrigger className="h-10 bg-background/40 border-foreground/5 rounded-xl text-[9px] font-black uppercase tracking-widest italic text-blue-400">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-xl">
                                            {OPERATORS.map(op => (
                                                <SelectItem key={op.value} value={op.value} className="text-[9px] font-black uppercase italic tracking-widest text-foreground">
                                                    {op.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Value Input */}
                                <div className="flex-[2]">
                                    <Input 
                                        placeholder="TARGET_VALUE..."
                                        value={rule.value}
                                        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                                        className="h-10 bg-background/40 border-foreground/5 rounded-xl px-4 text-[9px] font-black uppercase tracking-widest italic text-foreground placeholder:text-foreground/10"
                                    />
                                </div>

                                <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => handleRemoveRule(rule.id)}
                                    className="h-10 w-10 p-0 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity border border-rose-500/20"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>

            <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Terminal className="w-4 h-4 text-foreground/20" />
                    <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 italic">
                        {rules.length} Logic Gates active. All signals verified against schema vectors.
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-foreground/10 text-[8px] text-foreground/40 uppercase">Mode: Conditional_Filter</Badge>
                </div>
            </div>
        </div>
    );
}
