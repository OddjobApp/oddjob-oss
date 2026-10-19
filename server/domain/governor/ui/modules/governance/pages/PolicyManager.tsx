import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@domain-ui/core/ui/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@domain-ui/core/ui/components/ui/table";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Plus,
    Shield,
    MoreHorizontal,
    Settings,
    Trash2,
    CheckCircle2,
    XCircle,
    ShieldCheck,
    ShieldAlert,
    Play
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { PolicyFeedbackLoop } from "@domain-ui/governor/ui/components/governance/PolicyFeedbackLoop";

interface Policy {
    id: number;
    name: string;
    description: string;
    type: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export default function PolicyManager() {
    const [, setLocation] = useLocation();
    const search = useSearch();
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const openPolicyDryRun = React.useCallback(() => {
        window.dispatchEvent(new CustomEvent("agent-assist-request", {
            detail: {
                prompt: "Help me dry-run a policy scenario. Ask for the policy, sample context, expected action, risk level, and approval outcome.",
                context: { mode: "plan", source: "policies-dry-run" },
            },
        }));
    }, []);

    React.useEffect(() => {
        const params = new URLSearchParams(search);
        if (params.get("mode") === "simulate") {
            openPolicyDryRun();
            setLocation("/control/policies", { replace: true } as any);
        }
    }, [openPolicyDryRun, search, setLocation]);

    const { data: policies, isLoading } = useQuery<Policy[]>({
        queryKey: ["/api/governor/policies"],
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/governor/policies/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/governor/policies"] });
            toast({ title: "Policy deleted successfully" });
        },
        onError: (error: any) => {
            toast({
                title: "Failed to delete policy",
                description: error.message,
                variant: "destructive"
            });
        },
    });

    if (isLoading) {
        return <div className="p-8 space-y-4">
            <div className="h-8 w-64 bg-muted animate-pulse rounded" />
            <Card className="h-96 animate-pulse" />
        </div>;
    }

    return (
        <div className="space-y-8 p-6 md:p-8 max-w-[1600px] mx-auto w-full">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Governance Policies</h1>
                    <p className="text-sm text-muted-foreground">Manage approval gates, execution boundaries, budget limits, and data/privacy controls.</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button variant="outline" onClick={openPolicyDryRun} className="gap-2">
                        <Play className="w-4 h-4" />
                        Dry Run in Assistant
                    </Button>
                    <Button onClick={() => setLocation("/control/policies/new")} className="gap-2">
                        <Plus className="w-4 h-4" />
                        Create Policy
                    </Button>
                </div>
            </div>

            <Card className="shadow-soft rounded-2xl border-none">
                <CardHeader className="border-b px-6 py-4 bg-muted/10">
                    <CardTitle className="text-base font-medium">Governance Rules</CardTitle>
                    <CardDescription>Rules that shape what agents can do, what requires approval, and what must be redacted or constrained.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/5">
                            <TableRow>
                                <TableHead className="pl-6">Name & Description</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Last Updated</TableHead>
                                <TableHead className="text-right pr-6">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {policies?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                                        <div className="flex flex-col items-center gap-2">
                                            <ShieldAlert className="w-12 h-12 opacity-20" />
                                            <p>No governance policies found. Create one to get started.</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                policies?.map((policy) => (
                                    <TableRow key={policy.id} className="group hover:bg-muted/50 transition-colors">
                                        <TableCell className="pl-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-foreground">{policy.name}</span>
                                                <span className="text-xs text-muted-foreground max-w-md truncate">{policy.description}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize bg-muted/30">
                                                {policy.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {policy.isActive ? (
                                                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 gap-1 pl-1">
                                                    <CheckCircle2 className="w-3 h-3" /> Active
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="bg-muted text-muted-foreground border-border gap-1 pl-1">
                                                    <XCircle className="w-3 h-3" /> Inactive
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {format(new Date(policy.updatedAt), 'MMM d, yyyy')}
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-40 shadow-xl border-foreground/10 backdrop-blur-md">
                                                    <DropdownMenuItem onClick={() => setLocation(`/control/policies/${policy.id}`)}>
                                                        <Settings className="mr-2 h-4 w-4" /> Edit Details
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-destructive focus:text-destructive"
                                                        onClick={() => {
                                                            if (confirm("Are you sure you want to delete this policy?")) {
                                                                deleteMutation.mutate(policy.id);
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <PolicyFeedbackLoop />
                </div>
                <div className="space-y-6">
                    <Card className="bg-primary/5 border-primary/20 shadow-none rounded-2xl">
                        <CardContent className="p-6">
                            <h3 className="font-bold text-primary flex items-center gap-2 mb-2">
                                <ShieldCheck className="w-5 h-5" />
                                Safety Resolution
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Policies resolve from Job &rarr; Pipeline &rarr; Workgroup &rarr; Global.
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-accent-tan/5 border-accent-tan/20 shadow-none rounded-2xl">
                        <CardContent className="p-6">
                            <h3 className="font-bold text-muted-foreground flex items-center gap-2 mb-2">
                                <Shield className="w-5 h-5" />
                                Data Privacy
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                PII redaction patterns ensure sensitive info never leaves the environment.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

