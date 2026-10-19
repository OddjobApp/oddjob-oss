import { Mouse, Calendar, Webhook as WebhookIcon, Zap } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@domain-ui/core/ui/components/ui/form';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { UseFormReturn } from 'react-hook-form';
import { PipelineFormValues } from "@/schemas/pipeline-schemas";

interface PipelineTriggerConfigProps {
    triggerType: 'schedule' | 'manual' | 'webhook' | 'event';
    onChange: (type: 'schedule' | 'manual' | 'webhook' | 'event') => void;
    form: UseFormReturn<PipelineFormValues>;
}

export default function PipelineTriggerConfig({ triggerType, onChange, form }: PipelineTriggerConfigProps) {
    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <h3 className="text-sm font-medium">Trigger Type</h3>
                <div className="grid grid-cols-4 gap-3">
                    <Button
                        type="button"
                        variant={triggerType === 'manual' ? 'default' : 'outline'}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => onChange('manual')}
                        data-testid="button-trigger-manual"
                    >
                        <Mouse className="w-5 h-5" />
                        <span className="text-xs">Manual</span>
                    </Button>
                    <Button
                        type="button"
                        variant={triggerType === 'schedule' ? 'default' : 'outline'}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => onChange('schedule')}
                        data-testid="button-trigger-schedule"
                    >
                        <Calendar className="w-5 h-5" />
                        <span className="text-xs">Schedule</span>
                    </Button>
                    <Button
                        type="button"
                        variant={triggerType === 'webhook' ? 'default' : 'outline'}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => onChange('webhook')}
                        data-testid="button-trigger-webhook"
                    >
                        <WebhookIcon className="w-5 h-5" />
                        <span className="text-xs">Webhook</span>
                    </Button>
                    <Button
                        type="button"
                        variant={triggerType === 'event' ? 'default' : 'outline'}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => onChange('event')}
                        data-testid="button-trigger-event"
                    >
                        <Zap className="w-5 h-5" />
                        <span className="text-xs">Event</span>
                    </Button>
                </div>
            </div>

            {/* Configuration Fields based on Trigger Type */}
            <div className="pt-2">
                {triggerType === 'event' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-md bg-muted/20">
                        <FormField
                            control={form.control}
                            name="eventConfig.eventType"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Event Type (Exact Match)</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="e.g. file_uploaded" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="eventConfig.filterCondition"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Filter Condition (JS Expression)</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="e.g. data.size > 1024" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                )}

                {triggerType === 'webhook' && (
                    <div className="p-4 border rounded-md bg-muted/20">
                        <FormField
                            control={form.control}
                            name="triggerCredentialId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Webhook Credential (Optional)</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            value={field.value || ''}
                                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                                        />
                                    </FormControl>
                                    <FormDescription>Security credential for webhook verification.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                )}

                {triggerType === 'schedule' && (
                    <div className="p-4 border rounded-md bg-muted/50">
                        <p className="text-sm text-muted-foreground flex items-center">
                            <Calendar className="mr-2 h-4 w-4" />
                            Configure schedule pattern (Cron) in settings.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
