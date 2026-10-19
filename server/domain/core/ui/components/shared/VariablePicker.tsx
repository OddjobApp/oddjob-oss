import React, { useState } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@domain-ui/core/ui/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@domain-ui/core/ui/components/ui/command';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Braces, Copy, Check, Hash, Repeat, Zap } from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { VariableInfo, VariableCategory } from '@shared/utils/variableDiscovery';

interface VariablePickerProps {
    /** Variables - can be strings (legacy) or VariableInfo objects */
    variables: (string | VariableInfo)[];
    onSelect?: (variable: string) => void;
    children?: React.ReactNode;
    /** Show preview values */
    showPreview?: boolean;
}

/**
 * Get icon for variable category
 */
function getCategoryIcon(category?: VariableCategory) {
    if (!category) return <Braces className="w-3 h-3" />;
    switch (category) {
        case 'step':
            return <Hash className="w-3 h-3" />;
        case 'pipeline':
            return <Braces className="w-3 h-3" />;
        case 'item':
            return <Repeat className="w-3 h-3" />;
        case 'event':
            return <Zap className="w-3 h-3" />;
        default:
            return <Braces className="w-3 h-3" />;
    }
}

/**
 * Get color classes for variable category
 */
function getCategoryColor(category?: VariableCategory): string {
    if (!category) return 'bg-muted text-foreground';
    switch (category) {
        case 'step':
            return 'bg-blue-100 text-blue-700';
        case 'pipeline':
            return 'bg-purple-100 text-purple-700';
        case 'item':
            return 'bg-green-100 text-green-700';
        case 'event':
            return 'bg-orange-100 text-orange-700';
        default:
            return 'bg-muted text-foreground';
    }
}

/**
 * Normalize variable to VariableInfo format
 */
function normalizeVariable(v: string | VariableInfo): VariableInfo {
    if (typeof v === 'string') {
        return {
            name: v,
            shortName: v.replace(/^\{\{|\}\}$/g, ''),
            category: 'custom',
        };
    }
    return v;
}

export default function VariablePicker({
    variables,
    onSelect,
    children,
    showPreview = false,
    open: controlledOpen,
    onOpenChange: setControlledOpen
}: VariablePickerProps & { open?: boolean, onOpenChange?: (open: boolean) => void }) {
    const [internalOpen, setInternalOpen] = useState(false);
    const { toast } = useToast();

    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = (newOpen: boolean) => {
        if (isControlled && setControlledOpen) {
            setControlledOpen(newOpen);
        }
        if (!isControlled) {
            setInternalOpen(newOpen);
        }
    };

    // Normalize all variables
    const normalizedVariables = variables.map(normalizeVariable);

    const handleSelect = (variable: VariableInfo) => {
        if (onSelect) {
            onSelect(variable.name);
        } else {
            navigator.clipboard.writeText(variable.name);
            toast({ title: "Copied!", description: `${variable.name} copied to clipboard.` });
        }
        setOpen(false);
    };

    const buttonText = onSelect ? "Insert Variable" : "Copy Variable";

    return (
        <Popover open={open} onOpenChange={setOpen} modal={true}>
            <PopoverTrigger asChild>
                {children ? children : (
                    <Button variant="outline" size="sm" className="h-8 gap-2 border-dashed">
                        <Braces className="w-3.5 h-3.5" />
                        <span>{buttonText}</span>
                    </Button>
                )}
            </PopoverTrigger>
            <PopoverContent className="p-0 z-popover w-80" align="start">
                <Command>
                    <CommandInput placeholder="Search variables..." />
                    <CommandList>
                        <CommandEmpty>No variables found.</CommandEmpty>
                        <CommandGroup heading="Available Variables">
                            {normalizedVariables.map((variable) => (
                                <CommandItem
                                    key={variable.name}
                                    value={variable.name}
                                    onSelect={() => handleSelect(variable)}
                                    className="cursor-pointer"
                                >
                                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    "h-5 px-1.5 text-[10px] font-normal gap-1",
                                                    getCategoryColor(variable.category)
                                                )}
                                            >
                                                {getCategoryIcon(variable.category)}
                                            </Badge>
                                            <code className="font-mono text-xs truncate flex-1">
                                                {variable.shortName}
                                            </code>
                                            {onSelect ? (
                                                <Check className="w-3 h-3 opacity-50 shrink-0" />
                                            ) : (
                                                <Copy className="w-3 h-3 opacity-50 shrink-0" />
                                            )}
                                        </div>
                                        {variable.description && (
                                            <span className="text-xs text-muted-foreground truncate pl-7">
                                                {variable.description}
                                            </span>
                                        )}
                                        {showPreview && variable.preview && (
                                            <span className="text-xs text-green-600 font-mono truncate pl-7">
                                                = {variable.preview}
                                            </span>
                                        )}
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


