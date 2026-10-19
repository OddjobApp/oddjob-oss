import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@domain-ui/core/ui/components/ui/command';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Braces, Hash, Repeat, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVariableAutocomplete } from '@domain-ui/core/ui/hooks/useVariableAutocomplete';
import type { VariableInfo, VariableCategory } from '@shared/utils/variableDiscovery';

interface VariableAutocompleteProps {
    /** Current input value */
    value: string;
    /** Change handler */
    onChange: (value: string) => void;
    /** Available variables */
    variables: VariableInfo[];
    /** Whether autocomplete is enabled */
    enabled?: boolean;
    /** Children (usually a Textarea or Input) */
    children: React.ReactElement;
}

export interface VariableAutocompleteRef {
    /** Force open the autocomplete at current position */
    open: () => void;
    /** Close the autocomplete */
    close: () => void;
}

/**
 * Get icon for variable category
 */
function getCategoryIcon(category: VariableCategory) {
    switch (category) {
        case 'step':
            return <Hash className="h-3 w-3" />;
        case 'pipeline':
            return <Braces className="h-3 w-3" />;
        case 'item':
            return <Repeat className="h-3 w-3" />;
        case 'event':
            return <Zap className="h-3 w-3" />;
        default:
            return <Braces className="h-3 w-3" />;
    }
}

/**
 * Get color classes for variable category
 */
function getCategoryColor(category: VariableCategory): string {
    switch (category) {
        case 'step':
            return 'bg-blue-100 text-blue-700 border-blue-200';
        case 'pipeline':
            return 'bg-purple-100 text-purple-700 border-purple-200';
        case 'item':
            return 'bg-green-100 text-green-700 border-green-200';
        case 'event':
            return 'bg-orange-100 text-orange-700 border-orange-200';
        default:
            return 'bg-muted text-foreground border-border';
    }
}

export const VariableAutocomplete = forwardRef<VariableAutocompleteRef, VariableAutocompleteProps>(
    function VariableAutocomplete({ value, onChange, variables, enabled = true, children }, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
        const [cursorPosition, setCursorPosition] = useState(0);
        const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

        const {
            isOpen,
            filteredVariables,
            selectedIndex,
            triggerInfo,
            handleKeyDown,
            insertVariable,
            close,
        } = useVariableAutocomplete({
            value,
            cursorPosition,
            variables,
            enabled,
        });

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            open: () => {
                // Could trigger autocomplete programmatically
            },
            close,
        }), [close]);

        // Track cursor position
        const handleSelectionChange = useCallback(() => {
            const input = inputRef.current;
            if (input) {
                setCursorPosition(input.selectionStart || 0);
            }
        }, []);

        // Calculate menu position based on cursor
        useEffect(() => {
            if (!isOpen || !inputRef.current || !triggerInfo) return;

            const input = inputRef.current;
            const container = containerRef.current;
            if (!container) return;

            // Create a temporary element to measure text position
            const measureSpan = document.createElement('span');
            measureSpan.style.cssText = window.getComputedStyle(input).cssText;
            measureSpan.style.visibility = 'hidden';
            measureSpan.style.position = 'absolute';
            measureSpan.style.whiteSpace = 'pre-wrap';
            measureSpan.style.wordWrap = 'break-word';
            measureSpan.style.width = `${input.clientWidth}px`;
            measureSpan.textContent = value.substring(0, triggerInfo.start);

            document.body.appendChild(measureSpan);

            const inputRect = input.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Approximate position (this is a simplified approach)
            const lineHeight = parseInt(window.getComputedStyle(input).lineHeight) || 20;
            const lines = value.substring(0, triggerInfo.start).split('\n').length;

            setMenuPosition({
                top: Math.min(lines * lineHeight + 24, input.clientHeight),
                left: 0,
            });

            document.body.removeChild(measureSpan);
        }, [isOpen, triggerInfo, value]);

        // Handle keyboard events
        const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'Tab' || e.key === 'Enter') {
                const selected = filteredVariables[selectedIndex];
                if (selected) {
                    e.preventDefault();
                    const { newValue, newCursorPosition } = insertVariable(selected);
                    onChange(newValue);

                    // Set cursor position after React update
                    setTimeout(() => {
                        if (inputRef.current) {
                            inputRef.current.selectionStart = newCursorPosition;
                            inputRef.current.selectionEnd = newCursorPosition;
                        }
                    }, 0);
                    return;
                }
            }

            handleKeyDown(e);
        }, [isOpen, handleKeyDown, filteredVariables, selectedIndex, insertVariable, onChange]);

        // Handle variable selection from menu
        const handleSelectVariable = useCallback((variable: VariableInfo) => {
            const { newValue, newCursorPosition } = insertVariable(variable);
            onChange(newValue);

            // Focus back to input and set cursor
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.selectionStart = newCursorPosition;
                    inputRef.current.selectionEnd = newCursorPosition;
                }
            }, 0);
        }, [insertVariable, onChange]);

        // Clone children to add event handlers
        const enhancedChildren = (() => {
            return React.cloneElement(children, {
                ref: (el: HTMLTextAreaElement | HTMLInputElement | null) => {
                    inputRef.current = el;
                    // Forward ref if children has one
                    const childRef = (children as any).ref;
                    if (typeof childRef === 'function') childRef(el);
                    else if (childRef) childRef.current = el;
                },
                onKeyDown: (e: React.KeyboardEvent) => {
                    handleInputKeyDown(e);
                    children.props.onKeyDown?.(e);
                },
                onSelect: (e: React.SyntheticEvent) => {
                    handleSelectionChange();
                    children.props.onSelect?.(e);
                },
                onClick: (e: React.MouseEvent) => {
                    handleSelectionChange();
                    children.props.onClick?.(e);
                },
                onInput: (e: React.FormEvent) => {
                    handleSelectionChange();
                    children.props.onInput?.(e);
                },
            });
        })();

        return (
            <div ref={containerRef} className="relative">
                {enhancedChildren}

                {/* Autocomplete dropdown */}
                {isOpen && filteredVariables.length > 0 && (
                    <div
                        className="absolute z-50 w-80 bg-popover border rounded-md shadow-lg"
                        style={{
                            top: menuPosition.top,
                            left: menuPosition.left,
                        }}
                    >
                        <Command className="bg-transparent">
                            <CommandList className="max-h-64">
                                <CommandEmpty>No matching variables</CommandEmpty>
                                <CommandGroup heading="Available Variables">
                                    {filteredVariables.map((variable, index) => (
                                        <CommandItem
                                            key={variable.name}
                                            value={variable.name}
                                            onSelect={() => handleSelectVariable(variable)}
                                            className={cn(
                                                "cursor-pointer",
                                                index === selectedIndex && "bg-accent"
                                            )}
                                        >
                                            <div className="flex flex-col gap-1 flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <Badge
                                                        variant="outline"
                                                        className={cn("h-5 px-1.5 text-[10px] font-normal gap-1", getCategoryColor(variable.category))}
                                                    >
                                                        {getCategoryIcon(variable.category)}
                                                        {variable.category}
                                                    </Badge>
                                                    <code className="font-mono text-xs truncate">
                                                        {variable.shortName}
                                                    </code>
                                                </div>
                                                {variable.description && (
                                                    <span className="text-xs text-muted-foreground truncate">
                                                        {variable.description}
                                                    </span>
                                                )}
                                                {variable.preview && (
                                                    <span className="text-xs text-green-600 font-mono truncate">
                                                        = {variable.preview}
                                                    </span>
                                                )}
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </div>
                )}
            </div>
        );
    }
);

export default VariableAutocomplete;

