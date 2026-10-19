
import React, { useState, useEffect } from "react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { TRIGGERED_ACTION_TYPES } from "@/lib/ui-constants";

export function TriggeredActionConfig({
    value,
    onChange
}: {
    value: any,
    onChange: (action: any) => void
}) {
    const [actionType, setActionType] = useState(value?.type || "toast");
    const [config, setConfig] = useState(value?.config || {});

    const handleTypeChange = (type: string) => {
        setActionType(type);
        // Reset config based on action type
        const defaultConfigs: Record<string, any> = {
            toast: { title: "", description: "", variant: "default" },
            tooltip: { target: "", message: "", duration: 5000 },
            highlight: { target: "", color: "blue", duration: 5000 },
            modal: { title: "", body: "" },
            confetti: { duration: 3000 },
            navigate: { path: "", splitView: false },
            concierge_prompt: { hint: "", suggestedMessage: "" },
            prefill: { field: "", value: "" },
        };
        setConfig(defaultConfigs[type] || {});
    };

    const updateConfig = (key: string, val: any) => {
        const newConfig = { ...config, [key]: val };
        setConfig(newConfig);
        onChange({ type: actionType, config: newConfig });
    };

    useEffect(() => {
        if (actionType && Object.keys(config).length > 0) {
            onChange({ type: actionType, config });
        }
    }, [actionType, config]);

    return (
        <div className="space-y-4 p-4 border rounded-lg bg-muted dark:bg-card">
            <div className="space-y-2">
                <Label>Action Type</Label>
                <Select value={actionType} onValueChange={handleTypeChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground bg-muted/50">UI Actions</div>
                        {TRIGGERED_ACTION_TYPES.ui.map(a => (
                            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                        ))}
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground bg-muted/50 mt-1">Application Actions</div>
                        {TRIGGERED_ACTION_TYPES.application.map(a => (
                            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Dynamic config fields based on action type */}
            {actionType === 'toast' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Title</Label>
                        <Input value={config.title || ''} onChange={(e) => updateConfig('title', e.target.value)} placeholder="Notification title" />
                    </div>
                    <div className="space-y-2">
                        <Label>Variant</Label>
                        <Select value={config.variant || 'default'} onValueChange={(v) => updateConfig('variant', v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                <SelectItem value="destructive">Destructive</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="col-span-2 space-y-2">
                        <Label>Description</Label>
                        <Textarea value={config.description || ''} onChange={(e) => updateConfig('description', e.target.value)} placeholder="Notification message" />
                    </div>
                </div>
            )}

            {actionType === 'highlight' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Target Selector</Label>
                        <Input value={config.target || ''} onChange={(e) => updateConfig('target', e.target.value)} placeholder="#element-id or .class" />
                    </div>
                    <div className="space-y-2">
                        <Label>Glow Color</Label>
                        <Select value={config.color || 'blue'} onValueChange={(v) => updateConfig('color', v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="blue">Blue</SelectItem>
                                <SelectItem value="green">Green</SelectItem>
                                <SelectItem value="red">Red</SelectItem>
                                <SelectItem value="purple">Purple</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {actionType === 'tooltip' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Target Selector</Label>
                        <Input value={config.target || ''} onChange={(e) => updateConfig('target', e.target.value)} placeholder="#element-id" />
                    </div>
                    <div className="space-y-2">
                        <Label>Duration (ms)</Label>
                        <Input type="number" value={config.duration || 5000} onChange={(e) => updateConfig('duration', parseInt(e.target.value))} />
                    </div>
                    <div className="col-span-2 space-y-2">
                        <Label>Message</Label>
                        <Textarea value={config.message || ''} onChange={(e) => updateConfig('message', e.target.value)} placeholder="Tooltip message" />
                    </div>
                </div>
            )}

            {actionType === 'navigate' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Path</Label>
                        <Input value={config.path || ''} onChange={(e) => updateConfig('path', e.target.value)} placeholder="/dashboard" />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                        <Switch checked={config.splitView || false} onCheckedChange={(v) => updateConfig('splitView', v)} />
                        <Label>Open in new tab</Label>
                    </div>
                </div>
            )}

            {actionType === 'concierge_prompt' && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Context Hint</Label>
                        <Textarea value={config.hint || ''} onChange={(e) => updateConfig('hint', e.target.value)} placeholder="The user appears to be struggling with..." />
                    </div>
                    <div className="space-y-2">
                        <Label>Suggested Message</Label>
                        <Input value={config.suggestedMessage || ''} onChange={(e) => updateConfig('suggestedMessage', e.target.value)} placeholder="Help me with this task" />
                    </div>
                </div>
            )}

            {actionType === 'prefill' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Field Selector</Label>
                        <Input value={config.field || ''} onChange={(e) => updateConfig('field', e.target.value)} placeholder="#field-id" />
                    </div>
                    <div className="space-y-2">
                        <Label>Value</Label>
                        <Input value={config.value || ''} onChange={(e) => updateConfig('value', e.target.value)} placeholder="Prefill value" />
                    </div>
                </div>
            )}

            {actionType === 'modal' && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Modal Title</Label>
                        <Input value={config.title || ''} onChange={(e) => updateConfig('title', e.target.value)} placeholder="Attention" />
                    </div>
                    <div className="space-y-2">
                        <Label>Modal Body</Label>
                        <Textarea value={config.body || ''} onChange={(e) => updateConfig('body', e.target.value)} placeholder="Modal content..." />
                    </div>
                </div>
            )}

            {actionType === 'confetti' && (
                <div className="space-y-2">
                    <Label>Duration (ms)</Label>
                    <Input type="number" value={config.duration || 3000} onChange={(e) => updateConfig('duration', parseInt(e.target.value))} />
                </div>
            )}
        </div>
    );
}
