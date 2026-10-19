/**
 * NotificationPreferences Component
 * 
 * User interface for managing notification preferences.
 * Supports email, Slack, and in-app notification settings.
 */

import { memo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@domain-ui/core/ui/components/ui/select';
import {
    Bell,
    Mail,
    MessageSquare,
    AlertTriangle,
    CheckCircle,
    XCircle,
    Clock,
    Zap,
    Save,
} from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

export type NotificationChannel = 'email' | 'slack' | 'inApp';
export type NotificationEventType = 
    | 'execution_completed'
    | 'execution_failed'
    | 'execution_started'
    | 'schedule_triggered'
    | 'connector_error'
    | 'budget_alert'
    | 'system_maintenance';

export type NotificationFrequency = 'immediate' | 'hourly' | 'daily' | 'weekly';

export interface NotificationPreference {
    eventType: NotificationEventType;
    channels: NotificationChannel[];
    frequency: NotificationFrequency;
    enabled: boolean;
}

export interface NotificationPreferencesProps {
    /** Current preferences */
    preferences?: NotificationPreference[];
    /** Callback when preferences are saved */
    onSave?: (preferences: NotificationPreference[]) => Promise<void>;
    /** Whether email is configured */
    emailEnabled?: boolean;
    /** Whether Slack is connected */
    slackEnabled?: boolean;
    /** Additional className */
    className?: string;
}

const eventTypeConfig: Record<NotificationEventType, {
    label: string;
    description: string;
    icon: React.ReactNode;
    defaultChannels: NotificationChannel[];
}> = {
    execution_completed: {
        label: 'Execution Completed',
        description: 'When a pipeline execution completes successfully',
        icon: <CheckCircle className="h-4 w-4 text-green-500" />,
        defaultChannels: ['inApp'],
    },
    execution_failed: {
        label: 'Execution Failed',
        description: 'When a pipeline execution fails',
        icon: <XCircle className="h-4 w-4 text-red-500" />,
        defaultChannels: ['email', 'inApp'],
    },
    execution_started: {
        label: 'Execution Started',
        description: 'When a pipeline execution begins',
        icon: <Zap className="h-4 w-4 text-blue-500" />,
        defaultChannels: ['inApp'],
    },
    schedule_triggered: {
        label: 'Schedule Triggered',
        description: 'When a scheduled job runs',
        icon: <Clock className="h-4 w-4 text-purple-500" />,
        defaultChannels: ['inApp'],
    },
    connector_error: {
        label: 'Connector Error',
        description: 'When a SaaS connector encounters an error',
        icon: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
        defaultChannels: ['email', 'inApp'],
    },
    budget_alert: {
        label: 'Budget Alert',
        description: 'When spending approaches or exceeds budget limits',
        icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
        defaultChannels: ['email', 'inApp'],
    },
    system_maintenance: {
        label: 'System Maintenance',
        description: 'Announcements about scheduled maintenance',
        icon: <Bell className="h-4 w-4 text-gray-500" />,
        defaultChannels: ['email'],
    },
};

const frequencyOptions: { value: NotificationFrequency; label: string }[] = [
    { value: 'immediate', label: 'Immediately' },
    { value: 'hourly', label: 'Hourly digest' },
    { value: 'daily', label: 'Daily digest' },
    { value: 'weekly', label: 'Weekly digest' },
];

const defaultPreferences: NotificationPreference[] = Object.entries(eventTypeConfig).map(
    ([eventType, config]) => ({
        eventType: eventType as NotificationEventType,
        channels: config.defaultChannels,
        frequency: 'immediate' as NotificationFrequency,
        enabled: true,
    })
);

/**
 * Individual notification preference row
 */
const PreferenceRow = memo(function PreferenceRow({
    preference,
    config,
    emailEnabled,
    slackEnabled,
    onChange,
}: {
    preference: NotificationPreference;
    config: typeof eventTypeConfig[NotificationEventType];
    emailEnabled: boolean;
    slackEnabled: boolean;
    onChange: (updated: NotificationPreference) => void;
}) {
    const toggleChannel = (channel: NotificationChannel) => {
        const newChannels = preference.channels.includes(channel)
            ? preference.channels.filter(c => c !== channel)
            : [...preference.channels, channel];
        onChange({ ...preference, channels: newChannels });
    };

    return (
        <div className="py-4">
            <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5">{config.icon}</div>
                    <div>
                        <div className="flex items-center gap-2">
                            <Label className="font-medium">{config.label}</Label>
                            <Switch
                                checked={preference.enabled}
                                onCheckedChange={(enabled) => onChange({ ...preference, enabled })}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground">{config.description}</p>
                    </div>
                </div>
            </div>

            {preference.enabled && (
                <div className="mt-3 ml-7 flex flex-wrap items-center gap-4">
                    {/* Channels */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Notify via:</span>
                        <div className="flex gap-1">
                            <Button
                                variant={preference.channels.includes('inApp') ? 'default' : 'outline'}
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => toggleChannel('inApp')}
                            >
                                <Bell className="h-3 w-3 mr-1" />
                                In-App
                            </Button>
                            <Button
                                variant={preference.channels.includes('email') ? 'default' : 'outline'}
                                size="sm"
                                className="h-7 px-2"
                                disabled={!emailEnabled}
                                onClick={() => toggleChannel('email')}
                            >
                                <Mail className="h-3 w-3 mr-1" />
                                Email
                            </Button>
                            <Button
                                variant={preference.channels.includes('slack') ? 'default' : 'outline'}
                                size="sm"
                                className="h-7 px-2"
                                disabled={!slackEnabled}
                                onClick={() => toggleChannel('slack')}
                            >
                                <MessageSquare className="h-3 w-3 mr-1" />
                                Slack
                            </Button>
                        </div>
                    </div>

                    {/* Frequency */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Frequency:</span>
                        <Select
                            value={preference.frequency}
                            onValueChange={(value: NotificationFrequency) => 
                                onChange({ ...preference, frequency: value })
                            }
                        >
                            <SelectTrigger className="h-7 w-[130px] text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {frequencyOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}
        </div>
    );
});

/**
 * Memoized notification preferences component.
 * Allows users to configure how they receive notifications.
 */
export const NotificationPreferences = memo(function NotificationPreferences({
    preferences: initialPreferences,
    onSave,
    emailEnabled = true,
    slackEnabled = false,
    className,
}: NotificationPreferencesProps) {
    const { toast } = useToast();
    const [preferences, setPreferences] = useState<NotificationPreference[]>(
        initialPreferences || defaultPreferences
    );
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    const updatePreference = (index: number, updated: NotificationPreference) => {
        setPreferences(prev => {
            const newPrefs = [...prev];
            newPrefs[index] = updated;
            return newPrefs;
        });
        setHasChanges(true);
    };

    const handleSave = async () => {
        if (!onSave) return;
        
        setIsSaving(true);
        try {
            await onSave(preferences);
            setHasChanges(false);
            toast({
                title: 'Preferences saved',
                description: 'Your notification preferences have been updated.',
            });
        } catch (error) {
            toast({
                title: 'Error saving preferences',
                description: 'Please try again later.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const enabledCount = preferences.filter(p => p.enabled).length;

    return (
        <Card className={className}>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Bell className="h-5 w-5" />
                            Notification Preferences
                        </CardTitle>
                        <CardDescription>
                            Configure how you want to be notified about events
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                            {enabledCount} of {preferences.length} enabled
                        </Badge>
                        {onSave && (
                            <Button
                                size="sm"
                                onClick={handleSave}
                                disabled={!hasChanges || isSaving}
                            >
                                <Save className="h-4 w-4 mr-1" />
                                {isSaving ? 'Saving...' : 'Save'}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Channel status badges */}
                <div className="flex gap-2 mt-2">
                    <Badge variant={emailEnabled ? 'default' : 'outline'}>
                        <Mail className="h-3 w-3 mr-1" />
                        Email {emailEnabled ? 'Connected' : 'Not configured'}
                    </Badge>
                    <Badge variant={slackEnabled ? 'default' : 'outline'}>
                        <MessageSquare className="h-3 w-3 mr-1" />
                        Slack {slackEnabled ? 'Connected' : 'Not connected'}
                    </Badge>
                </div>
            </CardHeader>

            <CardContent className="divide-y">
                {preferences.map((pref, index) => (
                    <PreferenceRow
                        key={pref.eventType}
                        preference={pref}
                        config={eventTypeConfig[pref.eventType]}
                        emailEnabled={emailEnabled}
                        slackEnabled={slackEnabled}
                        onChange={(updated) => updatePreference(index, updated)}
                    />
                ))}
            </CardContent>
        </Card>
    );
});

export default NotificationPreferences;

