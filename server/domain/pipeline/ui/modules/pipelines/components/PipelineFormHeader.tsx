import { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@domain-ui/core/ui/components/ui/card";
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Loader2, Plus, Trash2, Calendar, Webhook, Zap } from "lucide-react";
// Import schema locally for now - will fix when schema is reorganized

// Define schema locally for now - will be moved to shared schema
import { PipelineCreateSchema, PipelineFormValues, TRIGGER_TYPES } from "@/schemas/pipeline-schemas";

interface PipelineFormHeaderProps {
    form: UseFormReturn<PipelineFormValues>;
    isEdit: boolean;
    pipeline?: any;
}

export default function PipelineFormHeader({ form, isEdit, pipeline }: PipelineFormHeaderProps) {
    return (
        <Card className="w-full mx-auto">
            <CardHeader>
                <CardTitle>
                    {isEdit ? `Edit Pipeline: ${pipeline?.name || 'Unknown'}` : 'Create New Pipeline'}
                </CardTitle>
                <CardDescription>
                    Define a workflow by connecting jobs in a sequence.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold border-b pb-2">1. Pipeline Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Pipeline Name</FormLabel>
                                    <FormControl>
                                        <Input {...field} data-testid="input-pipeline-name" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Trigger Type selection moved to PipelineTriggerConfig */}

                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem className="col-span-full">
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                        <Textarea {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="isActive"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm col-span-full">
                                    <div className="space-y-0.5">
                                        <FormLabel>Active</FormLabel>
                                        <FormDescription>Enable or disable this pipeline</FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="monthlyBudgetUsd"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Monthly Budget (USD)</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            value={field.value || ''}
                                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="labels"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Labels (Comma Separated)</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            value={(field.value || []).join(', ')}
                                            onChange={(e) => field.onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                        />
                                    </FormControl>
                                    <FormDescription>Tags to categorize this pipeline.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
