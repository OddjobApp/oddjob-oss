import React, { useState, useEffect } from "react";
import { 
    Plus, 
    Link2, 
    Unlink, 
    ArrowRight, 
    RefreshCw, 
    Search, 
    Database,
    Zap,
    Binary,
    Terminal,
    Settings2,
    Check
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Field {
    key: string;
    name: string;
    type: string;
}

interface NeuralFieldMapperProps {
    discoveredFields: Field[];
    mappings: Record<string, string>;
    onMappingChange: (newMappings: Record<string, string>) => void;
    platform: string;
}

const INTERNAL_KEY_SUGGESTIONS = [
    "ID", "TITLE", "DESCRIPTION", "STATUS", "PRIORITY", 
    "ASSIGNEE", "REPORTER", "CREATED_AT", "UPDATED_AT", 
    "LABELS", "TAGS", "CATEGORY", "STORY_POINTS", "DUE_DATE"
];

export function NeuralFieldMapper({ 
    discoveredFields, 
    mappings, 
    onMappingChange,
    platform 
}: NeuralFieldMapperProps) {
    const [search, setSearch] = useState("");
    const [isAutoMatching, setIsAutoMatching] = useState(false);

    const handleToggleMapping = (sourceKey: string, sourceName: string) => {
        const newMappings = { ...mappings };
        if (newMappings[sourceKey]) {
            delete newMappings[sourceKey];
        } else {
            // Default target key: UPPER_CASE version of name or key
            let targetKey = sourceKey;
            if (sourceKey.startsWith('customfield_')) {
                targetKey = sourceName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            } else {
                targetKey = sourceKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            }
            newMappings[sourceKey] = targetKey;
        }
        onMappingChange(newMappings);
    };

    const handleUpdateTargetKey = (sourceKey: string, newTargetKey: string) => {
        const newMappings = { ...mappings, [sourceKey]: newTargetKey };
        onMappingChange(newMappings);
    };

    const handleAutoMatch = () => {
        setIsAutoMatching(true);
        setTimeout(() => {
            const newMappings = { ...mappings };
            discoveredFields.forEach(field => {
                const normalizedName = field.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                const bestMatch = INTERNAL_KEY_SUGGESTIONS.find(s => 
                    normalizedName.includes(s) || s.includes(normalizedName)
                );
                
                if (!newMappings[field.key]) {
                    newMappings[field.key] = bestMatch || normalizedName;
                }
            });
            onMappingChange(newMappings);
            setIsAutoMatching(false);
        }, 800);
    };

    const filteredFields = discoveredFields.filter(f => 
        f.name.toLowerCase().includes(search.toLowerCase()) || 
        f.key.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground italic flex items-center">
                        <Binary className="w-4 h-4 mr-3 text-primary" />
                        Parity_Vector Mapper
                    </h4>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">
                        Bind external node attributes to internal knowledge keys.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/20" />
                        <Input 
                            placeholder="FILTER VECTORS..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9 w-48 bg-foreground/[0.03] border-foreground/5 rounded-xl pl-9 text-[9px] font-black uppercase tracking-widest italic text-foreground"
                        />
                    </div>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={handleAutoMatch}
                        disabled={isAutoMatching || discoveredFields.length === 0}
                        className="h-9 px-4 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-[9px] font-black uppercase tracking-widest italic border border-primary/20"
                    >
                        <Zap className={cn("w-3 h-3 mr-2", isAutoMatching && "animate-pulse")} />
                        Auto_Match
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                <AnimatePresence mode="popLayout">
                    {filteredFields.map((field) => {
                        const isMapped = !!mappings[field.key];
                        return (
                            <motion.div 
                                key={field.key}
                                layout
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className={cn(
                                    "group flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300",
                                    isMapped 
                                        ? "bg-primary/5 border-primary/30" 
                                        : "bg-foreground/[0.02] border-foreground/5 hover:border-foreground/10"
                                )}
                            >
                                {/* Source Side */}
                                <div className="flex-1 flex items-center gap-4">
                                    <div className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                                        isMapped ? "bg-primary/20 text-primary" : "bg-foreground/5 text-foreground/40"
                                    )}>
                                        <Database className="w-4 h-4" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="text-[10px] font-black uppercase italic tracking-widest text-foreground/80">
                                            {field.name}
                                        </div>
                                        <div className="text-[8px] font-mono font-bold text-foreground/30 uppercase tracking-tighter">
                                            {field.key} • {field.type}
                                        </div>
                                    </div>
                                </div>

                                {/* Connection Pulse */}
                                <div className="flex items-center">
                                    <div className={cn(
                                        "w-12 h-[1px] relative",
                                        isMapped ? "bg-primary/50" : "bg-foreground/10"
                                    )}>
                                        {isMapped && (
                                            <motion.div 
                                                animate={{ x: [0, 48] }}
                                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                                className="absolute top-[-2px] left-0 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]"
                                            />
                                        )}
                                    </div>
                                    <ArrowRight className={cn("w-3 h-3 mx-2", isMapped ? "text-primary" : "text-foreground/10")} />
                                </div>

                                {/* Destination Side */}
                                <div className="flex-1">
                                    {isMapped ? (
                                        <div className="flex items-center gap-2">
                                            <Input 
                                                value={mappings[field.key]}
                                                onChange={(e) => handleUpdateTargetKey(field.key, e.target.value.toUpperCase())}
                                                className="h-10 bg-background/40 border-primary/20 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest italic text-primary"
                                            />
                                            <Button 
                                                variant="ghost" 
                                                size="sm"
                                                onClick={() => handleToggleMapping(field.key, field.name)}
                                                className="h-10 w-10 p-0 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20"
                                            >
                                                <Unlink className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button 
                                            variant="ghost" 
                                            className="w-full h-10 border border-dashed border-foreground/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-foreground/20 hover:text-foreground/60 hover:border-foreground/20 transition-all"
                                            onClick={() => handleToggleMapping(field.key, field.name)}
                                        >
                                            <Plus className="w-3.5 h-3.5 mr-2" />
                                            Initialize_Binding
                                        </Button>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Terminal className="w-4 h-4 text-foreground/20" />
                    <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 italic">
                        {Object.keys(mappings).length} of {discoveredFields.length} vectors mapped to internal store.
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-foreground/10 text-[8px] text-foreground/40 uppercase">Mode: Visual_Parity</Badge>
                </div>
            </div>
        </div>
    );
}
