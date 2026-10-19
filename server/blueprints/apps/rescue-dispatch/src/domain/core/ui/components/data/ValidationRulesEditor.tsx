
import { useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Plus, Trash2, Save, Wand2 } from "lucide-react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { DatasetValidationRules, ValidationRule } from "@shared/schema/datasets";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ValidationRulesEditorProps {
    datasetId: number;
    initialRules?: DatasetValidationRules;
    onSave: (rules: DatasetValidationRules) => void;
    isSaving?: boolean;
}

type RuleType = 'regex' | 'number_range' | 'email' | 'url' | 'enum' | 'custom' | 'required';

export function ValidationRulesEditor({ datasetId, initialRules = {}, onSave, isSaving }: ValidationRulesEditorProps) {
    const [rules, setRules] = useState<DatasetValidationRules>(initialRules);
    const [selectedColumn, setSelectedColumn] = useState<string | null>(null);

    // Fetch available keys/columns from the dataset
    const { data: keys = [] } = useQuery<{ key: string; type: string }[]>({
        queryKey: [`/api/datasets/${datasetId}/keys`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/datasets/${datasetId}/keys`);
            return res.json();
        }
    });

    // Merge keys from rules if they don't exist in fetched keys (e.g. new columns)
    const allColumns = Array.from(new Set([...keys.map(k => k.key), ...Object.keys(rules)]));

    const handleAddRule = (column: string) => {
        const newRule: ValidationRule = { type: 'required', severity: 'error' };
        setRules(prev => ({
            ...prev,
            [column]: [...(prev[column] || []), newRule]
        }));
    };

    const handleRemoveRule = (column: string, index: number) => {
        setRules(prev => {
            const newRules = { ...prev };
            newRules[column] = newRules[column].filter((_, i) => i !== index);
            if (newRules[column].length === 0) {
                delete newRules[column];
            }
            return newRules;
        });
    };

    const handleRuleChange = (column: string, index: number, field: keyof ValidationRule, value: any) => {
        setRules(prev => {
            const columnRules = [...(prev[column] || [])];
            columnRules[index] = { ...columnRules[index], [field]: value };
            // Reset params if type changes
            if (field === 'type') {
                columnRules[index].params = undefined;
            }
            return { ...prev, [column]: columnRules };
        });
    };

    const handleRuleParamChange = (column: string, index: number, paramKey: string, value: any) => {
        setRules(prev => {
            const columnRules = [...(prev[column] || [])];
            const currentParams = columnRules[index].params || {};
            columnRules[index] = {
                ...columnRules[index],
                params: { ...currentParams, [paramKey]: value }
            };
            return { ...prev, [column]: columnRules };
        });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
            {/* Column List */}
            <Card className="md:col-span-1 flex flex-col h-full">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Columns</CardTitle>
                    <CardDescription>Select a column to Add rules</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                    <ScrollArea className="h-full px-4">
                        <div className="space-y-1 py-2">
                            {allColumns.map(col => {
                                const ruleCount = rules[col]?.length || 0;
                                return (
                                    <Button
                                        key={col}
                                        variant={selectedColumn === col ? "secondary" : "ghost"}
                                        className="w-full justify-between font-normal"
                                        onClick={() => setSelectedColumn(col)}
                                    >
                                        <span className="truncate">{col}</span>
                                        {ruleCount > 0 && <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200">{ruleCount}</Badge>}
                                    </Button>
                                );
                            })}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* Rules Editor */}
            <Card className="md:col-span-2 flex flex-col h-full">
                <CardHeader className="flex flex-row items-center justify-between pb-3 border-b">
                    <div>
                        <CardTitle className="text-sm font-medium">
                            {selectedColumn ? `Rules for "${selectedColumn}"` : "Values Validation"}
                        </CardTitle>
                        <CardDescription>
                            {selectedColumn ? "Configure constraints for this column" : "Select a column to begin"}
                        </CardDescription>
                    </div>
                    <div className="flex gap-2">
                        {selectedColumn && (
                            <Button size="sm" variant="outline" onClick={() => handleAddRule(selectedColumn)}>
                                <Plus className="h-4 w-4 mr-1" /> Add Rule
                            </Button>
                        )}
                        <Button size="sm" onClick={() => onSave(rules)} disabled={isSaving}>
                            {isSaving ? "Saving..." : <><Save className="h-4 w-4 mr-1" /> Save Changes</>}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto p-6 bg-slate-50/50">
                    {!selectedColumn ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <Wand2 className="h-12 w-12 mb-4 opacity-20" />
                            <p>Select a column to configure validation rules.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {(!rules[selectedColumn] || rules[selectedColumn].length === 0) && (
                                <p className="text-sm text-muted-foreground text-center py-8 opacity-60">No rules defined for this column.</p>
                            )}
                            {rules[selectedColumn]?.map((rule, idx) => (
                                <Card key={idx} className="bg-white shadow-sm border-slate-200">
                                    <CardContent className="p-4 space-y-4">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="grid grid-cols-2 gap-4 flex-1">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Type</Label>
                                                    <Select value={rule.type} onValueChange={(v: RuleType) => handleRuleChange(selectedColumn, idx, 'type', v)}>
                                                        <SelectTrigger className="h-8">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="required">Required</SelectItem>
                                                            <SelectItem value="email">Email</SelectItem>
                                                            <SelectItem value="url">URL</SelectItem>
                                                            <SelectItem value="number_range">Number Range</SelectItem>
                                                            <SelectItem value="regex">Regex Pattern</SelectItem>
                                                            <SelectItem value="enum">Allowed Values</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Severity</Label>
                                                    <Select value={rule.severity} onValueChange={(v: any) => handleRuleChange(selectedColumn, idx, 'severity', v)}>
                                                        <SelectTrigger className="h-8">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="error">Error (Block)</SelectItem>
                                                            <SelectItem value="warning">Warning</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleRemoveRule(selectedColumn, idx)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        {/* Dynamic Params Inputs */}
                                        {rule.type === 'regex' && (
                                            <div className="space-y-1">
                                                <Label className="text-xs">Regex Pattern</Label>
                                                <Input
                                                    className="h-8 font-mono text-xs"
                                                    placeholder="^[A-Z]+$"
                                                    value={rule.params?.pattern || ''}
                                                    onChange={e => handleRuleParamChange(selectedColumn, idx, 'pattern', e.target.value)}
                                                />
                                            </div>
                                        )}
                                        {rule.type === 'number_range' && (
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Min</Label>
                                                    <Input type="number" className="h-8" value={rule.params?.min || ''} onChange={e => handleRuleParamChange(selectedColumn, idx, 'min', parseFloat(e.target.value))} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Max</Label>
                                                    <Input type="number" className="h-8" value={rule.params?.max || ''} onChange={e => handleRuleParamChange(selectedColumn, idx, 'max', parseFloat(e.target.value))} />
                                                </div>
                                            </div>
                                        )}
                                        {rule.type === 'enum' && (
                                            <div className="space-y-1">
                                                <Label className="text-xs">Allowed Values (comma separated)</Label>
                                                <Input
                                                    className="h-8"
                                                    placeholder="A, B, C"
                                                    value={Array.isArray(rule.params?.values) ? rule.params.values.join(', ') : ''}
                                                    onChange={e => handleRuleParamChange(selectedColumn, idx, 'values', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                                                />
                                            </div>
                                        )}

                                        <div className="space-y-1">
                                            <Label className="text-xs">Custom Error Message</Label>
                                            <Input
                                                className="h-8"
                                                placeholder="Value is invalid"
                                                value={rule.message || ''}
                                                onChange={e => handleRuleChange(selectedColumn, idx, 'message', e.target.value)}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
