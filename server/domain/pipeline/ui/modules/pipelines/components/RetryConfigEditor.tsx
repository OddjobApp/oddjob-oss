import React, { useState, useCallback } from 'react';
import { RotateCcw, Clock, AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Slider } from '@domain-ui/core/ui/components/ui/slider';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@domain-ui/core/ui/components/ui/collapsible';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { cn } from '@/lib/utils';

interface RetryConfig {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
    retryOnCategories: string[];
}

interface RetryConfigEditorProps {
    config: RetryConfig | null;
    onChange: (config: RetryConfig | null) => void;
    disabled?: boolean;
}

const ERROR_CATEGORIES = [
    { id: 'rate_limit', label: 'Rate Limit (429)', description: 'API quota exceeded' },
    { id: 'server_error', label: 'Server Error (5xx)', description: 'Remote server issues' },
    { id: 'timeout', label: 'Timeout', description: 'Request took too long' },
    { id: 'network', label: 'Network Error', description: 'Connection failures' },
    { id: 'auth', label: 'Auth Error (401/403)', description: 'Authentication issues' },
];

const DEFAULT_CONFIG: RetryConfig = {
    maxRetries: 3,
    backoffMs: 5000,
    backoffMultiplier: 2,
    retryOnCategories: ['rate_limit', 'server_error', 'timeout'],
};

export function RetryConfigEditor({
    config,
    onChange,
    disabled = false,
}: RetryConfigEditorProps) {
    const [isExpanded, setIsExpanded] = useState(!!config);

    const enabled = !!config;

    const handleToggleEnabled = useCallback(() => {
        if (enabled) {
            onChange(null);
        } else {
            onChange(DEFAULT_CONFIG);
        }
    }, [enabled, onChange]);

    const handleChange = useCallback(<K extends keyof RetryConfig>(
        field: K,
        value: RetryConfig[K]
    ) => {
        if (!config) return;
        onChange({ ...config, [field]: value });
    }, [config, onChange]);

    const handleCategoryToggle = useCallback((categoryId: string, checked: boolean) => {
        if (!config) return;

        const categories = checked
            ? [...config.retryOnCategories, categoryId]
            : config.retryOnCategories.filter(c => c !== categoryId);

        onChange({ ...config, retryOnCategories: categories });
    }, [config, onChange]);

    const formatBackoff = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    const getBackoffSequence = (): string[] => {
        if (!config) return [];
        const sequence: string[] = [];
        for (let i = 0; i < config.maxRetries; i++) {
            const delay = config.backoffMs * Math.pow(config.backoffMultiplier, i);
            sequence.push(formatBackoff(delay));
        }
        return sequence;
    };

    return (
        <Card className={cn("border", enabled ? "border-blue-200 bg-blue-50/30" : "border-dashed")}>
            <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <RotateCcw className={cn("h-4 w-4", enabled ? "text-blue-600" : "text-muted-foreground")} />
                        <CardTitle className="text-sm font-medium">Auto-Retry</CardTitle>
                        {enabled && (
                            <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700 border-blue-200">
                                {config.maxRetries} retries
                            </Badge>
                        )}
                    </div>
                    <Switch
                        checked={enabled}
                        onCheckedChange={handleToggleEnabled}
                        disabled={disabled}
                    />
                </div>
                <CardDescription className="text-xs mt-1">
                    Automatically retry failed steps with exponential backoff
                </CardDescription>
            </CardHeader>

            {enabled && config && (
                <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                    <CollapsibleTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-8 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-100"
                        >
                            {isExpanded ? 'Hide Settings' : 'Show Settings'}
                        </Button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                        <CardContent className="pt-0 px-4 pb-4 space-y-4">
                            {/* Max Retries */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs font-medium">Max Retries</Label>
                                    <span className="text-sm font-medium text-blue-600">{config.maxRetries}</span>
                                </div>
                                <Slider
                                    value={[config.maxRetries]}
                                    onValueChange={([value]) => handleChange('maxRetries', value)}
                                    min={1}
                                    max={10}
                                    step={1}
                                    disabled={disabled}
                                    className="w-full"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Maximum number of retry attempts
                                </p>
                            </div>

                            {/* Initial Backoff */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs font-medium">Initial Delay</Label>
                                    <span className="text-sm font-medium text-blue-600">
                                        {formatBackoff(config.backoffMs)}
                                    </span>
                                </div>
                                <Slider
                                    value={[config.backoffMs]}
                                    onValueChange={([value]) => handleChange('backoffMs', value)}
                                    min={1000}
                                    max={60000}
                                    step={1000}
                                    disabled={disabled}
                                    className="w-full"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Wait time before first retry
                                </p>
                            </div>

                            {/* Backoff Multiplier */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs font-medium">Backoff Multiplier</Label>
                                    <span className="text-sm font-medium text-blue-600">{config.backoffMultiplier}x</span>
                                </div>
                                <Slider
                                    value={[config.backoffMultiplier]}
                                    onValueChange={([value]) => handleChange('backoffMultiplier', value)}
                                    min={1}
                                    max={5}
                                    step={0.5}
                                    disabled={disabled}
                                    className="w-full"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Multiply delay by this factor for each retry
                                </p>
                            </div>

                            {/* Backoff Preview */}
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded p-2">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>Retry delays: {getBackoffSequence().join(' → ')}</span>
                            </div>

                            {/* Retry Categories */}
                            <div className="space-y-2">
                                <Label className="text-xs font-medium">Retry On</Label>
                                <div className="space-y-2">
                                    {ERROR_CATEGORIES.map((category) => (
                                        <label
                                            key={category.id}
                                            className={cn(
                                                "flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors",
                                                config.retryOnCategories.includes(category.id)
                                                    ? "bg-blue-50 border-blue-200"
                                                    : "bg-card border-border hover:bg-muted"
                                            )}
                                        >
                                            <Checkbox
                                                checked={config.retryOnCategories.includes(category.id)}
                                                onCheckedChange={(checked) => handleCategoryToggle(category.id, !!checked)}
                                                disabled={disabled}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm font-medium">{category.label}</span>
                                                <p className="text-[10px] text-muted-foreground">{category.description}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Warning */}
                            {config.retryOnCategories.includes('auth') && (
                                <div className="flex items-start gap-2 p-2 bg-amber-50 rounded border border-amber-200 text-amber-800">
                                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                    <p className="text-xs">
                                        Retrying auth errors may not help if credentials are invalid. Consider checking credentials first.
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </CollapsibleContent>
                </Collapsible>
            )}
        </Card>
    );
}

export default RetryConfigEditor;
