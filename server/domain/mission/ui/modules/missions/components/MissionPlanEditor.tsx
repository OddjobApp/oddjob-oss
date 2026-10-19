
import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
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
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
    Pencil,
    Plus,
    Trash2,
    GripVertical,
    Loader2,
    User,
    Layers,
    Bot,
    PackageCheck
} from "lucide-react";
import { z } from "zod";

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

interface MissionPlanEditorProps {
    runId: number;
    initialPlan: any;
    missionMembers?: any[];
}

export function MissionPlanEditor({ runId, initialPlan, missionMembers = [] }: MissionPlanEditorProps) {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const form = useForm<z.infer<typeof PlanSchema>>({
        resolver: zodResolver(PlanSchema),
        defaultValues: {
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
            setOpen(false);
        },
        onError: (error: any) => {
            toast({
                title: "Update Failed",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    function onSubmit(values: z.infer<typeof PlanSchema>) {
        updateMutation.mutate(values);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
                    <Pencil className="w-4 h-4 mr-2" />
                    Modify Plan
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] h-[90vh] flex flex-col p-0 overflow-hidden bg-background border-border">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                        <Bot className="w-6 h-6 text-primary" />
                        Edit Strategic Roadmap
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground font-medium">
                        Modify the task sequence, assignments, and dependencies for this mission run.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full overflow-hidden">
                        <ScrollArea className="flex-1 px-6 py-4">
                            <div className="space-y-8 pb-10">
                                <FormField
                                    control={form.control}
                                    name="intent"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] uppercase font-bold tracking-[0.2em] text-primary">Primary Strategic Intent</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    className="bg-background/40 border-border focus:border-primary/50 text-foreground font-medium"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between border-b border-border pb-2">
                                        <h4 className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground">Task Sequence</h4>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[10px] uppercase font-bold text-primary hover:bg-primary/10"
                                            onClick={() => append({
                                                id: `task_${fields.length + 1}`,
                                                name: `New Task ${fields.length + 1}`,
                                                description: "",
                                                status: "pending",
                                                dependencies: [],
                                                deliverables: []
                                            } as any)}
                                        >
                                            <Plus className="w-3 h-3 mr-1" /> Add Phase
                                        </Button>
                                    </div>

                                    <div className="space-y-3">
                                        {fields.map((field, index) => (
                                            <div
                                                key={field.id}
                                                className="group relative p-4 rounded-xl border border-border bg-card/30 hover:bg-card/50 hover:border-border transition-all"
                                            >
                                                <div className="flex gap-4">
                                                    <div className="mt-1 opacity-20 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                                                        <GripVertical className="w-4 h-4 text-muted-foreground" />
                                                    </div>

                                                    <div className="flex-1 space-y-4">
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <FormField
                                                                control={form.control}
                                                                name={`tasks.${index}.name`}
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <FormLabel className="text-[9px] uppercase font-bold text-muted-foreground">Phase Name</FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                {...field}
                                                                                className="h-8 bg-background/20 border-border text-xs font-bold text-foreground uppercase tracking-wider"
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
                                                                        <FormLabel className="text-[9px] uppercase font-bold text-muted-foreground">Assigned Asset</FormLabel>
                                                                        <FormControl>
                                                                            <select
                                                                                {...field}
                                                                                value={field.value || ""}
                                                                                className="w-full h-8 bg-background/20 border border-border rounded-md px-2 text-[10px] text-foreground font-mono outline-none focus:border-primary/50"
                                                                            >
                                                                                <option value="">No Lead Assigned</option>
                                                                                {missionMembers.map((m) => (
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
                                                                    <FormLabel className="text-[9px] uppercase font-bold text-muted-foreground">Strategic Directive</FormLabel>
                                                                    <FormControl>
                                                                        <Textarea
                                                                            {...field}
                                                                            className="min-h-[60px] bg-background/20 border-border text-xs text-muted-foreground italic leading-relaxed"
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
                                                                    <FormLabel className="text-[9px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                                                        <PackageCheck className="w-3 h-3 text-primary" />
                                                                        Expected Deliverables
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            placeholder="e.g. JIRA dataset, Executive summary PDF (comma-separated)"
                                                                            className="h-8 bg-background/20 border-border text-xs text-foreground"
                                                                            value={Array.isArray(field.value) ? field.value.join(", ") : ""}
                                                                            onChange={e => {
                                                                                const raw = e.target.value;
                                                                                field.onChange(raw.split(",").map(s => s.trim()).filter(Boolean));
                                                                            }}
                                                                        />
                                                                    </FormControl>
                                                                    <p className="text-[10px] text-muted-foreground mt-0.5">Separate multiple deliverables with commas.</p>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />

                                                        <div className="flex items-center justify-between pt-2">
                                                            <div className="flex gap-2 items-center">
                                                                <Layers className="w-3 h-3 text-muted-foreground" />
                                                                <span className="text-[9px] uppercase font-medium text-muted-foreground">Dependencies:</span>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {fields.filter(f => f.id !== field.id).map(other => {
                                                                        const isDep = form.watch(`tasks.${index}.dependencies`)?.includes((other as any).id);
                                                                        return (
                                                                            <Badge
                                                                                key={other.id}
                                                                                variant={isDep ? "default" : "outline"}
                                                                                className={`text-[8px] h-4 py-0 cursor-pointer ${isDep ? "bg-primary" : "border-border"}`}
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

                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                                onClick={() => remove(index)}
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>

                        <DialogFooter className="p-6 bg-card/50 border-t border-border mt-auto">
                            <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="text-muted-foreground">
                                Close Editor
                            </Button>
                            <Button
                                type="submit"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-black italic uppercase text-xs px-8"
                                disabled={updateMutation.isPending}
                            >
                                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Commit Plan Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}


