import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { MultiSelect } from "@domain-ui/core/ui/components/ui/multi-select";
import { Search, X, Check, Database, Book, Activity, FileText } from "lucide-react";

interface AgentKnowledgeConfigProps {
    config: any;
    updateConfig: (key: string, value: any) => void;
    isEditing: boolean;
    fieldMapping?: {
        topicIds?: string;
        datasetIds?: string;
        pipelineIds?: string;
        templateIds?: string;
    };
}

export default function AgentKnowledgeConfig({ 
    config, 
    updateConfig, 
    isEditing,
    fieldMapping = {
        topicIds: 'topicIds',
        datasetIds: 'datasetIds',
        pipelineIds: 'pipelineIds',
        templateIds: 'templateIds'
    }
}: AgentKnowledgeConfigProps) {
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });
    const { data: datasetsData }: any = useQuery({ queryKey: ["/api/datasets"] });
    const { data: pipelinesData }: any = useQuery({ queryKey: ["/api/pipelines"] });
    const { data: templatesData }: any = useQuery({ queryKey: ["/api/templates"] });

    const topics = Array.isArray(topicsData?.topics) ? topicsData.topics : [];
    const datasets = Array.isArray(datasetsData) ? datasetsData : Array.isArray(datasetsData?.datasets) ? datasetsData.datasets : [];
    const pipelines = Array.isArray(pipelinesData) ? pipelinesData : Array.isArray(pipelinesData?.pipelines) ? pipelinesData.pipelines : [];
    const templates = Array.isArray(templatesData) ? templatesData : Array.isArray(templatesData?.templates) ? templatesData.templates : [];

    const MultiSelect = ({ 
        label, 
        icon: Icon,
        placeholder, 
        options, 
        selectedIds, 
        onToggle,
        isEditing,
        description,
        colorClass
    }: { 
        label: string; 
        icon: any;
        placeholder: string; 
        options: { id: string | number; name: string }[]; 
        selectedIds: (string | number)[]; 
        onToggle: (id: string | number) => void;
        isEditing: boolean;
        description: string;
        colorClass: string;
    }) => {
        const [search, setSearch] = useState("");
        const filtered = options.filter(o => o.name && o.name.toLowerCase().includes(search.toLowerCase()));
        
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
                            <Icon className={cn("w-3.5 h-3.5", colorClass)} />
                            {label}
                        </Label>
                        <p className="text-[10px] text-muted-foreground leading-relaxed max-w-md">{description}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-primary/20 bg-primary/5">
                        {selectedIds.length} SELECTED
                    </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder={placeholder}
                                className="h-9 pl-8 text-xs bg-muted/40 border-border/50 rounded-xl"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                disabled={!isEditing}
                                title={`Search ${label}`}
                            />
                        </div>
                        <ScrollArea className="h-[120px] rounded-xl border border-border/50 bg-muted/20">
                            <div className="p-2 space-y-1">
                                {filtered.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground text-center py-4">No results found</p>
                                ) : (
                                    filtered.map(opt => {
                                        const isSelected = selectedIds.includes(opt.id) || selectedIds.includes(String(opt.id)) || selectedIds.includes(Number(opt.id));
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => onToggle(opt.id)}
                                                disabled={!isEditing}
                                                className={cn(
                                                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all",
                                                    isSelected 
                                                        ? "bg-primary/10 text-primary font-bold shadow-sm"
                                                        : "hover:bg-foreground/5 opacity-70 hover:opacity-100"
                                                )}
                                            >
                                                <span className="truncate">{opt.name}</span>
                                                {isSelected && <Check className="w-3 h-3 shrink-0" />}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    <div className="p-4 rounded-xl border border-dashed border-border/50 bg-primary/5 min-h-[120px]">
                        <Label className="text-[9px] font-black uppercase tracking-tighter opacity-40 mb-3 block">Perspective Access</Label>
                        {selectedIds.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground italic opacity-50 mt-4 text-center">Unrestricted Access (Global)</p>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {selectedIds.map(id => {
                                    const opt = options.find(o => String(o.id) === String(id));
                                    return (
                                        <Badge 
                                            key={id} 
                                            variant="secondary" 
                                            className={cn("text-[8px] gap-1 pl-2 h-5 border-foreground/10 shadow-sm transition-all animate-in zoom-in-50 font-bold tracking-tight", colorClass)}
                                        >
                                            {opt?.name || id}
                                            {isEditing && (
                                                <button type="button" onClick={() => onToggle(id)} className="hover:text-foreground" title="Remove item">
                                                    <X className="w-2.5 h-2.5" />
                                                </button>
                                            )}
                                        </Badge>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const toggle = (field: string, id: any) => {
        const current = Array.isArray(config[field]) ? config[field] : [];
        const stringId = String(id);
        const numberId = Number(id);
        
        let newValues;
        if (current.includes(id) || current.includes(stringId) || (!isNaN(numberId) && current.includes(numberId))) {
            newValues = current.filter((x: any) => String(x) !== stringId && Number(x) !== numberId);
        } else {
            newValues = [...current, id];
        }
        updateConfig(field, newValues);
    };

    return (
        <div className="space-y-10">
            {fieldMapping.topicIds && (
                <MultiSelect
                    label="Knowledge Topics"
                    icon={Book}
                    placeholder="Search Topics..."
                    options={topics.map((t: any) => ({ id: t.id, name: t.name }))}
                    selectedIds={config[fieldMapping.topicIds] || []}
                    onToggle={(id) => toggle(fieldMapping.topicIds!, id)}
                    isEditing={isEditing}
                    description="Restrict agent's deep-search memory to these specific domain silos."
                    colorClass="text-blue-500 bg-blue-500/10"
                />
            )}

            {fieldMapping.datasetIds && <Separator className="opacity-20" />}

            {fieldMapping.datasetIds && (
                <MultiSelect
                    label="Datasets"
                    icon={Database}
                    placeholder="Search Datasets..."
                    options={datasets.map((d: any) => ({ id: d.id, name: d.name }))}
                    selectedIds={config[fieldMapping.datasetIds] || []}
                    onToggle={(id) => toggle(fieldMapping.datasetIds!, id)}
                    isEditing={isEditing}
                    description="Provide read access to structured data warehouses for analysis."
                    colorClass="text-emerald-500 bg-emerald-500/10"
                />
            )}

            {fieldMapping.pipelineIds && <Separator className="opacity-20" />}

            {fieldMapping.pipelineIds && (
                <MultiSelect
                    label="Reactive Pipelines"
                    icon={Activity}
                    placeholder="Search Pipelines..."
                    options={pipelines.map((p: any) => ({ id: p.id, name: p.name }))}
                    selectedIds={config[fieldMapping.pipelineIds] || []}
                    onToggle={(id) => toggle(fieldMapping.pipelineIds!, id)}
                    isEditing={isEditing}
                    description="Allow agent to trigger automated operational sequences."
                    colorClass="text-purple-500 bg-purple-500/10"
                />
            )}

            {fieldMapping.templateIds && <Separator className="opacity-20" />}

            {fieldMapping.templateIds && (
                <MultiSelect
                    label="Formatting Templates"
                    icon={FileText}
                    placeholder="Search Templates..."
                    options={templates.map((t: any) => ({ id: t.id, name: t.name }))}
                    selectedIds={config[fieldMapping.templateIds] || []}
                    onToggle={(id) => toggle(fieldMapping.templateIds!, id)}
                    isEditing={isEditing}
                    description="Inject business-standard document formats into agent output strategy."
                    colorClass="text-amber-500 bg-amber-500/10"
                />
            )}
        </div>
    );
}

function cn(...classes: any[]) {
    return classes.filter(Boolean).join(" ");
}
