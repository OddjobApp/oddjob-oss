import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { NodeScriptConfig } from "@shared/schema/index.js";

interface NodeScriptJobConfigProps {
    config: NodeScriptConfig;
    onChange: (config: NodeScriptConfig) => void;
}

export default function NodeScriptJobConfig({ config, onChange }: NodeScriptJobConfigProps) {
    const [newItemKey, setNewItemKey] = useState("");
    const [newItemValue, setNewItemValue] = useState("");

    const inputs = config.inputs || {};

    const addInput = () => {
        if (!newItemKey || !newItemValue) return;

        onChange({
            ...config,
            inputs: {
                ...inputs,
                [newItemKey]: newItemValue
            }
        });

        setNewItemKey("");
        setNewItemValue("");
    };

    const removeInput = (key: string) => {
        const current = { ...inputs };
        delete current[key];
        onChange({
            ...config,
            inputs: current
        });
    };

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label>Script Content</Label>
                <Textarea
                    value={config.script}
                    onChange={(e) => onChange({ ...config, script: e.target.value })}
                    className="font-mono min-h-[300px]"
                    placeholder="// Write your JavaScript/Node.js code here..."
                />
                <p className="text-sm text-muted-foreground">
                    Write standard JavaScript. Use `await` for async operations.
                    Context variables: `inputs`, `console`, `fetch`.
                    Return a value to set it as the step output.
                </p>
            </div>

            <div className="space-y-4">
                <Label>Input Mapping</Label>
                <div className="text-sm text-muted-foreground mb-2">
                    Map pipeline variables to `inputs` available in your script.
                </div>

                {/* Existing Inputs */}
                <div className="space-y-2">
                    {Object.entries(inputs).map(([key, value]) => (
                        <div key={key} className="flex gap-2 items-center">
                            <div className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono">
                                inputs.{key}
                            </div>
                            <div className="flex-[2] px-3 py-2 rounded border text-sm font-mono truncate" title={String(value)}>
                                {String(value)}
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeInput(key)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>

                {/* Add New Input */}
                <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                        <span className="text-xs font-medium">Input Name</span>
                        <Input
                            placeholder="e.g. userId"
                            value={newItemKey}
                            onChange={(e) => setNewItemKey(e.target.value)}
                        />
                    </div>
                    <div className="flex-[2] space-y-1">
                        <span className="text-xs font-medium">Value (Variable)</span>
                        <Input
                            placeholder="e.g. {{step.1.output.id}}"
                            value={newItemValue}
                            onChange={(e) => setNewItemValue(e.target.value)}
                        />
                    </div>
                    <Button type="button" onClick={addInput} disabled={!newItemKey || !newItemValue}>
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                    type="number"
                    value={config.timeoutMs || ""}
                    onChange={(e) => onChange({ ...config, timeoutMs: parseInt(e.target.value) || 5000 })}
                    placeholder="5000"
                />
                <p className="text-sm text-muted-foreground">
                    Execution time limit in milliseconds.
                </p>
            </div>
        </div>
    );
}
