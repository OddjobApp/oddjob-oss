import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Save, X } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { ResponseTemplate } from "@/types/agent-types";

interface ResponseTemplateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: any) => void;
    editingTemplate: ResponseTemplate | null;
    isPending: boolean;
    categories: string[];
    availableTags: string[];
}

export default function ResponseTemplateDialog({
    open,
    onOpenChange,
    onSubmit,
    editingTemplate,
    isPending,
    categories,
    availableTags
}: ResponseTemplateDialogProps) {
    const { toast } = useToast();

    // Template form state
    const [templateForm, setTemplateForm] = useState({
        name: "",
        description: "",
        category: "",
        tags: [] as string[],
        scenario: "",
        userQuery: "",
        preferredResponse: "",
        reasoning: ""
    });

    // Reset form when dialog opens/closes or editing template changes
    useEffect(() => {
        if (open) {
            if (editingTemplate) {
                setTemplateForm({
                    name: editingTemplate.name,
                    description: editingTemplate.description,
                    category: editingTemplate.category,
                    tags: editingTemplate.tags || [],
                    scenario: editingTemplate.scenario,
                    userQuery: editingTemplate.userQuery,
                    preferredResponse: editingTemplate.preferredResponse,
                    reasoning: editingTemplate.reasoning
                });
            } else {
                setTemplateForm({
                    name: "",
                    description: "",
                    category: "",
                    tags: [],
                    scenario: "",
                    userQuery: "",
                    preferredResponse: "",
                    reasoning: ""
                });
            }
        }
    }, [open, editingTemplate]);

    const handleSaveTemplate = () => {
        if (!templateForm.name.trim()) {
            toast({
                title: "Name required",
                description: "Please provide a name for the template.",
                variant: "destructive",
            });
            return;
        }

        if (!templateForm.category) {
            toast({
                title: "Category required",
                description: "Please select a category for the template.",
                variant: "destructive",
            });
            return;
        }

        if (!templateForm.userQuery.trim() || !templateForm.preferredResponse.trim()) {
            toast({
                title: "Content required",
                description: "Please provide both user query and preferred response.",
                variant: "destructive",
            });
            return;
        }

        onSubmit(templateForm);
    };

    const toggleTag = (tag: string) => {
        setTemplateForm(prev => ({
            ...prev,
            tags: prev.tags.includes(tag)
                ? prev.tags.filter(t => t !== tag)
                : [...prev.tags, tag]
        }));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {editingTemplate ? 'Edit Response Template' : 'Create Response Template'}
                    </DialogTitle>
                    <DialogDescription>
                        Define a preferred response pattern that agents can learn from and apply in similar situations.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="template-name">Template Name *</Label>
                            <Input
                                id="template-name"
                                value={templateForm.name}
                                onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g., Code Review Response"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="template-category">Category *</Label>
                            <Select
                                value={templateForm.category}
                                onValueChange={(value) => setTemplateForm(prev => ({ ...prev, category: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map(category => (
                                        <SelectItem key={category} value={category}>
                                            {category}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="template-description">Description</Label>
                        <Textarea
                            id="template-description"
                            value={templateForm.description}
                            onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Brief description of when to use this template"
                            rows={2}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Tags</Label>
                        <div className="flex flex-wrap gap-2">
                            {availableTags.map(tag => (
                                <Badge
                                    key={tag}
                                    variant={templateForm.tags.includes(tag) ? "default" : "outline"}
                                    className="cursor-pointer"
                                    onClick={() => toggleTag(tag)}
                                >
                                    {tag}
                                </Badge>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="template-scenario">Scenario/Context</Label>
                        <Textarea
                            id="template-scenario"
                            value={templateForm.scenario}
                            onChange={(e) => setTemplateForm(prev => ({ ...prev, scenario: e.target.value }))}
                            placeholder="Describe the situation where this response should be used"
                            rows={2}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="user-query">User Query *</Label>
                            <Textarea
                                id="user-query"
                                value={templateForm.userQuery}
                                onChange={(e) => setTemplateForm(prev => ({ ...prev, userQuery: e.target.value }))}
                                placeholder="The user's question or request"
                                rows={4}
                                className="font-mono text-sm"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="preferred-response">Preferred Response *</Label>
                            <Textarea
                                id="preferred-response"
                                value={templateForm.preferredResponse}
                                onChange={(e) => setTemplateForm(prev => ({ ...prev, preferredResponse: e.target.value }))}
                                placeholder="The ideal agent response"
                                rows={4}
                                className="font-mono text-sm"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="template-reasoning">Reasoning</Label>
                        <Textarea
                            id="template-reasoning"
                            value={templateForm.reasoning}
                            onChange={(e) => setTemplateForm(prev => ({ ...prev, reasoning: e.target.value }))}
                            placeholder="Explain why this response is preferred and what makes it effective"
                            rows={3}
                        />
                    </div>
                </div>

                <div className="flex justify-end space-x-2 pt-4">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isPending}
                    >
                        <X className="w-4 h-4 mr-2" />
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSaveTemplate}
                        disabled={isPending}
                    >
                        <Save className="w-4 h-4 mr-2" />
                        {isPending ? 'Saving...' : 'Save Template'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

