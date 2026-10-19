import React, { useCallback } from 'react';
import { Plus, GripVertical, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { cn } from '@/lib/utils';

export interface KeyValuePair {
    key: string;
    value: string;
    enabled?: boolean;
    description?: string;
}

interface KeyValueEditorProps {
    pairs: KeyValuePair[];
    onChange: (pairs: KeyValuePair[]) => void;
    addButtonText?: string;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    showDescription?: boolean;
    allowDisable?: boolean;
    disabled?: boolean;
}

export function KeyValueEditor({
    pairs,
    onChange,
    addButtonText = 'Add',
    keyPlaceholder = 'Key',
    valuePlaceholder = 'Value',
    showDescription = false,
    allowDisable = true,
    disabled = false,
}: KeyValueEditorProps) {

    const handleKeyChange = useCallback((index: number, key: string) => {
        const newPairs = [...pairs];
        newPairs[index] = { ...newPairs[index], key };
        onChange(newPairs);
    }, [pairs, onChange]);

    const handleValueChange = useCallback((index: number, value: string) => {
        const newPairs = [...pairs];
        newPairs[index] = { ...newPairs[index], value };
        onChange(newPairs);
    }, [pairs, onChange]);

    const handleToggleEnabled = useCallback((index: number) => {
        const newPairs = [...pairs];
        newPairs[index] = { ...newPairs[index], enabled: !newPairs[index].enabled };
        onChange(newPairs);
    }, [pairs, onChange]);

    const handleRemove = useCallback((index: number) => {
        const newPairs = pairs.filter((_, i) => i !== index);
        onChange(newPairs);
    }, [pairs, onChange]);

    const handleAdd = useCallback(() => {
        onChange([...pairs, { key: '', value: '', enabled: true }]);
    }, [pairs, onChange]);

    // Auto-add row when typing in the last row
    const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Tab' && !e.shiftKey && index === pairs.length - 1) {
            const lastPair = pairs[index];
            if (lastPair.key || lastPair.value) {
                e.preventDefault();
                handleAdd();
                // Focus will move to new row automatically
            }
        }
    }, [pairs, handleAdd]);

    return (
        <div className="space-y-2">
            {/* Header */}
            <div className="grid gap-2" style={{ gridTemplateColumns: allowDisable ? '24px 1fr 1fr 24px' : '1fr 1fr 24px' }}>
                {allowDisable && <div />}
                <span className="text-xs font-medium text-muted-foreground">{keyPlaceholder}</span>
                <span className="text-xs font-medium text-muted-foreground">{valuePlaceholder}</span>
                <div />
            </div>

            {/* Rows */}
            {pairs.map((pair, index) => (
                <div
                    key={index}
                    className={cn(
                        "grid gap-2 items-center",
                        pair.enabled === false && "opacity-50"
                    )}
                    style={{ gridTemplateColumns: allowDisable ? '24px 1fr 1fr 24px' : '1fr 1fr 24px' }}
                >
                    {allowDisable && (
                        <button
                            type="button"
                            onClick={() => handleToggleEnabled(index)}
                            className="p-0.5 text-muted-foreground hover:text-foreground"
                            disabled={disabled}
                            title={pair.enabled !== false ? 'Disable' : 'Enable'}
                        >
                            {pair.enabled !== false ? (
                                <ToggleRight className="h-4 w-4 text-green-600" />
                            ) : (
                                <ToggleLeft className="h-4 w-4" />
                            )}
                        </button>
                    )}

                    <Input
                        value={pair.key}
                        onChange={(e) => handleKeyChange(index, e.target.value)}
                        placeholder={keyPlaceholder}
                        className="h-8 text-sm font-mono"
                        disabled={disabled || pair.enabled === false}
                    />

                    <Input
                        value={pair.value}
                        onChange={(e) => handleValueChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        placeholder={valuePlaceholder}
                        className="h-8 text-sm font-mono"
                        disabled={disabled || pair.enabled === false}
                    />

                    <button
                        type="button"
                        onClick={() => handleRemove(index)}
                        className="p-0.5 text-muted-foreground hover:text-destructive"
                        disabled={disabled}
                        title="Remove"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ))}

            {/* Add Button */}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAdd}
                disabled={disabled}
                className="h-8 text-xs gap-1"
            >
                <Plus className="h-3 w-3" />
                {addButtonText}
            </Button>
        </div>
    );
}

export default KeyValueEditor;
