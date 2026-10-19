import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@domain-ui/core/ui/components/ui/dialog";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Plus, Trash2, Edit2, Shield, MousePointerClick, AlertTriangle, FastForward, CheckCircle, XCircle, RefreshCw, Box, AlertCircle } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import * as Icons from "lucide-react";
import { ScoringRuleTemplate } from "@shared/schema/scoring";

// Icon mapping (expand as needed or dynamic)
const ICON_MAP: Record<string, React.ElementType> = {
    MousePointerClick,
    AlertTriangle,
    FastForward,
    CheckCircle,
    XCircle,
    RefreshCw,
    Box,
    AlertCircle
};

export function ScoringTemplateManager() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<ScoringRuleTemplate | null>(null);

    // Fetch Templates
    const { data: templates = [], isLoading } = useQuery<ScoringRuleTemplate[]>({
        queryKey: ['/api/scoring/templates'],
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: async (data: Partial<ScoringRuleTemplate>) => {
            const res = await apiRequest('POST', '/api/scoring/templates', data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/scoring/templates'] });
            toast({ title: "Template Created", description: "New scoring template has been added." });
            setIsDialogOpen(false);
        },
        onError: () => toast({ title: "Error", description: "Failed to create template.", variant: "destructive" })
    });

    const updateMutation = useMutation({
        mutationFn: async (data: ScoringRuleTemplate) => {
            const res = await apiRequest('PUT', `/api/scoring/templates/${data.id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/scoring/templates'] });
            toast({ title: "Template Updated", description: "Changes saved successfully." });
            setIsDialogOpen(false);
            setEditingTemplate(null);
        },
        onError: () => toast({ title: "Error", description: "Failed to update template.", variant: "destructive" })
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await apiRequest('DELETE', `/api/scoring/templates/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/scoring/templates'] });
            toast({ title: "Template Deleted", description: "Template removed." });
        },
        onError: () => toast({ title: "Error", description: "Failed to delete template.", variant: "destructive" })
    });

    // Form Handling
    const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name') as string,
            description: formData.get('description') as string,
            icon: formData.get('icon') as string,
            config: JSON.parse(formData.get('config') as string),
        };

        if (editingTemplate) {
            updateMutation.mutate({ ...editingTemplate, ...data });
        } else {
            createMutation.mutate(data);
        }
    };

    const openCreateDialog = () => {
        setEditingTemplate(null);
        setIsDialogOpen(true);
    };

    const openEditDialog = (template: ScoringRuleTemplate) => {
        setEditingTemplate(template);
        setIsDialogOpen(true);
    };

    if (isLoading) return <div>Loading templates...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">Manage starting points for new scoring rules.</p>
                <Button onClick={openCreateDialog}><Plus className="w-4 h-4 mr-2" /> New Template</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map((template) => {
                    const IconComponent = template.icon ? (ICON_MAP[template.icon] || Box) : Box;
                    return (
                        <Card key={template.id} className="relative group hover:border-primary transition-colors">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-2">
                                        <div className="p-2 bg-muted rounded-md">
                                            <IconComponent className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-base">{template.name}</CardTitle>

                                        </div>
                                    </div>
                                    {template.isSystem && (
                                        <Badge variant="secondary" className="text-xs">
                                            <Shield className="w-3 h-3 mr-1" /> System
                                        </Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <CardDescription className="line-clamp-2 min-h-[2.5rem] mb-4">
                                    {template.description}
                                </CardDescription>
                                <div className="flex gap-2 mb-4">
                                    <Badge variant="outline" className="text-xs font-normal">
                                        Vector: {(template.config as any)?.vector || 'N/A'}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs font-normal">
                                        Priority: {(template.config as any)?.priority || 'medium'}
                                    </Badge>
                                </div>

                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(template)}>
                                        <Edit2 className="w-4 h-4" />
                                    </Button>
                                    {!template.isSystem && (
                                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => {
                                            if (confirm("Are you sure you want to delete this template?")) {
                                                deleteMutation.mutate(template.id);
                                            }
                                        }}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingTemplate ? 'Edit Template' : 'Create Template'}</DialogTitle>
                        <DialogDescription>
                            Configure the default settings for this rule template.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Template Name</Label>
                            <Input id="name" name="name" defaultValue={editingTemplate?.name} required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="description">Description</Label>
                            <Input id="description" name="description" defaultValue={editingTemplate?.description || ''} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="icon">Icon Name (Lucide)</Label>
                            <Input id="icon" name="icon" defaultValue={editingTemplate?.icon || 'Box'} placeholder="e.g. Activity, AlertTriangle" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="config">Config (JSON)</Label>
                            <Textarea
                                id="config"
                                name="config"
                                className="font-mono text-xs h-32"
                                defaultValue={JSON.stringify(editingTemplate?.config || {
                                    vector: "S",
                                    weight: 1.0,
                                    priority: "medium",
                                    activity: "click"
                                }, null, 2)}
                                required
                            />
                            <p className="text-[10px] text-muted-foreground">JSON Object containing initial scoring rule properties.</p>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                            <Button type="submit">Save Template</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

