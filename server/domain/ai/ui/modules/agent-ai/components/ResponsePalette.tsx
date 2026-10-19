import React, { useState } from "react";
import {
    Card,
    CardContent,
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import {
    Palette,
    Plus,
    Search
} from "lucide-react";
import { useResponseTemplates } from "@domain-ui/core/ui/hooks/use-response-templates";
import ResponseTemplateCard from './ResponseTemplateCard.js';
import ResponseTemplateDialog from './ResponseTemplateDialog.js';
import { ResponseTemplate } from "@/types/agent-types";

interface ResponsePaletteProps {
    selectedRunId: string | null;
}

const CATEGORIES = [
    "General Assistance",
    "Technical Support",
    "Code Review",
    "Documentation",
    "Troubleshooting",
    "Best Practices",
    "Security",
    "Performance",
    "API Usage",
    "Custom"
];

const TAGS = [
    "helpful", "accurate", "concise", "detailed", "step-by-step",
    "code-example", "explanation", "troubleshooting", "best-practice",
    "security", "performance", "api", "documentation", "beginner-friendly"
];

export default function ResponsePalette({ selectedRunId }: ResponsePaletteProps) {
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<ResponseTemplate | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const [selectedTag, setSelectedTag] = useState<string>("all");

    // Use custom hook for data and mutations
    const {
        templates,
        templatesLoading,
        templateMutation,
        deleteMutation,
        applyMutation,
        analyzeMutation
    } = useResponseTemplates(selectedRunId);

    const handleCreateTemplate = () => {
        setEditingTemplate(null);
        setIsCreateDialogOpen(true);
    };

    const handleEditTemplate = (template: ResponseTemplate) => {
        setEditingTemplate(template);
        setIsCreateDialogOpen(true);
    };

    const handleDeleteTemplate = (template: ResponseTemplate) => {
        if (confirm(`Are you sure you want to delete the template "${template.name}"?`)) {
            deleteMutation.mutate(template.id);
        }
    };

    const handleApplyTemplate = (template: ResponseTemplate) => {
        applyMutation.mutate(template.id);
    };

    const handleAnalyzeTemplate = (template: ResponseTemplate) => {
        analyzeMutation.mutate(template.id);
    };

    const handleFormSubmit = (data: any) => {
        templateMutation.mutate({
            id: editingTemplate?.id,
            data
        });
        setIsCreateDialogOpen(false);
    };

    // Filter templates based on search and filters
    const filteredTemplates = templates.filter(template => {
        const matchesSearch = searchQuery === "" ||
            template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            template.scenario.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesCategory = selectedCategory === "all" || template.category === selectedCategory;
        const matchesTag = selectedTag === "all" || template.tags.includes(selectedTag);

        return matchesSearch && matchesCategory && matchesTag;
    });

    return (
        <div className="flex-1 min-h-0 bg-muted/50 p-6 overflow-auto">
            <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Palette className="w-5 h-5 text-primary" />
                            Response Palette
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Create and manage preferred response templates for agent training
                        </p>
                    </div>
                    <Button onClick={handleCreateTemplate}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Template
                    </Button>
                </div>

                {/* Search and Filters */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-1">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                                    <Input
                                        placeholder="Search templates..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-10"
                                    />
                                </div>
                            </div>
                            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                                <SelectTrigger className="w-48">
                                    <SelectValue placeholder="All Categories" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Categories</SelectItem>
                                    {CATEGORIES.map(category => (
                                        <SelectItem key={category} value={category}>
                                            {category}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={selectedTag} onValueChange={setSelectedTag}>
                                <SelectTrigger className="w-48">
                                    <SelectValue placeholder="All Tags" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Tags</SelectItem>
                                    {TAGS.map(tag => (
                                        <SelectItem key={tag} value={tag}>
                                            {tag}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>

                {/* Templates Grid */}
                {templatesLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Loading response templates...</p>
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <Card>
                        <CardContent className="text-center py-12">
                            <Palette className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                            <h3 className="text-lg font-semibold mb-2">No Response Templates</h3>
                            <p className="text-muted-foreground mb-4">
                                Create your first response template to help train agents with preferred responses.
                            </p>
                            <Button onClick={handleCreateTemplate}>
                                <Plus className="w-4 h-4 mr-2" />
                                Create First Template
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredTemplates.map((template) => (
                            <ResponseTemplateCard
                                key={template.id}
                                template={template}
                                onEdit={handleEditTemplate}
                                onApply={handleApplyTemplate}
                                onAnalyze={handleAnalyzeTemplate}
                                onDelete={handleDeleteTemplate}
                                isApplyPending={applyMutation.isPending}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Create/Edit Template Dialog */}
            <ResponseTemplateDialog
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
                onSubmit={handleFormSubmit}
                editingTemplate={editingTemplate}
                isPending={templateMutation.isPending}
                categories={CATEGORIES}
                availableTags={TAGS}
            />
        </div>
    );
}

