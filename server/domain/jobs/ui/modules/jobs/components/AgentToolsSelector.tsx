import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import "./jobs-components.css";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { 
    Search, 
    Plus, 
    Sparkles, 
    Check, 
    X,
    Hammer,
    Wrench,
    ShieldAlert,
    Cpu,
    Globe,
    Mail,
    FileCode
} from "lucide-react";

interface AgentToolsSelectorProps {
    config: any;
    updateConfig: (key: string, value: any) => void;
    isEditing: boolean;
}

export default function AgentToolsSelector({ config, updateConfig, isEditing }: AgentToolsSelectorProps) {
    const progressRef = React.useRef<HTMLDivElement>(null);
    const { data: toolsData = [] }: any = useQuery({
        queryKey: ["/api/tools"],
    });

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");

    const toggleTool = (toolName: string) => {
        const currentTools = config.allowedTools || [];
        if (currentTools.includes(toolName)) {
            updateConfig('allowedTools', currentTools.filter((t: string) => t !== toolName));
        } else {
            updateConfig('allowedTools', [...currentTools, toolName]);
        }
    };

    const toggleCategory = (category: string) => {
        const currentTools = config.allowedTools || [];
        const categoryTools = toolsData?.filter((t: any) => t.category === category).map((t: any) => t.name) || [];
        
        const allSelected = categoryTools.every((t: string) => currentTools.includes(t));
        
        if (allSelected) {
            updateConfig('allowedTools', currentTools.filter((t: string) => !categoryTools.includes(t)));
        } else {
            updateConfig('allowedTools', [...new Set([...currentTools, ...categoryTools])]);
        }
    };

    const categories: string[] = ["all", ...(new Set((toolsData || []).map((t: any) => t.category)) as Set<string>)];
    
    const filteredTools = (toolsData || []).filter((t: any) => {
        const matchesSearch = (t.label || t.name).toLowerCase().includes(searchQuery.toLowerCase()) ||
                            t.description?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === "all" || t.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const progressWidth = Math.min(((config.allowedTools || []).length / 10) * 100, 100);

    React.useEffect(() => {
        if (progressRef.current) {
            progressRef.current.style.width = `${progressWidth}%`;
        }
    }, [progressWidth]);

    const recommendations = [
        { toolName: "web_search", totalCalls: 150, successRate: 0.95, icon: Globe },
        { toolName: "code_interpreter", totalCalls: 200, successRate: 0.92, icon: FileCode },
        { toolName: "gmail_send", totalCalls: 100, successRate: 0.88, icon: Mail },
    ];

    const getCategoryIcon = (cat: string) => {
        switch(cat.toLowerCase()) {
            case 'admin': return <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />;
            case 'dev': return <Cpu className="w-3.5 h-3.5 text-blue-500" />;
            case 'ops': return <Wrench className="w-3.5 h-3.5 text-amber-500" />;
            default: return <Hammer className="w-3.5 h-3.5 text-primary" />;
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Hammer className="w-3.5 h-3.5 text-primary" />
                                Active Capabilities
                            </Label>
                            <p className="text-[10px] text-muted-foreground opacity-60">Provision system-level tools for mission execution.</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <Badge variant="outline" className="text-[10px] font-mono border-primary/20 bg-primary/5 text-primary px-3 h-6 shadow-[0_0_15px_-5px_rgba(var(--primary),0.3)]">
                                <Sparkles className="w-3 h-3 mr-1.5 animate-pulse" />
                                {(config.allowedTools || []).length} ARMED
                            </Badge>
                            <div className="w-24 h-1 bg-muted/30 rounded-full overflow-hidden border border-foreground/5">
                                <div 
                                    ref={progressRef}
                                    className="h-full bg-primary transition-all duration-1000 shadow-[0_0_8px_rgba(var(--primary),0.5)]" 
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search tool matrix..."
                                className="pl-8 h-10 text-xs bg-muted/40 border-border/50 rounded-xl"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                disabled={!isEditing}
                            />
                        </div>
                        <select
                            className="h-10 px-3 text-xs border border-border/50 rounded-xl bg-muted/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            disabled={!isEditing}
                            title="Select Division"
                        >
                            {categories.map((cat: string) => (
                                <option key={cat} value={cat}>
                                    {cat === "all" ? "All Divisions" : cat.toUpperCase()}
                                </option>
                            ))}
                        </select>
                    </div>

                    {recommendations.length > 0 && (
                        <div className="bg-primary/5 border border-primary/10 p-4 rounded-2xl space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 opacity-70">
                                <Sparkles className="w-3 h-3 text-primary animate-pulse" />
                                Strategic Recommendations
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {recommendations.map((r) => {
                                    const alreadySelected = (config.allowedTools || []).includes(r.toolName);
                                    const toolDef = toolsData?.find((t: any) => t.name === r.toolName);
                                    const Icon = r.icon;
                                    return (
                                        <Button
                                            key={r.toolName}
                                            type="button"
                                            variant={alreadySelected ? "secondary" : "outline"}
                                            size="sm"
                                            className={cn(
                                                "h-8 text-[11px] rounded-lg border-border/50 transition-all",
                                                alreadySelected ? "opacity-50 grayscale" : "hover:scale-105 active:scale-95 shadow-sm"
                                            )}
                                            onClick={() => !alreadySelected && toggleTool(r.toolName)}
                                            disabled={alreadySelected || !isEditing}
                                        >
                                            <Icon className="w-3 h-3 mr-2 opacity-70" />
                                            {toolDef?.label || r.toolName}
                                            {!alreadySelected && (
                                                <Badge variant="outline" className="ml-2 text-[8px] h-3.5 px-1 border-primary/20 text-primary">
                                                    {Math.round(r.successRate * 100)}% REL
                                                </Badge>
                                            )}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Toolbox Hierarchy</Label>
                    <div className="space-y-3 h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                        {categories.filter(c => c !== 'all').map((category) => {
                            const categoryTools = filteredTools.filter((t: any) => t.category === category);
                            if (categoryTools.length === 0) return null;

                            const allSelected = categoryTools.every((t: any) => (config.allowedTools || []).includes(t.name));

                            return (
                                <div key={category} className="space-y-2 group">
                                    <div className="flex items-center gap-2 p-1.5 rounded-lg border border-transparent hover:bg-muted/30 transition-all">
                                        <Checkbox
                                            id={`cat-${category}`}
                                            checked={allSelected}
                                            onCheckedChange={() => toggleCategory(category)}
                                            disabled={!isEditing}
                                            className="rounded-md"
                                        />
                                        <div className="flex flex-1 items-center gap-2 cursor-pointer" onClick={() => isEditing && toggleCategory(category)}>
                                            {getCategoryIcon(category)}
                                            <Label className="text-[10px] font-black uppercase tracking-widest cursor-pointer group-hover:text-primary transition-colors">
                                                {category} Division
                                            </Label>
                                        </div>
                                        <Badge variant="outline" className="text-[9px] h-4 opacity-50">
                                            {categoryTools.length}
                                        </Badge>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 gap-1.5 pl-7">
                                        {categoryTools.map((tool: any) => {
                                            const isSelected = (config.allowedTools || []).includes(tool.name);
                                            return (
                                                <div 
                                                    key={tool.name} 
                                                    className={cn(
                                                        "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer",
                                                        isSelected 
                                                            ? "bg-primary/5 border-primary/20 shadow-sm" 
                                                            : "bg-muted/10 border-border/30 opacity-60 hover:opacity-100 hover:bg-muted/20"
                                                    )}
                                                    onClick={() => isEditing && toggleTool(tool.name)}
                                                >
                                                    <Checkbox
                                                        id={`tool-${tool.name}`}
                                                        checked={isSelected}
                                                        onCheckedChange={() => toggleTool(tool.name)}
                                                        disabled={!isEditing}
                                                        className="mt-0.5 rounded"
                                                    />
                                                    <div className="flex-1 min-w-0 space-y-0.5">
                                                        <Label 
                                                            htmlFor={`tool-${tool.name}`} 
                                                            className="text-[11px] font-bold cursor-pointer block"
                                                        >
                                                            {tool.label || tool.name}
                                                        </Label>
                                                        <p className="text-[10px] text-muted-foreground leading-tight italic line-clamp-1">
                                                            {tool.description}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <Separator className="opacity-10 mt-4" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                <p className="text-[10px] text-amber-500/80 font-medium leading-relaxed">
                    <span className="font-black uppercase mr-1">Security Advisory:</span>
                    Arming agents with 'Admin' or 'File' capabilities increases the mission blast radius. Ensure the configured supervision protocol matches the risk profile.
                </p>
            </div>
        </div>
    );
}

function cn(...classes: any[]) {
    return classes.filter(Boolean).join(" ");
}
