import React, { useState, useRef } from "react";
import {
    ChevronDown, ChevronRight, Plus, Trash2, GitBranch,
    Milestone, Zap, Link as LinkIcon, Database, Key, FileText, Hash,
    ArrowRight, Tags, Package, AlertTriangle, Pause, GripVertical,
    Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScaffoldPackPalette } from "./ScaffoldPackPalette";
import type { Blueprint, Dependency, BranchCondition, ResourceRequirement, DependencyOffsetUnit } from "../data/cycle-templates";

export interface BlueprintValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

interface BlueprintBuilderProps {
    blueprints: Blueprint[];
    onChange: (blueprints: Blueprint[]) => void;
    /** If provided, builder runs validation against this cycle id before allowing save */
    cycleId?: string | number;
    /** Called with validation result so parent can gate the Save button */
    onValidation?: (result: BlueprintValidationResult | null) => void;
}

const DEP_TYPES: { value: Dependency["type"]; label: string }[] = [
    { value: "finish_to_start", label: "Finish → Start (FS)" },
    { value: "start_to_start", label: "Start → Start (SS)" },
    { value: "finish_to_finish", label: "Finish → Finish (FF)" },
    { value: "start_to_finish", label: "Start → Finish (SF)" },
];

const RESOURCE_TYPES: { value: ResourceRequirement["type"]; label: string; icon: React.ReactNode }[] = [
    { value: "text", label: "Text", icon: <FileText className="w-3.5 h-3.5" /> },
    { value: "url_list", label: "URL List", icon: <LinkIcon className="w-3.5 h-3.5" /> },
    { value: "dataset", label: "Dataset", icon: <Database className="w-3.5 h-3.5" /> },
    { value: "credential", label: "Credential", icon: <Key className="w-3.5 h-3.5" /> },
    { value: "number", label: "Number", icon: <Hash className="w-3.5 h-3.5" /> },
];

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
    const [input, setInput] = useState("");
    const add = () => {
        const v = input.trim();
        if (v && !values.includes(v)) onChange([...values, v]);
        setInput("");
    };
    return (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-black/30 border border-white/10 min-h-[40px]">
            {values.map(v => (
                <span key={v} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {v}
                    <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="ml-0.5 hover:text-red-400">×</button>
                </span>
            ))}
            <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
                onBlur={add}
                placeholder={values.length === 0 ? placeholder : ""}
                className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            />
        </div>
    );
}

// +3d / -1w / +2mo / +1y — accepts both 'm' and 'mo' for months
const OFFSET_RE = /^([+-]?)(\d+)(ms|s|sec|min|h|d|w|mo|m|y)$/i;
const UNIT_MAP: Record<string, DependencyOffsetUnit> = {
    ms: "milliseconds", s: "seconds", sec: "seconds", min: "minutes", h: "hours",
    d: "days", w: "weeks", m: "months", mo: "months", y: "years",
};
const UNIT_CHAR: Partial<Record<DependencyOffsetUnit, string>> = {
    ms: "ms",
    milliseconds: "ms",
    s: "s",
    seconds: "s",
    m: "m",
    minutes: "m",
    h: "h",
    hours: "h",
    d: "d",
    days: "d",
    w: "w",
    weeks: "w",
    M: "mo",
    months: "mo",
    years: "y",
};

function serializeOffset(o: Dependency["offset"] | undefined): string {
    if (!o) return "";
    const unitChar = UNIT_CHAR[o.unit] ?? "d";
    return `${o.direction === "minus" ? "-" : "+"}${o.value}${unitChar}`;
}

function OffsetInput({ value, onChange }: { value: Dependency["offset"] | undefined; onChange: (o: Dependency["offset"] | undefined) => void }) {
    const [raw, setRaw] = useState(serializeOffset(value));
    const [error, setError] = useState(false);

    const commit = (v: string) => {
        const t = v.trim();
        if (!t) { onChange(undefined); setError(false); return; }
        const m = t.match(OFFSET_RE);
        if (!m) { setError(true); return; }
        setError(false);
        onChange({ direction: m[1] === "-" ? "minus" : "plus", value: parseInt(m[2]), unit: UNIT_MAP[m[3].toLowerCase()] });
    };

    return (
        <div className="space-y-0.5">
            <Input
                value={raw}
                onChange={e => { setRaw(e.target.value); if (error) setError(false); }}
                onBlur={e => commit(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commit(raw); }}
                placeholder="+3d"
                className={`bg-black/30 h-8 text-xs font-mono ${error ? "border-red-500/60 focus:border-red-500" : "border-white/10"}`}
            />
            {error && <p className="text-[9px] text-red-400 px-0.5">Use: +3d, -1w, +2mo, +1y</p>}
        </div>
    );
}

