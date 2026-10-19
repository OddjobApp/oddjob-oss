import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription
} from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    ArrowLeft,
    Save,
    Plus,
    Trash2,
    ShieldCheck,
    Wrench,
    EyeOff,
    Wallet,
    AlertTriangle
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

const ruleSchema = z.object({
    type: z.enum(['tool_allow', 'tool_deny', 'pii_redaction', 'budget_limit', 'require_approval']),
    configuration: z.record(z.any()),
    isEnabled: z.boolean().default(true),
});

const policySchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    type: z.enum(['global', 'system', 'custom']).default('custom'),
    isActive: z.boolean().default(true),
    rules: z.array(ruleSchema).default([]),
});

type PolicyFormValues = z.infer<typeof policySchema>;

export default function PolicyEditor() {
    const { id } = useParams<{ id: string }>();
    const isNew = id === "new";
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: policy, isLoading } = useQuery<PolicyFormValues & { id: number }>({
        queryKey: ["/api/governor/policies", id],
        enabled: !isNew,
    });

    const form = useForm<PolicyFormValues>({
        resolver: zodResolver(policySchema),
        defaultValues: {
            name: "",
            description: "",
            type: "custom",
            isActive: true,
            rules: [],
        },
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "rules",
    });

    React.useEffect(() => {
        if (policy) {
            form.reset(policy);
        }
    }, [policy, form]);

    const saveMutation = useMutation({
        mutationFn: async (values: PolicyFormValues) => {
            if (isNew) {
                await apiRequest("POST", "/api/governor/policies", values);
            } else {
                await apiRequest("PUT", `/api/governor/policies/${id}`, values);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/governor/policies"] });
            toast({ title: `Policy ${isNew ? 'created' : 'updated'} successfully` });
            setLocation("/control/policies");
        },
        onError: (error: any) => {
            toast({
                title: "Failed to save policy",
                description: error.message,
                variant: "destructive"
            });
        },
    });

    if (isLoading && !isNew) {
        return <div className="p-8">Loading...</div>;
    }

    return (
        <div className="space-y-8 p-8 max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => setLocation("/control/policies")}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                            <ShieldCheck className="w-8 h-8 text-primary" />
                            {isNew ? "Create Policy" : "Edit Policy"}
                        </h1>
                    </div>
                </div>
                <Button onClick={form.handleSubmit((v) => saveMutation.mutate(v))} disabled={saveMutation.isPending} className="shadow-lg shadow-primary/20">
                    <Save className="w-4 h-4 mr-2" />
                    Save Policy
                </Button>
            </div>

            <Form {...form}>
                <form className="space-y-8">
                    <Card className="shadow-soft rounded-2xl border-none">
                        <CardHeader className="border-b px-6 py-4 bg-muted/10">
                            <CardTitle className="text-base font-medium">Basic Information</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Policy Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Engineering Baseline" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Description</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Describe the intent of this policy..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Policy Type</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="global">Global</SelectItem>
                                                    <SelectItem value="system">System</SelectItem>
                                                    <SelectItem value="custom">Custom</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="isActive"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                                            <div className="space-y-0.5">
                                                <FormLabel>Active Status</FormLabel>
                                                <FormDescription>Whether this policy is currently applied.</FormDescription>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-muted-foreground" />
                                Rules & Constraints
                            </h2>
                            <Button type="button" variant="outline" size="sm" onClick={() => append({ type: 'tool_allow', configuration: {}, isEnabled: true })}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Rule
                            </Button>
                        </div>

                        {fields.map((field, index) => (
                            <Card key={field.id} className="shadow-sm border-foreground/5 bg-muted/5">
                                <CardContent className="p-6 space-y-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <FormField
                                            control={form.control}
                                            name={`rules.${index}.type`}
                                            render={({ field }) => (
                                                <FormItem className="flex-1">
                                                    <FormLabel>Rule Type</FormLabel>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="tool_allow">Allow Tools</SelectItem>
                                                            <SelectItem value="tool_deny">Deny Tools</SelectItem>
                                                            <SelectItem value="pii_redaction">PII Redaction</SelectItem>
                                                            <SelectItem value="budget_limit">Budget Limit</SelectItem>
                                                            <SelectItem value="require_approval">Require Approval</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name={`rules.${index}.isEnabled`}
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col items-center">
                                                    <FormLabel className="mb-2">Enabled</FormLabel>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />

                                        <Button type="button" variant="ghost" size="icon" className="mt-8 text-destructive" onClick={() => remove(index)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    {/* Dynamic Config Fields based on Type */}
                                    <div className="p-4 bg-background/50 rounded-lg border border-dashed border-foreground/10">
                                        {form.watch(`rules.${index}.type`) === 'tool_allow' || form.watch(`rules.${index}.type`) === 'tool_deny' ? (
                                            <div className="space-y-2">
                                                <FormLabel className="text-xs uppercase tracking-widest opacity-50">Tools (Comma separated)</FormLabel>
                                                <Input
                                                    placeholder="e.g. read_file, list_dir"
                                                    onChange={(e) => form.setValue(`rules.${index}.configuration`, { tools: e.target.value.split(',').map(s => s.trim()) })}
                                                    defaultValue={form.getValues(`rules.${index}.configuration`)?.tools?.join(', ')}
                                                />
                                            </div>
                                        ) : form.watch(`rules.${index}.type`) === 'pii_redaction' ? (
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 p-2 rounded">
                                                    <EyeOff className="w-3 h-3" />
                                                    Redaction patterns will be applied to all tool inputs/outputs.
                                                </div>
                                                <Input placeholder="Pattern Name (e.g. Emails)" />
                                                <Input placeholder="Regex Pattern" />
                                            </div>
                                        ) : form.watch(`rules.${index}.type`) === 'budget_limit' ? (
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <FormLabel className="text-xs opacity-50">Max Cost (USD)</FormLabel>
                                                    <Input type="number" step="0.01" placeholder="10.00" />
                                                </div>
                                                <div className="space-y-2">
                                                    <FormLabel className="text-xs opacity-50">Scope</FormLabel>
                                                    <Select defaultValue="mission">
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="mission">Mission</SelectItem>
                                                            <SelectItem value="organization">Organization</SelectItem>
                                                            <SelectItem value="daily_total">Daily Total</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-muted-foreground italic">No additional configuration required for this rule type.</p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        {fields.length === 0 && (
                            <div className="text-center py-12 border-2 border-dashed rounded-2xl border-foreground/5 opacity-50">
                                <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
                                <p>No rules defined for this policy. It will act as a container with no active constraints.</p>
                            </div>
                        )}
                    </div>
                </form>
            </Form>
        </div>
    );
}

