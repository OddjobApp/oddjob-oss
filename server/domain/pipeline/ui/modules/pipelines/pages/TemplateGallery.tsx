
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import {
    GitFork,
    Search,
    Plus,
    Loader2,
    Copy,
    LayoutTemplate,
    Building2
} from "lucide-react";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

type Template = {
    id: number;
    name: string;
    description: string;
    category: string;
    icon: string;
    parameterSchema: Record<string, any>;
    isFeatured: boolean;
    organizationId?: number | null;
};

import { apiRequest } from "@/lib/queryClient";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@domain-ui/core/ui/components/ui/alert-dialog";
import { Trash } from "lucide-react";

export default function TemplateGallery() {
    const [search, setSearch] = useState("");
    const { toast } = useToast();
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [params, setParams] = useState<Record<string, string>>({});
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();
    const { can, adminRole } = useAuth();

    // Org context for showing org labels
    const { selectedOrgId } = useOrgContext();
    const isSuperAdmin = adminRole?.isSuperAdmin === true;
    const showOrgBadge = isSuperAdmin && selectedOrgId === null;

    // Fetch organizations for org labels
    const { data: organizationsData } = useQuery<{ organizations: Array<{ id: number; name: string }> }>({
        queryKey: ['/api/admin/organizations'],
        queryFn: async () => {
            const res = await fetch('/api/admin/organizations', { credentials: 'include' });
            if (!res.ok) return { organizations: [] };
            return res.json();
        },
        enabled: showOrgBadge,
        staleTime: 5 * 60 * 1000,
    });
    const orgMap = useMemo(() => {
        const map: Record<number, string> = {};
        (organizationsData?.organizations || []).forEach(org => {
            map[org.id] = org.name;
        });
        return map;
    }, [organizationsData]);

    const { data: templates, isLoading, error } = useQuery<Template[]>({
        queryKey: ['/api/templates'],
    });

    const instantiateMutation = useMutation({
        mutationFn: async ({ id, name, parameters }: { id: number, name: string, parameters: Record<string, any> }) => {
            const res = await apiRequest('POST', `/api/templates/${id}/instantiate`, { name, parameters });
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Pipeline Created",
                description: `Successfully created pipeline "${data.name}"`,
            });
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
            setLocation(`/operations/workstreams/${data.id}`);
        },
        onError: (error) => {
            toast({
                title: "Error",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const deleteTemplateMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest('DELETE', `/api/templates/${id}`);
        },
        onSuccess: () => {
            toast({ title: "Template Deleted", description: "The template has been removed." });
            queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
        },
        onError: (error) => {
            toast({
                title: "Error",
                description: (error as Error).message,
                variant: "destructive",
            });
        },
    });

    if (error) {
        return (
            <div className="flex items-center justify-center p-12 text-red-500">
                Failed to load templates: {(error as Error).message}
            </div>
        );
    }

    const filteredTemplates = templates?.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || "").toLowerCase().includes(search.toLowerCase())
    );

    const handleInstantiate = () => {
        if (!selectedTemplate) return;

        // Check required params
        const required = selectedTemplate.parameterSchema?.required || [];
        const missing = required.filter((key: string) => !params[key]);

        if (missing.length > 0) {
            toast({
                title: "Missing Parameters",
                description: `Please provide: ${missing.join(", ")}`,
                variant: "destructive",
            });
            return;
        }

        instantiateMutation.mutate({
            id: selectedTemplate.id,
            name: params['name'] || `${selectedTemplate.name} Instance`,
            parameters: params,
        });
    };

    return (
        <div className="p-6 md:p-12 space-y-6 w-full max-w-full animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Template Gallery</h1>
                    <p className="text-muted-foreground">
                        Start quickly with pre-configured pipeline blueprints.
                    </p>
                </div>
            </div>

            <Card className="min-h-[500px]">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Available Blueprints</CardTitle>
                            <CardDescription>Select a template to configure and instantiate a new pipeline</CardDescription>
                        </div>
                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search templates..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center p-12">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredTemplates?.length === 0 && (
                                <div className="col-span-full text-center py-12 text-muted-foreground">
                                    No templates found matching your search.
                                </div>
                            )}
                            {filteredTemplates?.map((template) => (
                                <Card key={template.id} className="flex flex-col shadow-soft rounded-2xl border-none transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                                    <CardHeader>
                                        <div className="flex items-start justify-between">
                                            <div className="p-2 bg-primary/10 rounded-lg text-primary">
                                                <LayoutTemplate className="h-6 w-6" />
                                            </div>
                                            <div className="flex gap-2">
                                                {template.isFeatured && (
                                                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
                                                        Featured
                                                    </Badge>
                                                )}
                                                {can('settings:manage') && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                                                <Trash className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Template</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Are you sure you want to delete the template "{template.name}"? This action cannot be undone.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    className="bg-destructive hover:bg-destructive/90"
                                                                    onClick={() => deleteTemplateMutation.mutate(template.id)}
                                                                >
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </div>
                                        <CardTitle className="mt-4">{template.name}</CardTitle>
                                        <CardDescription className="line-clamp-2">
                                            {template.description}
                                        </CardDescription>
                                        {showOrgBadge && (
                                            <div className="mt-2">
                                                {template.organizationId ? (
                                                    <Badge variant="outline" className="text-xs font-normal">
                                                        <Building2 className="w-3 h-3 mr-1" />
                                                        {orgMap[template.organizationId] || `Org #${template.organizationId}`}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Global</span>
                                                )}
                                            </div>
                                        )}
                                    </CardHeader>
                                    <CardFooter className="mt-auto pt-4 flex flex-col gap-2">
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button
                                                    className="w-full"
                                                    onClick={() => {
                                                        setSelectedTemplate(template);
                                                        setParams({});
                                                    }}
                                                >
                                                    <Plus className="mr-2 h-4 w-4" />
                                                    Use Template
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Configure {selectedTemplate?.name}</DialogTitle>
                                                    <DialogDescription>
                                                        Provide the necessary parameters to create this pipeline.
                                                    </DialogDescription>
                                                </DialogHeader>

                                                <div className="grid gap-4 py-4">
                                                    <div className="grid gap-2">
                                                        <Label htmlFor="pipeline-name">Pipeline Name</Label>
                                                        <Input
                                                            id="pipeline-name"
                                                            placeholder="My New Pipeline"
                                                            value={params['name'] || ''}
                                                            onChange={(e) => setParams(prev => ({ ...prev, name: e.target.value }))}
                                                        />
                                                    </div>

                                                    {selectedTemplate?.parameterSchema?.properties && Object.entries(selectedTemplate.parameterSchema.properties).map(([key, schema]: [string, any]) => (
                                                        <div key={key} className="grid gap-2">
                                                            <Label htmlFor={key}>
                                                                {schema.title || key}
                                                                {selectedTemplate.parameterSchema.required?.includes(key) && <span className="text-red-500">*</span>}
                                                            </Label>
                                                            <Input
                                                                id={key}
                                                                placeholder={schema.description}
                                                                value={params[key] || ''}
                                                                onChange={(e) => setParams(prev => ({ ...prev, [key]: e.target.value }))}
                                                            />
                                                            {schema.description && (
                                                                <p className="text-xs text-muted-foreground">{schema.description}</p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>

                                                <DialogFooter>
                                                    <Button onClick={handleInstantiate} disabled={instantiateMutation.isPending}>
                                                        {instantiateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                        Create Pipeline
                                                    </Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>

                                        <Button
                                            className="w-full"
                                            variant="outline"
                                            onClick={() => setLocation(`/operations/templates/${template.id}/wizard`)}
                                        >
                                            <GitFork className="mr-2 h-4 w-4" />
                                            Build Template
                                        </Button>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div >
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

