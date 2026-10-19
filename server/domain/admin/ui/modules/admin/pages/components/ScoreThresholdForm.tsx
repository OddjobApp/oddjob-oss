
import React, { useState, useEffect } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Save } from "lucide-react";
import { TriggeredActionConfig } from './TriggeredActionConfig.js';
import { VECTORS } from './ScoringRuleForm.js';

interface ScoreThresholdFormProps {
    initialData?: any;
    defaultVector?: string;
    onSave: (threshold: any) => void;
    onCancel?: () => void;
    isSubmitting?: boolean;
}

export function ScoreThresholdForm({ initialData, defaultVector, onSave, onCancel, isSubmitting = false }: ScoreThresholdFormProps) {
    const [threshold, setThreshold] = useState({
        name: "",
        vector: defaultVector || "S",
        operator: ">=",
        thresholdValue: 10,
        triggeredAction: null as any,
        cooldownMs: 60000,
    });

    const [showActionConfig, setShowActionConfig] = useState(false);

    useEffect(() => {
        if (initialData) {
            setThreshold({
                name: initialData.name || "",
                vector: initialData.vector || defaultVector || "S",
                operator: initialData.operator || ">=",
                thresholdValue: initialData.thresholdValue || 10,
                triggeredAction: initialData.triggeredAction || null,
                cooldownMs: initialData.cooldownMs || 60000,
            });
            if (initialData.triggeredAction) setShowActionConfig(false);
        } else if (defaultVector) {
            setThreshold(prev => ({ ...prev, vector: defaultVector }));
        }
    }, [initialData, defaultVector]);


    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Threshold Name *</Label>
                    <Input
                        value={threshold.name}
                        onChange={(e) => setThreshold({ ...threshold, name: e.target.value })}
                        placeholder="e.g., High Frustration Alert"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Vector</Label>
                    <Select value={threshold.vector} onValueChange={(v) => setThreshold({ ...threshold, vector: v })} disabled={!!defaultVector}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {VECTORS.map(v => (
                                <SelectItem key={v.id} value={v.id}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-3 h-3 rounded-full ${v.color}`} />
                                        {v.name} ({v.id})
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                    <Label>Operator</Label>
                    <Select value={threshold.operator} onValueChange={(v) => setThreshold({ ...threshold, operator: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value=">=">≥ Greater than or equal</SelectItem>
                            <SelectItem value=">">{">"} Greater than</SelectItem>
                            <SelectItem value="<=">≤ Less than or equal</SelectItem>
                            <SelectItem value="<">{"<"} Less than</SelectItem>
                            <SelectItem value="=">=  Equal to</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Threshold Value</Label>
                    <Input
                        type="number"
                        value={threshold.thresholdValue}
                        onChange={(e) => setThreshold({ ...threshold, thresholdValue: parseInt(e.target.value) || 0 })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Cooldown (ms)</Label>
                    <Input
                        type="number"
                        value={threshold.cooldownMs}
                        onChange={(e) => setThreshold({ ...threshold, cooldownMs: parseInt(e.target.value) || 60000 })}
                    />
                </div>
            </div>

            <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                    <Label className="text-base font-semibold">Triggered Action</Label>
                    <Button variant="outline" size="sm" onClick={() => setShowActionConfig(!showActionConfig)}>
                        {showActionConfig ? 'Hide' : 'Configure Action'}
                    </Button>
                </div>

                {showActionConfig && (
                    <TriggeredActionConfig
                        value={threshold.triggeredAction}
                        onChange={(action) => setThreshold({ ...threshold, triggeredAction: action })}
                    />
                )}

                {threshold.triggeredAction && !showActionConfig && (
                    <div className="mt-2 p-2 bg-muted rounded text-sm flex items-center gap-2">
                        <Badge variant="outline">{threshold.triggeredAction.type}</Badge>
                        <span className="text-muted-foreground flex-1 truncate ml-2">
                            {JSON.stringify(threshold.triggeredAction.config)}
                        </span>
                        <Button
                            variant="ghost" size="sm" className="h-6"
                            onClick={() => setThreshold({ ...threshold, triggeredAction: null })}
                        >
                            Clear
                        </Button>
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
                {onCancel && (
                    <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
                        Cancel
                    </Button>
                )}
                <Button onClick={() => onSave(threshold)} disabled={!threshold.name || isSubmitting}>
                    {isSubmitting ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save Threshold</>}
                </Button>
            </div>
        </div>
    );
}
