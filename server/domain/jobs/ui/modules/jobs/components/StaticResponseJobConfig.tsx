import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Trash2, Plus } from 'lucide-react';

interface StaticResponseJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function StaticResponseJobConfig({ config, onChange }: StaticResponseJobConfigProps) {
    const staticConfig = config || {};

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold">Static Response Configuration</h3>

            <div className="space-y-2">
                <Label htmlFor="static-content">Response Content</Label>
                <Textarea
                    id="static-content"
                    placeholder="Hello, this is a static response!"
                    value={staticConfig.content || ''}
                    onChange={(e) => onChange({ ...staticConfig, content: e.target.value })}
                    rows={4}
                    className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                    Supports mustache templates like {"{{pipeline.var}}"} or {"{{step.0.output}}"}.
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="required-vars">Required Input Variables (Optional)</Label>
                <Input
                    id="required-vars"
                    placeholder="e.g. user_id, ticket.id"
                    value={(staticConfig.requiredVariables || []).join(', ')}
                    onChange={(e) => {
                        const vars = e.target.value.split(',')
                            .map(v => v.trim())
                            .filter(v => v.length > 0);
                        onChange({ ...staticConfig, requiredVariables: vars });
                    }}
                />
                <p className="text-xs text-muted-foreground">
                    Comma-separated list of variables that MUST be present in context for this step to run.
                </p>
            </div>

            <div className="space-y-2">
                <Label>Output Variable Mapping (Optional)</Label>
                <div className="border rounded-md p-2 space-y-2">
                    {Object.entries(staticConfig.outputMapping || {}).map(([key, value], index) => (
                        <div key={index} className="flex gap-2 items-center">
                            <Input
                                placeholder="Output Key"
                                value={key}
                                onChange={(e) => {
                                    const newMapping = { ...(staticConfig.outputMapping || {}) };
                                    delete newMapping[key];
                                    newMapping[e.target.value] = value as string;
                                    onChange({ ...staticConfig, outputMapping: newMapping });
                                }}
                                className="w-1/3"
                            />
                            <span className="text-muted-foreground">=</span>
                            <Input
                                placeholder="Value or {{template}}"
                                value={value as string}
                                onChange={(e) => {
                                    const newMapping = { ...(staticConfig.outputMapping || {}) };
                                    newMapping[key] = e.target.value;
                                    onChange({ ...staticConfig, outputMapping: newMapping });
                                }}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    const newMapping = { ...(staticConfig.outputMapping || {}) };
                                    delete newMapping[key];
                                    onChange({ ...staticConfig, outputMapping: newMapping });
                                }}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const newMapping = { ...(staticConfig.outputMapping || {}) };
                            newMapping[`var_${Object.keys(newMapping).length + 1}`] = '';
                            onChange({ ...staticConfig, outputMapping: newMapping });
                        }}
                    >
                        <Plus className="h-3 w-3 mr-2" /> Add Output Variable
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Define variables to be exported to the pipeline context. You can use templates in values.
                </p>
            </div>
        </div>
    );
}
