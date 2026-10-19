import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@domain-ui/core/ui/hooks/useApiMutation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@domain-ui/core/ui/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Pencil, Loader2, Calendar } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";

const formSchema = z.object({
    name: z.string().min(3, "Name must be at least 3 characters"),
    objective: z.string().min(10, "Objective must be descriptive"),
    isScheduled: z.boolean().default(false),
    frequency: z.string().optional(),
    executionStrategy: z.string().default("pre_planned"),
    reasoningProtocol: z.string().default("json_manifest"),
});

interface EditMissionDialogProps {
    mission: {
        id: number;
        name: string;
        objective: string;
    };
}

export function EditMissionDialog({ mission }: EditMissionDialogProps) {
    const [open, setOpen] = useState(false);
    const { selectedOrgId } = useOrgContext();
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const DELIVERABLE_TYPES = [
        "Research Paper",
        "Implementation Plan",
        "Technical Specification",
        "Migration Report",
        "Tabular Report",
        "Impact Assessment",
        "Executive Summary",
        "Competitive Matrix",
        "Jira Backlog",
        "SaaS Sync & Audit"
    ];

    const [selectedDeliverables, setSelectedDeliverables] = useState<string[]>([]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: mission.name,
            objective: mission.objective || "",
            isScheduled: (mission as any).isScheduled || false,
            frequency: (mission as any).frequency || "20min",
            reasoningProtocol: (mission as any).reasoningProtocol || "json_manifest",
            executionStrategy: (mission as any).executionStrategy || "pre_planned",
        },
    });

    useEffect(() => {
        if (open) {
            let objective = mission.objective || "";
            let deliverables: string[] = [];

            // Parse existing deliverables: [Target Product: Type1, Type2]
            const match = objective.match(/\[Target Product: (.*?)\]/);
            if (match) {
                deliverables = match[1].split(", ").map(t => t.trim());
                // Remove the directive from the objective for editing
                objective = objective.replace(/\n\n\[Target Product: .*?\]/, "").trim();
            }

            form.reset({
                name: mission.name,
                objective: objective,
                isScheduled: (mission as any).isScheduled || false,
                frequency: (mission as any).frequency || "20min",
                reasoningProtocol: (mission as any).reasoningProtocol || "json_manifest",
                executionStrategy: (mission as any).executionStrategy || "pre_planned",
            });
            setSelectedDeliverables(deliverables);
        }
    }, [open, mission, form]);

    const updateMutation = useApiMutation<any, z.infer<typeof formSchema>>(
        "PATCH",
        `/api/missions/${mission.id}`,
        {
            successMessage: "Mission Updated",
            invalidateKeys: ["/api/missions", `/api/missions/${mission.id}`],
            optimisticConfig: {
                queryKey: ["/api/missions", selectedOrgId],
                updateFn: (old: any[], vars) => {
                    if (!Array.isArray(old)) return old;
                    return old.map(m => m.id === mission.id ? { ...m, ...vars } : m);
                }
            },
            onSuccess: () => {
                setOpen(false);
            }
        }
    );

    function onSubmit(values: z.infer<typeof formSchema>) {
        const objectiveWithDeliverables = selectedDeliverables.length > 0
            ? `${values.objective}\n\n[Target Product: ${selectedDeliverables.join(", ")}]`
            : values.objective;

        let scheduleConfig = null;
        if (values.isScheduled && values.frequency) {
            if (values.frequency === "20min") {
                scheduleConfig = { pattern: 1, patternString: { cron: "*/20 * * * *" } };
            } else if (values.frequency === "hourly") {
                scheduleConfig = { pattern: 1, patternString: { cron: "0 * * * *" } };
            } else if (values.frequency === "daily") {
                scheduleConfig = { pattern: 1, patternString: { cron: "0 9 * * *" } };
            } else if (values.frequency === "weekly") {
                scheduleConfig = { pattern: 1, patternString: { cron: "0 9 * * 1" } };
            }
        }

        updateMutation.execute({
            ...values,
            objective: objectiveWithDeliverables,
            isScheduled: values.isScheduled,
            scheduleConfig
        } as any);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit Mission
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit Mission Details</DialogTitle>
                    <DialogDescription>
                        Update the mission name or refine the objective.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Mission Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. Q1 Marketing Campaign" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="objective"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Mission Objective</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Describe the goal of this mission..."
                                            className="min-h-[100px]"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="executionStrategy"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <FormLabel className="text-sm font-medium">Mission Strategy</FormLabel>
                                            <p className="text-xs text-muted-foreground">Select the orchestration pattern.</p>
                                        </div>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="w-[180px] bg-card border-border">
                                                    <SelectValue placeholder="Select Strategy" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-card border-border">
                                                <SelectItem value="pre_planned">Pre-Planned</SelectItem>
                                                <SelectItem value="dynamic_autonomous">Dynamic</SelectItem>
                                                <SelectItem value="rolling_wave">Rolling Wave</SelectItem>
                                                <SelectItem value="parallel_fan_out">Parallel Fan-out</SelectItem>
                                                <SelectItem value="human_driven">Human Driven</SelectItem>
                                                <SelectItem value="reactive">Reactive</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="space-y-4 border-t border-border pt-4">
                            <FormField
                                control={form.control}
                                name="reasoningProtocol"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <FormLabel className="text-sm font-medium">Reasoning Protocol</FormLabel>
                                                <p className="text-xs text-muted-foreground">Select how the agent processes information and tools.</p>
                                            </div>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="w-[180px] bg-card border-border">
                                                        <SelectValue placeholder="Select Protocol" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="bg-card border-border">
                                                    <SelectItem value="json_manifest">Standard (JSON)</SelectItem>
                                                    <SelectItem value="hermes_xml">Hermes (XML)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <FormLabel className="text-sm font-medium">Mission Scheduling</FormLabel>
                                    <p className="text-xs text-muted-foreground">Enable automatic recurring runs for this mission.</p>
                                </div>
                                <FormField
                                    control={form.control}
                                    name="isScheduled"
                                    render={({ field }) => (
                                        <FormItem>
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

                            {form.watch("isScheduled") && (
                                <FormField
                                    control={form.control}
                                    name="frequency"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Execution Frequency</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="bg-card border-border">
                                                        <SelectValue placeholder="Select Frequency" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="bg-card border-border">
                                                    <SelectItem value="20min">Every 20 Minutes</SelectItem>
                                                    <SelectItem value="hourly">Every Hour</SelectItem>
                                                    <SelectItem value="daily">Daily</SelectItem>
                                                    <SelectItem value="weekly">Weekly</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] text-muted-foreground uppercase font-bold font-mono">Target Products</label>
                            <div className="flex flex-wrap gap-1.5">
                                {DELIVERABLE_TYPES.map(type => (
                                    <Badge
                                        key={type}
                                        variant={selectedDeliverables.includes(type) ? "default" : "outline"}
                                        className={`cursor-pointer text-[9px] uppercase tracking-wider py-0.5 h-5 ${selectedDeliverables.includes(type)
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "border-border text-muted-foreground hover:border-border"
                                            }`}
                                        onClick={() => setSelectedDeliverables(prev =>
                                            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                                        )}
                                    >
                                        {type}
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" className="bg-primary" disabled={updateMutation.isPending}>
                                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

