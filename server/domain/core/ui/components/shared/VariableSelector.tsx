import React from "react";
import { 
    Popover, 
    PopoverContent, 
    PopoverTrigger 
} from "@domain-ui/core/ui/components/ui/popover";
import { 
    Command, 
    CommandEmpty, 
    CommandGroup, 
    CommandInput, 
    CommandItem, 
    CommandList 
} from "@domain-ui/core/ui/components/ui/command";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Braces, ChevronRight, Hash, Type, ToggleLeft } from "lucide-react";
import type { JobOutputSchema } from "@shared/schema/jobs/types";

interface VariableSelectorProps {
    schema?: JobOutputSchema | null;
    onSelect: (variable: string) => void;
    trigger?: React.ReactNode;
}

export function VariableSelector({ schema, onSelect, trigger }: VariableSelectorProps) {
    const [open, setOpen] = React.useState(false);

    const getFields = () => {
        if (!schema?.schemaDef) return [];
        return Object.entries(schema.schemaDef).map(([path, def]: [string, any]) => ({
            path,
            label: def.label || path,
            type: def.type || 'string'
        }));
    };

    const fields = getFields();

    const getIcon = (type: string) => {
        if (type === 'number' || type === 'integer') return <Hash className="w-3 h-3 text-blue-400" />;
        if (type === 'boolean') return <ToggleLeft className="w-3 h-3 text-yellow-400" />;
        return <Type className="w-3 h-3 text-cyan-400" />;
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {trigger || (
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 hover:bg-cyan-500/10 text-cyan-400"
                    >
                        <Braces className="w-4 h-4" />
                    </Button>
                )}
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[240px] bg-background border-cyan-500/30 font-mono shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                <Command className="bg-transparent">
                    <CommandInput 
                        placeholder="Search variables..." 
                        className="h-9 border-none focus:ring-0 text-[11px] uppercase tracking-wider"
                    />
                    <CommandList>
                        <CommandEmpty className="py-6 text-center text-[10px] text-muted-foreground uppercase">No variables found</CommandEmpty>
                        <CommandGroup heading={<span className="text-[9px] uppercase tracking-[0.2em] text-cyan-500/50">Available Fields</span>}>
                            {fields.map((field) => (
                                <CommandItem
                                    key={field.path}
                                    onSelect={() => {
                                        onSelect(field.path);
                                        setOpen(false);
                                    }}
                                    className="flex items-center justify-between text-[11px] py-2 cursor-pointer hover:bg-cyan-500/10"
                                >
                                    <div className="flex items-center gap-2">
                                        {getIcon(field.type)}
                                        <span className="font-bold text-foreground uppercase tracking-tight">{field.label}</span>
                                    </div>
                                    <div className="text-[8px] text-muted-foreground font-mono">
                                        {field.path}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
