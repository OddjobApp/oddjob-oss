import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/queryClient";
import { missionRunPath } from "@/lib/paths";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useParams, useLocation } from "wouter";
import { Link } from "wouter";
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
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import {
    Pencil,
    Plus,
    Trash2,
    GripVertical,
    Loader2,
    User,
    Layers,
    Bot,
    PackageCheck,
    ArrowLeft,
    Save,
    X
} from "lucide-react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";

// We use a simplified version of the schema for the form
const TaskSchema = z.object({
    id: z.string(),
    name: z.string().min(1, "Name is required"),
    description: z.string().min(1, "Description is required"),
    assignedAgent: z.string().nullish(),
    dependencies: z.array(z.string()).default([]),
    deliverables: z.array(z.string()).default([]),
});

const PlanSchema = z.object({
    intent: z.string().min(1, "Intent is required"),
    tasks: z.array(TaskSchema),
});

export default function MissionPlanEditorPage() {
    const { missionId, runId } = useParams();
    const runPath = missionId && runId ? missionRunPath(missionId, runId) : "/operations/runs";
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch mission run data
    const { data: run, isLoading: isLoadingRun } = useQuery({
        queryKey: [`/api/mission-runs/${runId}`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/mission-runs/${runId}`);
            if (!res.ok) throw new Error("Failed to fetch mission run");
            return res.json();
        },
    });

    // Fetch mission members
    const { data: mission, isLoading: isLoadingMission } = useQuery({
        queryKey: [`/api/missions/${missionId}`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/missions/${missionId}`);
            if (!res.ok) throw new Error("Failed to fetch mission");
            return res.json();
        },
        enabled: !!missionId,
    });

    const initialPlan = run?.plan || { intent: "", tasks: [] };
    const missionMembers = mission?.members || [];

    const form = useForm<z.infer<typeof PlanSchema>>({
        resolver: zodResolver(PlanSchema),
        defaultValues: {
            intent: initialPlan?.intent || "",
            tasks: initialPlan?.tasks || [],
        },
        values: {
            intent: initialPlan?.intent || "",
            tasks: initialPlan?.tasks || [],
        },
    });

    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: "tasks",
    });

    const updateMutation = useMutation({
        mutationFn: async (values: z.infer<typeof PlanSchema>) => {
            const res = await apiRequest("PATCH", `/api/mission-runs/${runId}/plan`, values);
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Failed to update mission plan");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs/${runId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/pipeline-executions`] });
            toast({
                title: "Plan Updated",
                description: "The mission execution plan has been modified.",
            });
            // Navigate back to run detail
            setLocation(runPath);
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    function onSubmit(values: z.infer<typeof PlanSchema>) {
        updateMutation.mutate(values);
    }

    if (isLoadingRun || isLoadingMission) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link href={runPath}>
                                <Button variant="ghost" size="icon" className="h-9 w-9">
                                    <ArrowLeft className="w-5 h-5" />
                                </Button>
                            </Link>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight uppercase">
                                    Edit Strategic Roadmap
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    Mission Run #{runId} • Modify the task sequence, assignments, and dependencies
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setLocation(`/operations/missions/${missionId}/runs/${runId}`)}
                            >
                                <X className="w-4 h-4 mr-2" />
                                Cancel
                            </Button>
                            <Button
                                onClick={form.handleSubmit(onSubmit)}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-black italic uppercase"
                                disabled={updateMutation.isPending}
                            >
                                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                <Save className="w-4 h-4 mr-2" />
                                Commit Plan Changes
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                        {/* Strategic Intent Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg font-bold uppercase tracking-tight flex items-center gap-2">
                                    <Pencil className="w-5 h-5 text-primary" />
                                    Primary Strategic Intent
                                </CardTitle>
                                <CardDescription>
                                    Define the core objective that drives this mission execution.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <FormField
                                    control={form.control}
                                    name="intent"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    className="min-h-[100px] text-base bg-background/50 border-border resize-none"
                                                    placeholder="Describe the mission objective..."
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>

                        {/* Task Sequence */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-bold uppercase tracking-tight flex items-center gap-2">
                                        <Layers className="w-5 h-5 text-primary" />
                                        Task Sequence
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        Define phases, assign assets, and set dependencies.
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        append({
                                            id: crypto.randomUUID(),
                                            name: "",
                                            description: "",
                                            assignedAgent: null,
                                            dependencies: [],
                                            deliverables: [],
                                        })
                                    }
                                    className="h-9"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Phase
                                </Button>
                            </div>

                            <div className="grid gap-4">
                                {fields.map((field, index) => (
                                    <Card key={field.id} className="relative">
                                        <CardContent className="p-6">
                                            <div className="flex items-start gap-4">
                                                <div className="flex flex-col items-center gap-2 pt-2">
                                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                                                        {index + 1}
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            disabled={index === 0}
                                                            onClick={() => move(index, index - 1)}
                                                        >
                                                            <GripVertical className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="flex-1 space-y-4">
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <FormField
                                                            control={form.control}
                                                            name={`tasks.${index}.name`}
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <FormLabel className="text-xs uppercase font-bold text-muted-foreground">
                                                                        Phase Name
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            {...field}
                                                                            className="h-9 bg-background/50 border-border"
                                                                            placeholder="e.g., Data Collection"
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name={`tasks.${index}.assignedAgent`}
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <FormLabel className="text-xs uppercase font-bold text-muted-foreground">
                                                                        Assigned Asset
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <select
                                                                            {...field}
                                                                            value={field.value || ""}
                                                                            className="w-full h-9 bg-background/50 border border-border rounded-md px-3 text-sm outline-none focus:border-primary/50"
                                                                        >
                                                                            <option value="">No Lead Assigned</option>
                                                                            {missionMembers.map((m: any) => (
                                                                                <option key={m.id} value={m.entityType === 'job' ? `Agent #${m.entityId}` : `Pipeline #${m.entityId}`}>
                                                                                    {m.entityType === 'job' ? `Agent #${m.entityId}` : `Pipeline #${m.entityId}`} ({m.role})
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                    </div>

                                                    <FormField
                                                        control={form.control}
                                                        name={`tasks.${index}.description`}
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel className="text-xs uppercase font-bold text-muted-foreground">
                                                                    Strategic Directive
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Textarea
                                                                        {...field}
                                                                        className="min-h-[80px] bg-background/50 border-border text-sm resize-none"
                                                                        placeholder="Describe what this phase should accomplish..."
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    {/* Deliverables */}
                                                    <FormField
                                                        control={form.control}
                                                        name={`tasks.${index}.deliverables`}
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel className="text-xs uppercase font-bold text-muted-foreground flex items-center gap-2">
                                                                    <PackageCheck className="w-4 h-4 text-primary" />
                                                                    Expected Deliverables
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        placeholder="e.g., JIRA dataset, Executive summary PDF (comma-separated)"
                                                                        className="h-9 bg-background/50 border-border text-sm"
                                                                        value={Array.isArray(field.value) ? field.value.join(", ") : ""}
                                                                        onChange={e => {
                                                                            const raw = e.target.value;
                                                                            field.onChange(raw.split(",").map(s => s.trim()).filter(Boolean));
                                                                        }}
                                                                    />
                                                                </FormControl>
                                                                <p className="text-xs text-muted-foreground mt-1">
                                                                    Separate multiple deliverables with commas.
                                                                </p>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    {/* Dependencies */}
                                                    <div className="pt-2">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <Layers className="w-4 h-4 text-muted-foreground" />
                                                            <span className="text-xs uppercase font-bold text-muted-foreground">
                                                                Dependencies
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {fields.filter(f => f.id !== field.id).map(other => {
                                                                const isDep = form.watch(`tasks.${index}.dependencies`)?.includes((other as any).id);
                                                                return (
                                                                    <Badge
                                                                        key={other.id}
                                                                        variant={isDep ? "default" : "outline"}
                                                                        className={`cursor-pointer ${isDep ? "bg-primary hover:bg-primary/90" : "border-border hover:border-primary/50"}`}
                                                                        onClick={() => {
                                                                            const current = form.getValues(`tasks.${index}.dependencies`) || [];
                                                                            const id = (other as any).id;
                                                                            if (current.includes(id)) {
                                                                                form.setValue(`tasks.${index}.dependencies`, current.filter(d => d !== id));
                                                                            } else {
                                                                                form.setValue(`tasks.${index}.dependencies`, [...current, id]);
                                                                            }
                                                                        }}
                                                                    >
                                                                        {(other as any).name || (other as any).id}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>

                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                    onClick={() => remove(index)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}

                                {fields.length === 0 && (
                                    <Card className="border-dashed">
                                        <CardContent className="p-8 text-center">
                                            <Layers className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                                            <p className="text-muted-foreground mb-4">No phases defined yet.</p>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() =>
                                                    append({
                                                        id: crypto.randomUUID(),
                                                        name: "",
                                                        description: "",
                                                        assignedAgent: null,
                                                        dependencies: [],
                                                        deliverables: [],
                                                    })
                                                }
                                            >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add First Phase
                                            </Button>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    </form>
                </Form>
            </div>
        </div>
    );
}
