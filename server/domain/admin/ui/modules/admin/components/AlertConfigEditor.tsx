import React, { useState, useCallback } from 'react';
import { Bell, Mail, MessageSquare, Plus, Trash2, TestTube, Check, X, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@domain-ui/core/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface AlertConfig {
    id?: number;
    name: string;
    enabled: boolean;
    errorCategories: string[];
    minOccurrences: number;
    timeWindowMinutes: number;
    pipelineIds: number[] | null;
    notifyVia: ('slack' | 'email')[];
    slackWebhookUrl: string;
    slackChannel: string;
    emailRecipients: string[];
    cooldownMinutes: number;
}

interface AlertConfigEditorProps {
    configs: AlertConfig[];
    onSave: (config: AlertConfig) => Promise<void>;
    onDelete: (id: number) => Promise<void>;
    onRefresh: () => void;
}

const ERROR_CATEGORIES = [
    { id: 'auth', label: 'Authentication (401/403)' },
    { id: 'rate_limit', label: 'Rate Limit (429)' },
    { id: 'server_error', label: 'Server Error (5xx)' },
    { id: 'timeout', label: 'Timeout' },
    { id: 'network', label: 'Network Error' },
];

const DEFAULT_CONFIG: AlertConfig = {
    name: 'New Alert',
    enabled: true,
    errorCategories: ['rate_limit', 'server_error'],
    minOccurrences: 3,
    timeWindowMinutes: 60,
    pipelineIds: null,
    notifyVia: ['slack'],
    slackWebhookUrl: '',
    slackChannel: '',
    emailRecipients: [],
    cooldownMinutes: 30,
};

export function AlertConfigEditor({
    configs,
    onSave,
    onDelete,
    onRefresh,
}: AlertConfigEditorProps) {
    const [editingConfig, setEditingConfig] = useState<AlertConfig | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [testing, setTesting] = useState(false);
    const { toast } = useToast();

    const handleEdit = useCallback((config: AlertConfig) => {
        setEditingConfig({ ...config });
        setIsOpen(true);
    }, []);

    const handleCreate = useCallback(() => {
        setEditingConfig({ ...DEFAULT_CONFIG });
        setIsOpen(true);
    }, []);

    const handleSave = useCallback(async () => {
        if (!editingConfig) return;

        try {
            await onSave(editingConfig);
            setIsOpen(false);
            setEditingConfig(null);
            toast({ title: 'Alert saved', description: editingConfig.name });
        } catch (err: any) {
            toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
        }
    }, [editingConfig, onSave, toast]);

    const handleTestSlack = useCallback(async () => {
        if (!editingConfig?.slackWebhookUrl) return;

        setTesting(true);
        try {
            const response = await apiRequest('POST', '/api/alerts/test-slack', {
                webhookUrl: editingConfig.slackWebhookUrl,
            }) as unknown as { success: boolean };

            if (response.success) {
                toast({ title: 'Test successful', description: 'Check your Slack channel' });
            } else {
                toast({ title: 'Test failed', description: 'Webhook returned an error', variant: 'destructive' });
            }
        } catch (err: any) {
            toast({ title: 'Test failed', description: err.message, variant: 'destructive' });
        } finally {
            setTesting(false);
        }
    }, [editingConfig, toast]);

    const updateConfig = useCallback(<K extends keyof AlertConfig>(field: K, value: AlertConfig[K]) => {
        if (!editingConfig) return;
        setEditingConfig({ ...editingConfig, [field]: value });
    }, [editingConfig]);

    const toggleCategory = useCallback((categoryId: string) => {
        if (!editingConfig) return;
        const categories = editingConfig.errorCategories.includes(categoryId)
            ? editingConfig.errorCategories.filter(c => c !== categoryId)
            : [...editingConfig.errorCategories, categoryId];
        setEditingConfig({ ...editingConfig, errorCategories: categories });
    }, [editingConfig]);

    const toggleNotifyVia = useCallback((channel: 'slack' | 'email') => {
        if (!editingConfig) return;
        const channels = editingConfig.notifyVia.includes(channel)
            ? editingConfig.notifyVia.filter(c => c !== channel)
            : [...editingConfig.notifyVia, channel];
        setEditingConfig({ ...editingConfig, notifyVia: channels });
    }, [editingConfig]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Bell className="h-5 w-5 text-amber-600" />
                        Error Alerts
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Get notified when errors exceed thresholds
                    </p>
                </div>
                <Button onClick={handleCreate} size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New Alert
                </Button>
            </div>

            {configs.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center">
                        <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="font-medium text-lg mb-2">No Alerts Configured</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Create an alert to get notified about recurring errors
                        </p>
                        <Button onClick={handleCreate}>
                            <Plus className="h-4 w-4 mr-1" />
                            Create Alert
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {configs.map((config) => (
                        <Card
                            key={config.id}
                            className={cn(
                                "border cursor-pointer hover:border-amber-300 transition-colors",
                                config.enabled ? "bg-card" : "bg-muted"
                            )}
                            onClick={() => handleEdit(config)}
                        >
                            <CardContent className="py-3 px-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Bell className={cn("h-4 w-4", config.enabled ? "text-amber-600" : "text-muted-foreground")} />
                                        <div>
                                            <h3 className="font-medium text-sm">{config.name}</h3>
                                            <p className="text-xs text-muted-foreground">
                                                {config.minOccurrences}+ errors in {config.timeWindowMinutes}min
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {config.notifyVia.includes('slack') && (
                                            <Badge variant="outline" className="text-xs">
                                                <MessageSquare className="h-3 w-3 mr-1" />
                                                Slack
                                            </Badge>
                                        )}
                                        {config.notifyVia.includes('email') && (
                                            <Badge variant="outline" className="text-xs">
                                                <Mail className="h-3 w-3 mr-1" />
                                                Email
                                            </Badge>
                                        )}
                                        {!config.enabled && (
                                            <Badge variant="secondary" className="text-xs">Disabled</Badge>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Edit Dialog */}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingConfig?.id ? 'Edit Alert' : 'New Alert'}</DialogTitle>
                    </DialogHeader>

                    {editingConfig && (
                        <div className="space-y-4">
                            {/* Name & Enabled */}
                            <div className="flex items-center gap-4">
                                <div className="flex-1">
                                    <Label>Alert Name</Label>
                                    <Input
                                        value={editingConfig.name}
                                        onChange={(e) => updateConfig('name', e.target.value)}
                                    />
                                </div>
                                <div className="pt-6">
                                    <Switch
                                        checked={editingConfig.enabled}
                                        onCheckedChange={(checked) => updateConfig('enabled', checked)}
                                    />
                                </div>
                            </div>

                            {/* Trigger Conditions */}
                            <div className="space-y-3 p-3 bg-muted rounded-lg">
                                <Label className="text-xs font-medium text-foreground">Trigger Conditions</Label>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-xs">Minimum Occurrences</Label>
                                        <Input
                                            type="number"
                                            value={editingConfig.minOccurrences}
                                            onChange={(e) => updateConfig('minOccurrences', parseInt(e.target.value, 10))}
                                            min={1}
                                            max={100}
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">Time Window (minutes)</Label>
                                        <Input
                                            type="number"
                                            value={editingConfig.timeWindowMinutes}
                                            onChange={(e) => updateConfig('timeWindowMinutes', parseInt(e.target.value, 10))}
                                            min={5}
                                            max={1440}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <Label className="text-xs">Error Categories</Label>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        {ERROR_CATEGORIES.map((cat) => (
                                            <label
                                                key={cat.id}
                                                className={cn(
                                                    "flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer border transition-colors",
                                                    editingConfig.errorCategories.includes(cat.id)
                                                        ? "bg-amber-100 border-amber-300 text-amber-800"
                                                        : "bg-card border-border hover:bg-muted"
                                                )}
                                            >
                                                <Checkbox
                                                    checked={editingConfig.errorCategories.includes(cat.id)}
                                                    onCheckedChange={() => toggleCategory(cat.id)}
                                                    className="h-3 w-3"
                                                />
                                                {cat.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Notification Channels */}
                            <div className="space-y-3">
                                <Label>Notification Channels</Label>

                                {/* Slack */}
                                <div className={cn(
                                    "p-3 rounded-lg border",
                                    editingConfig.notifyVia.includes('slack') ? "bg-purple-50 border-purple-200" : "bg-muted"
                                )}>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox
                                            checked={editingConfig.notifyVia.includes('slack')}
                                            onCheckedChange={() => toggleNotifyVia('slack')}
                                        />
                                        <MessageSquare className="h-4 w-4 text-purple-600" />
                                        <span className="font-medium text-sm">Slack</span>
                                    </label>

                                    {editingConfig.notifyVia.includes('slack') && (
                                        <div className="mt-3 space-y-2">
                                            <div>
                                                <Label className="text-xs">Webhook URL</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        value={editingConfig.slackWebhookUrl}
                                                        onChange={(e) => updateConfig('slackWebhookUrl', e.target.value)}
                                                        placeholder="https://hooks.slack.com/services/..."
                                                        className="flex-1"
                                                    />
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleTestSlack}
                                                        disabled={!editingConfig.slackWebhookUrl || testing}
                                                    >
                                                        <TestTube className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                            <div>
                                                <Label className="text-xs">Channel (optional)</Label>
                                                <Input
                                                    value={editingConfig.slackChannel}
                                                    onChange={(e) => updateConfig('slackChannel', e.target.value)}
                                                    placeholder="#alerts"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Email */}
                                <div className={cn(
                                    "p-3 rounded-lg border",
                                    editingConfig.notifyVia.includes('email') ? "bg-blue-50 border-blue-200" : "bg-muted"
                                )}>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox
                                            checked={editingConfig.notifyVia.includes('email')}
                                            onCheckedChange={() => toggleNotifyVia('email')}
                                        />
                                        <Mail className="h-4 w-4 text-blue-600" />
                                        <span className="font-medium text-sm">Email</span>
                                    </label>

                                    {editingConfig.notifyVia.includes('email') && (
                                        <div className="mt-3">
                                            <Label className="text-xs">Recipients (comma-separated)</Label>
                                            <Input
                                                value={editingConfig.emailRecipients.join(', ')}
                                                onChange={(e) => updateConfig('emailRecipients', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                                placeholder="admin@example.com, team@example.com"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Cooldown */}
                            <div>
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Cooldown Period</Label>
                                    <span className="text-sm font-medium">{editingConfig.cooldownMinutes} min</span>
                                </div>
                                <Slider
                                    value={[editingConfig.cooldownMinutes]}
                                    onValueChange={([value]) => updateConfig('cooldownMinutes', value)}
                                    min={5}
                                    max={240}
                                    step={5}
                                    className="mt-2"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Minimum time between alerts for the same rule
                                </p>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex justify-between">
                        {editingConfig?.id && (
                            <Button
                                variant="ghost"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={async () => {
                                    await onDelete(editingConfig.id!);
                                    setIsOpen(false);
                                }}
                            >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                            </Button>
                        )}
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                            <Button onClick={handleSave}>Save Alert</Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default AlertConfigEditor;