interface BlueprintCardProps {
    blueprint: Blueprint;
    index: number;
    allBlueprints: Blueprint[];
    onChange: (b: Blueprint) => void;
    onRemove: () => void;
    canRemove: boolean;
    hasCircularDep?: boolean;
}

function BlueprintCard({ blueprint, index, allBlueprints, onChange, onRemove, canRemove, hasCircularDep }: BlueprintCardProps) {
    const [expanded, setExpanded] = useState(index === 0);
    const otherNames = allBlueprints.map(b => b.name).filter(n => n && n !== blueprint.name);

    const set = (patch: Partial<Blueprint>) => onChange({ ...blueprint, ...patch });

    const addDep = () => set({
        dependencies: [...(blueprint.dependencies ?? []), { blueprintName: "", type: "finish_to_start" }]
    });
    const updateDep = (i: number, patch: Partial<Dependency>) => {
        const deps = [...(blueprint.dependencies ?? [])];
        deps[i] = { ...deps[i], ...patch };
        set({ dependencies: deps });
    };
    const removeDep = (i: number) => set({ dependencies: (blueprint.dependencies ?? []).filter((_, idx) => idx !== i) });

    const addResource = () => set({
        resources: [...(blueprint.resources ?? []), { id: `res-${Date.now()}`, label: "", type: "text", description: "", required: true }]
    });
    const updateResource = (i: number, patch: Partial<ResourceRequirement>) => {
        const res = [...(blueprint.resources ?? [])];
        res[i] = { ...res[i], ...patch };
        set({ resources: res });
    };
    const removeResource = (i: number) => set({ resources: (blueprint.resources ?? []).filter((_, idx) => idx !== i) });

    const setBranch = (outcome: "success" | "failure", target: string) => {
        const branches = (blueprint.branches ?? []).filter(b => b.onOutcome !== outcome);
        if (target) branches.push({ onOutcome: outcome, targetBlueprint: target });
        set({ branches });
    };
    const getBranch = (outcome: "success" | "failure") =>
        blueprint.branches?.find(b => b.onOutcome === outcome)?.targetBlueprint ?? "";

    const isMilestone = blueprint.type === "milestone";

    return (
        <div className={`rounded-2xl border transition-all overflow-hidden ${
            hasCircularDep ? "border-red-500/40 bg-red-500/5" :
            isMilestone ? "border-yellow-500/30 bg-yellow-500/5" :
            "border-white/10 bg-foreground/5 hover:border-primary/20"
        }`}>
            {/* Card header — always visible */}
            <div
                className="flex items-center gap-3 p-4 cursor-pointer select-none"
                onClick={() => setExpanded(e => !e)}
            >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                    isMilestone ? "bg-yellow-500/20 text-yellow-400 rotate-45" : "bg-primary/15 text-primary"
                }`}>
                    {isMilestone ? <Milestone className="w-4 h-4 -rotate-45" /> : <span>{index + 1}</span>}
                </div>

                <div className="flex-1 min-w-0">
                    {expanded ? (
                        <Input
                            value={blueprint.name}
                            onChange={e => { e.stopPropagation(); set({ name: e.target.value }); }}
                            onClick={e => e.stopPropagation()}
                            placeholder="Mission name…"
                            className="h-7 bg-transparent border-white/10 text-sm font-bold"
                        />
                    ) : (
                        <p className="text-sm font-bold truncate">{blueprint.name || <span className="text-muted-foreground italic">Unnamed</span>}</p>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {(blueprint.dependencies?.length ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1">
                            <GitBranch className="w-2.5 h-2.5" />{blueprint.dependencies!.length}
                        </Badge>
                    )}
                    {(blueprint.resources?.length ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1">
                            <Package className="w-2.5 h-2.5" />{blueprint.resources!.length}
                        </Badge>
                    )}
                    <Badge className={`text-[9px] ${isMilestone ? "bg-yellow-500/20 text-yellow-400" : "bg-primary/10 text-primary"}`}>
                        {blueprint.type ?? "mission"}
                    </Badge>
                    {canRemove && (
                        <button
                            type="button"
                            title="Remove blueprint"
                            onClick={e => { e.stopPropagation(); onRemove(); }}
                            className="p-1 rounded-full hover:bg-red-500/20 hover:text-red-400 text-muted-foreground transition-colors"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
            </div>

            {/* Expanded body */}
            {expanded && (
                <div className="px-4 pb-4 space-y-5 border-t border-white/5 pt-4">
                    {/* Objective */}
                    <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Operational Objective</Label>
                        <Textarea
                            value={blueprint.objective}
                            onChange={e => set({ objective: e.target.value })}
                            placeholder="What should the agent accomplish?"
                            rows={2}
                            className="bg-black/30 border-white/10 resize-none text-sm"
                        />
                    </div>

                    {/* Type + Duration + Milestone config */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Phase Type</Label>
                            <Select
                                value={blueprint.type ?? "mission"}
                                onValueChange={(v: "mission" | "milestone" | "prediction") => set({ type: v })}
                            >
                                <SelectTrigger className="bg-black/30 border-white/10 h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="mission"><span className="flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-primary" /> Mission</span></SelectItem>
                                    <SelectItem value="milestone"><span className="flex items-center gap-2"><Milestone className="w-3.5 h-3.5 text-yellow-400" /> Milestone Gate</span></SelectItem>
                                    <SelectItem value="prediction"><span className="flex items-center gap-2"><Target className="w-3.5 h-3.5 text-emerald-400" /> Prediction</span></SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                Duration ({(() => {
                                    const activeUnit = blueprint.timeUnit ?? allBlueprints[0]?.timeUnit ?? "d";
                                    return {
                                        ms: "milliseconds",
                                        s: "seconds",
                                        m: "minutes",
                                        h: "hours",
                                        d: "days",
                                        w: "weeks",
                                        M: "months",
                                    }[activeUnit] ?? "days";
                                })()})
                            </Label>
                            <Input
                                type="number"
                                min={0}
                                step={1}
                                value={blueprint.estimatedDuration ?? blueprint.estimatedDays ?? ""}
                                onChange={e => {
                                    const v = parseInt(e.target.value);
                                    set({ 
                                        estimatedDuration: isNaN(v) ? undefined : Math.max(0, v),
                                        estimatedDays: isNaN(v) ? undefined : Math.max(0, v) 
                                    });
                                }}
                                placeholder={isMilestone ? "0" : "e.g. 3"}
                                className="bg-black/30 border-white/10 h-9 text-xs"
                                disabled={isMilestone}
                                title={isMilestone ? "Milestones have zero duration" : "Estimated duration for Gantt scheduling"}
                            />
                        </div>
                        {isMilestone ? (
                            <div className="flex items-center gap-3 pt-5">
                                <Switch
                                    id={`pause-${index}`}
                                    checked={blueprint.pauseAtMilestone ?? false}
                                    onCheckedChange={v => set({ pauseAtMilestone: v })}
                                />
                                <Label htmlFor={`pause-${index}`} className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                                    Pause for approval
                                </Label>
                            </div>
                        ) : <div />}
                    </div>

                    {/* Scaffold Feature Pack Selection Palette */}
                    <div className="pt-2">
                        <ScaffoldPackPalette
                            selectedPacks={(blueprint as any).scaffoldPacks ?? []}
                            onSelectPack={packId => {
                                const current = (blueprint as any).scaffoldPacks ?? [];
                                if (!current.includes(packId)) set({ scaffoldPacks: [...current, packId] } as any);
                            }}
                            onRemovePack={packId => {
                                const current: string[] = (blueprint as any).scaffoldPacks ?? [];
                                set({ scaffoldPacks: current.filter(p => p !== packId) } as any);
                            }}
                        />
                    </div>

                    {/* Dependencies */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                <GitBranch className="w-3 h-3" /> Dependencies
                            </Label>
                            <Button type="button" variant="ghost" size="sm" onClick={addDep} className="h-6 text-[10px] px-2">
                                <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                        </div>
                        {(blueprint.dependencies ?? []).length === 0 && (
                            <p className="text-[10px] text-muted-foreground/50 italic pl-1">No dependencies — runs immediately on cycle start.</p>
                        )}
                        {(blueprint.dependencies ?? []).map((dep, di) => (
                            <div key={di} className="grid grid-cols-[1fr_1fr_80px_24px] gap-2 items-center">
                                <Select
                                    value={dep.blueprintName}
                                    onValueChange={v => updateDep(di, { blueprintName: v })}
                                >
                                    <SelectTrigger className="bg-black/30 border-white/10 h-8 text-xs">
                                        <SelectValue placeholder="Depends on…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {otherNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={dep.type}
                                    onValueChange={(v: Dependency["type"]) => updateDep(di, { type: v })}
                                >
                                    <SelectTrigger className="bg-black/30 border-white/10 h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DEP_TYPES.map(dt => <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <OffsetInput
                                    value={dep.offset}
                                    onChange={offset => updateDep(di, { offset })}
                                />
                                <button type="button" title="Remove dependency" onClick={() => removeDep(di)} className="hover:text-red-400 text-muted-foreground">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Branches */}
                    <div className="space-y-2">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                            <ArrowRight className="w-3 h-3" /> Conditional Branches
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                            {(["success", "failure"] as const).map(outcome => (
                                <div key={outcome} className="space-y-1">
                                    <span className={`text-[9px] font-bold uppercase tracking-widest ${outcome === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        On {outcome}
                                    </span>
                                    <Select
                                        value={getBranch(outcome)}
                                        onValueChange={v => setBranch(outcome, v === "_none" ? "" : v)}
                                    >
                                        <SelectTrigger className="bg-black/30 border-white/10 h-8 text-xs">
                                            <SelectValue placeholder="Next mission…" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="_none">— None —</SelectItem>
                                            {otherNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Data contracts */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                <Tags className="w-3 h-3" /> Inputs
                            </Label>
                            <TagInput
                                values={blueprint.inputs ?? []}
                                onChange={v => set({ inputs: v })}
                                placeholder="Type input, press Enter…"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                <Tags className="w-3 h-3" /> Outputs
                            </Label>
                            <TagInput
                                values={blueprint.outputs ?? []}
                                onChange={v => set({ outputs: v })}
                                placeholder="Type output, press Enter…"
                            />
                        </div>
                    </div>

                    {/* Prediction Settings */}
                    {blueprint.type === "prediction" && (
                        <div className="space-y-3 border-t border-white/5 pt-4">
                            <Label className="text-[10px] uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                                <Target className="w-3 h-3" /> Prediction Settings
                            </Label>
                            <div className="space-y-2">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Dataset Source</Label>
                                    <Input
                                        value={blueprint.config?.hf_dataset || ""}
                                        onChange={e => set({ config: { ...blueprint.config, hf_dataset: e.target.value } })}
                                        placeholder="e.g. barklaj/telco-churn"
                                        className="bg-black/30 border-white/10 h-9 text-xs"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Feature Mapping</Label>
                                        <Button 
                                            size="sm" 
                                            variant="ghost" 
                                            className="text-[10px] h-6 px-2 text-primary hover:text-primary/80"
                                            onClick={() => {
                                                let mapping: Record<string, string> = {};
                                                try {
                                                    mapping = JSON.parse(blueprint.config?.feature_mapping_string || "{}");
                                                } catch {}
                                                
                                                let newKey = "new_feature";
                                                let counter = 1;
                                                while (newKey in mapping) {
                                                    newKey = `new_feature_${counter}`;
                                                    counter++;
                                                }
                                                
                                                const newMapping = { ...mapping, [newKey]: "" };
                                                set({ config: { ...blueprint.config, feature_mapping_string: JSON.stringify(newMapping) } });
                                            }}
                                        >
                                            <Plus className="w-3 h-3 mr-1" /> Add Field
                                        </Button>
                                    </div>
                                    
                                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                        {(() => {
                                            let mapping: Record<string, string> = {};
                                            try {
                                                mapping = JSON.parse(blueprint.config?.feature_mapping_string || "{}");
                                            } catch {}
                                            
                                            const entries = Object.entries(mapping);
                                            if (entries.length === 0) {
                                                return (
                                                    <div className="text-[10px] text-muted-foreground/50 italic text-center py-4 border border-dashed border-white/5 rounded-lg">
                                                        No features mapped yet. Click "Add Field".
                                                    </div>
                                                );
                                            }
                                            
                                            return entries.map(([key, val], idx) => (
                                                <div key={idx} className="flex gap-2 items-center group">
                                                    <Input 
                                                        value={key} 
                                                        onChange={e => {
                                                            const newKey = e.target.value;
                                                            if (!newKey) return; // Don't allow empty keys
                                                            const newMapping = { ...mapping };
                                                            delete newMapping[key];
                                                            newMapping[newKey] = val;
                                                            set({ config: { ...blueprint.config, feature_mapping_string: JSON.stringify(newMapping) } });
                                                        }}
                                                        placeholder="Dataset Feature"
                                                        className="bg-black/30 border-white/10 h-8 text-xs flex-1"
                                                    />
                                                    <ArrowRight className="w-3 h-3 text-muted-foreground/40" />
                                                    <Input 
                                                        value={val} 
                                                        onChange={e => {
                                                            const newVal = e.target.value;
                                                            const newMapping = { ...mapping, [key]: newVal };
                                                            set({ config: { ...blueprint.config, feature_mapping_string: JSON.stringify(newMapping) } });
                                                        }}
                                                        placeholder="Model Feature"
                                                        className="bg-black/30 border-white/10 h-8 text-xs flex-1"
                                                    />
                                                    <Button 
                                                        size="icon" 
                                                        variant="ghost" 
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" 
                                                        onClick={() => {
                                                            const newMapping = { ...mapping };
                                                            delete newMapping[key];
                                                            set({ config: { ...blueprint.config, feature_mapping_string: JSON.stringify(newMapping) } });
                                                        }}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Resources */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                <Package className="w-3 h-3" /> Required Resources
                            </Label>
                            <Button type="button" variant="ghost" size="sm" onClick={addResource} className="h-6 text-[10px] px-2">
                                <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                        </div>
                        {(blueprint.resources ?? []).length === 0 && (
                            <p className="text-[10px] text-muted-foreground/50 italic pl-1">No human-provided resources required.</p>
                        )}
                        {(blueprint.resources ?? []).map((res, ri) => (
                            <div key={res.id} className="rounded-xl border border-white/5 bg-black/20 p-3 space-y-2">
                                <div className="grid grid-cols-[1fr_120px_24px] gap-2 items-start">
                                    <Input
                                        value={res.label}
                                        onChange={e => updateResource(ri, { label: e.target.value })}
                                        placeholder="Resource label"
                                        className="h-8 bg-transparent border-white/10 text-xs font-medium"
                                    />
                                    <Select
                                        value={res.type}
                                        onValueChange={(v: ResourceRequirement["type"]) => updateResource(ri, { type: v })}
                                    >
                                        <SelectTrigger className="bg-black/30 border-white/10 h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {RESOURCE_TYPES.map(rt => (
                                                <SelectItem key={rt.value} value={rt.value}>
                                                    <span className="flex items-center gap-1.5">{rt.icon}{rt.label}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <button type="button" title="Remove resource" onClick={() => removeResource(ri)} className="hover:text-red-400 text-muted-foreground mt-1.5">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <Input
                                    value={res.description}
                                    onChange={e => updateResource(ri, { description: e.target.value })}
                                    placeholder="Description for the user…"
                                    className="h-7 bg-transparent border-white/10 text-[11px]"
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// DFS cycle detection — returns set of blueprint names involved in cycles
function detectCircularDeps(blueprints: Blueprint[]): Set<string> {
    const adj = new Map<string, string[]>();
    for (const bp of blueprints) {
        const deps = [
            ...(bp.dependencies ?? []).map(d => d.blueprintName),
            ...(bp.dependsOn ?? []),
        ].filter(Boolean);
        adj.set(bp.name, deps);
    }

    const inCycle = new Set<string>();
    const visited = new Set<string>();
    const stack = new Set<string>();

    function dfs(node: string): boolean {
        if (stack.has(node)) { inCycle.add(node); return true; }
        if (visited.has(node)) return false;
        visited.add(node);
        stack.add(node);
        for (const neighbour of (adj.get(node) ?? [])) {
            if (dfs(neighbour)) inCycle.add(node);
        }
        stack.delete(node);
        return false;
    }

    for (const bp of blueprints) { if (bp.name) dfs(bp.name); }
    return inCycle;
}

export function BlueprintBuilder({ blueprints, onChange, cycleId, onValidation }: BlueprintBuilderProps) {
    const add = () => onChange([...blueprints, { name: "", objective: "", type: "mission" }]);
    const remove = (i: number) => onChange(blueprints.filter((_, idx) => idx !== i));
    const update = (i: number, b: Blueprint) => {
        const updated = blueprints.map((x, idx) => idx === i ? b : x);
        onChange(updated);
        // Clear server validation when blueprints change
        onValidation?.(null);
    };

    const circularNames = detectCircularDeps(blueprints);
    const hasCircular = circularNames.size > 0;

    const [serverValidation, setServerValidation] = useState<BlueprintValidationResult | null>(null);
    const [validating, setValidating] = useState(false);

    const runValidation = async () => {
        if (!cycleId) return;
        setValidating(true);
        try {
            const res = await fetch(`/api/cycles/${cycleId}/blueprints/validate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ blueprints }),
            });
            const result: BlueprintValidationResult = await res.json();
            setServerValidation(result);
            onValidation?.(result);
        } catch {
            // silently skip if offline
        } finally {
            setValidating(false);
        }
    };

    const dragIdx = useRef<number | null>(null);
    const dragOver = useRef<number | null>(null);

    const handleDragStart = (i: number) => { dragIdx.current = i; };
    const handleDragEnter = (i: number) => { dragOver.current = i; };
    const handleDrop = () => {
        const from = dragIdx.current;
        const to = dragOver.current;
        if (from === null || to === null || from === to) return;
        const reordered = [...blueprints];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        onChange(reordered);
        dragIdx.current = null;
        dragOver.current = null;
    };

    return (
        <div className="space-y-3">
            {hasCircular && (
                <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                        <strong>Circular dependency detected</strong> — blueprints {[...circularNames].join(", ")} form a loop.
                        Remove or change the conflicting dependency before saving.
                    </span>
                </div>
            )}
            {blueprints.map((bp, i) => (
                <div
                    key={i}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragEnter={() => handleDragEnter(i)}
                    onDragEnd={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    className="group/drag relative"
                >
                    {/* Drag handle */}
                    <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1 z-10 opacity-0 group-hover/drag:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </div>
                    <div className="pl-5">
                        <BlueprintCard
                            blueprint={bp}
                            index={i}
                            allBlueprints={blueprints}
                            onChange={b => update(i, b)}
                            onRemove={() => remove(i)}
                            canRemove={blueprints.length > 1}
                            hasCircularDep={circularNames.has(bp.name)}
                        />
                    </div>
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                onClick={add}
                className="w-full rounded-xl border-dashed border-white/20 hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-primary"
            >
                <Plus className="w-4 h-4 mr-2" /> Add Mission Blueprint
            </Button>

            {/* Server-side validation results */}
            {cycleId && (
                <div className="space-y-2 pt-1">
                    <Button type="button" variant="ghost" size="sm"
                        onClick={runValidation} disabled={validating || hasCircular}
                        className="w-full rounded-xl text-xs border border-white/10 hover:border-primary/30 h-8">
                        {validating
                            ? <><span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />Validating…</>
                            : <><AlertTriangle className="w-3 h-3 mr-2 text-muted-foreground" />Run Validation Check</>}
                    </Button>
                    {serverValidation && (
                        <div className={`rounded-xl border p-3 space-y-1.5 text-xs ${serverValidation.valid && serverValidation.warnings.length === 0 ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : serverValidation.errors.length > 0 ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                            {serverValidation.valid && serverValidation.warnings.length === 0 ? (
                                <p className="font-bold">✓ All checks passed — blueprints are valid.</p>
                            ) : (
                                <>
                                    {serverValidation.errors.map((e, i) => (
                                        <p key={i} className="text-red-400 flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{e}</p>
                                    ))}
                                    {serverValidation.warnings.map((w, i) => (
                                        <p key={i} className="text-amber-400 flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{w}</p>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
