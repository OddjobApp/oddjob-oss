/**
 * RepeaterJobConfig
 * 
 * Configuration component for Repeater job type.
 */

import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import type { RepeaterConfig } from '@shared/schema/index.js';

interface RepeaterJobConfigProps {
    config: RepeaterConfig;
    onChange: (config: RepeaterConfig) => void;
}

export default function RepeaterJobConfig({ config, onChange }: RepeaterJobConfigProps) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Input Source *</Label>
                <Input
                    value={config.inputSource || ''}
                    onChange={(e) => onChange({ ...config, inputSource: e.target.value })}
                    placeholder="{{step.0.output.items}}"
                    className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                    Variable reference to an array (e.g., {'{{step.0.output.items}}'})
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Item Variable Name</Label>
                    <Input
                        value={config.itemVariable || 'item'}
                        onChange={(e) => onChange({ ...config, itemVariable: e.target.value })}
                        placeholder="item"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Max Iterations</Label>
                    <Input
                        type="number"
                        value={config.maxIterations || ''}
                        onChange={(e) => onChange({ ...config, maxIterations: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="No limit"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Execution Mode</Label>
                    <Select
                        value={config.executionMode || 'sequential'}
                        onValueChange={(value) => onChange({ ...config, executionMode: value as 'sequential' | 'parallel' })}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="sequential">Sequential</SelectItem>
                            <SelectItem value="parallel">Parallel</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Concurrency</Label>
                    <Input
                        type="number"
                        value={config.concurrency || 5}
                        onChange={(e) => onChange({ ...config, concurrency: parseInt(e.target.value) })}
                        min={1}
                        max={50}
                        disabled={config.executionMode !== 'parallel'}
                    />
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div>
                    <Label>Stop on Error</Label>
                    <p className="text-xs text-muted-foreground">Stop iteration if any item fails</p>
                </div>
                <Switch
                    checked={config.stopOnError || false}
                    onCheckedChange={(checked) => onChange({ ...config, stopOnError: checked })}
                />
            </div>
        </div>
    );
}
