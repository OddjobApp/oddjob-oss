import React from 'react';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Plus, X, Link as LinkIcon } from 'lucide-react';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';

interface MultiInputMappingProps {
    value: Record<string, string>;
    onChange: (value: Record<string, string>) => void;
    availableVariables: string[];
    jobParameters?: string[]; // If known from Job Schema
}

export const MultiInputMapping: React.FC<MultiInputMappingProps> = ({
    value = {},
    onChange,
    availableVariables = [],
    jobParameters = []
}) => {
    const [newParam, setNewParam] = React.useState('');
    const [newSource, setNewSource] = React.useState('');

    const handleAdd = () => {
        if (!newParam || !newSource) return;
        onChange({
            ...value,
            [newParam]: newSource
        });
        setNewParam('');
        setNewSource('');
    };

    const handleRemove = (key: string) => {
        const next = { ...value };
        delete next[key];
        onChange(next);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                    <LinkIcon className="w-3 h-3" /> Input Mapping
                </Label>
            </div>

            <div className="space-y-2">
                {Object.entries(value).map(([param, source]) => (
                    <div key={param} className="flex items-center gap-2 text-sm border p-2 rounded-md bg-muted/20">
                        <Badge variant="outline" className="font-mono text-xs">{param}</Badge>
                        <span className="text-muted-foreground text-xs">←</span>
                        <code className="bg-muted px-1 py-0.5 rounded text-xs flex-1 truncate" title={source}>
                            {source}
                        </code>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(param)}>
                            <X className="w-3 h-3" />
                        </Button>
                    </div>
                ))}

                {Object.keys(value).length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-2 border border-dashed rounded-md">
                        No explicit input mappings defined.
                    </div>
                )}
            </div>

            <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                    <Label className="text-[10px]">Job Parameter</Label>
                    {jobParameters.length > 0 ? (
                        <Select value={newParam} onValueChange={setNewParam}>
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select parameter" />
                            </SelectTrigger>
                            <SelectContent>
                                {jobParameters.map(p => (
                                    <SelectItem key={p} value={p}>{p}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            placeholder="e.g. prompt"
                            value={newParam}
                            onChange={e => setNewParam(e.target.value)}
                            className="h-8 text-xs"
                        />
                    )}
                </div>

                <div className="flex-1 space-y-1">
                    <Label className="text-[10px]">Source Variable</Label>
                    <Select value={newSource} onValueChange={setNewSource}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableVariables.map(v => (
                                <SelectItem key={v} value={v}>{v}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <Button size="sm" variant="secondary" className="h-8 px-2" onClick={handleAdd} disabled={!newParam || !newSource}>
                    <Plus className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
};
