
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/queryClient";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { UserPlus, Loader2, Bot } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

const formSchema = z.object({
    jobId: z.string().min(1, "Please select an agent"),
    role: z.string().min(1, "Role is required"),
});

interface AddMemberDialogProps {
    missionId: number;
}

export function AddMemberDialog({ missionId }: AddMemberDialogProps) {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch available jobs (agents)
    const { data: jobs, isLoading: isJobsLoading } = useQuery<any>({
        queryKey: ["/api/jobs"],
    });

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            jobId: "",
            role: "Specialist",
        },
    });

    const addMemberMutation = useMutation({
        mutationFn: async (values: z.infer<typeof formSchema>) => {
            const res = await apiRequest("POST", `/api/missions/${missionId}/members`, {
                entityType: "job", // Currently only supporting adding Jobs as agents
                entityId: parseInt(values.jobId),
                role: values.role
            });
            return res.json();
        },
        onSuccess: () => {
            // Invalidate the detail view to show new member
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });

            toast({
                title: "Agent Recruited",
                description: "The agent has been added to the mission.",
            });
            setOpen(false);
            form.reset();
        },
        onError: (error) => {
            toast({
                title: "Error",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    function onSubmit(values: z.infer<typeof formSchema>) {
        addMemberMutation.mutate(values);
    }

    // Handle paginated or flat jobs response
    const jobList = jobs?.items || jobs || [];

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add Agent
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>Recruit Agent</DialogTitle>
                    <DialogDescription>
                        Select an agent to assign to this mission.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="jobId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Select Agent</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Choose an agent..." />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {isJobsLoading ? (
                                                <div className="p-2 text-center text-xs text-muted-foreground">Loading agents...</div>
                                            ) : jobList.length > 0 ? (
                                                jobList.map((job: any) => (
                                                    <SelectItem key={job.id} value={job.id.toString()}>
                                                        <div className="flex items-center gap-2">
                                                            <Bot className="w-4 h-4 text-muted-foreground" />
                                                            <span>{job.name}</span>
                                                        </div>
                                                    </SelectItem>
                                                ))
                                            ) : (
                                                <div className="p-2 text-center text-xs text-muted-foreground">No agents found</div>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="role"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Assigned Role</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a role..." />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="Supervisor">Supervisor</SelectItem>
                                            <SelectItem value="Specialist">Specialist</SelectItem>
                                            <SelectItem value="Researcher">Researcher</SelectItem>
                                            <SelectItem value="Analyst">Analyst</SelectItem>
                                            <SelectItem value="Executor">Executor</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" className="bg-primary" disabled={addMemberMutation.isPending}>
                                {addMemberMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Recruit
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

