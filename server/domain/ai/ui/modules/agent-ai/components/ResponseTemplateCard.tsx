import React from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import {
    MoreHorizontal,
    Edit3,
    Play,
    Lightbulb,
    Trash2,
    Zap,
    CheckCircle,
    BookOpen,
    Star,
    MessageSquare
} from "lucide-react";
import { ResponseTemplate } from "@/types/agent-types";

interface ResponseTemplateCardProps {
    template: ResponseTemplate;
    onEdit: (template: ResponseTemplate) => void;
    onApply: (template: ResponseTemplate) => void;
    onAnalyze: (template: ResponseTemplate) => void;
    onDelete: (template: ResponseTemplate) => void;
    isApplyPending?: boolean;
}

const getCategoryIcon = (category: string) => {
    switch (category) {
        case "Technical Support": return <Zap className="w-4 h-4" />;
        case "Code Review": return <CheckCircle className="w-4 h-4" />;
        case "Documentation": return <BookOpen className="w-4 h-4" />;
        case "Security": return <Star className="w-4 h-4" />;
        case "Performance": return <Zap className="w-4 h-4" />;
        default: return <MessageSquare className="w-4 h-4" />;
    }
};

export default function ResponseTemplateCard({
    template,
    onEdit,
    onApply,
    onAnalyze,
    onDelete,
    isApplyPending
}: ResponseTemplateCardProps) {
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        {getCategoryIcon(template.category)}
                        <CardTitle className="text-base">{template.name}</CardTitle>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(template)}>
                                <Edit3 className="w-4 h-4 mr-2" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onApply(template)}>
                                <Play className="w-4 h-4 mr-2" />
                                Apply to Agent
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAnalyze(template)}>
                                <Lightbulb className="w-4 h-4 mr-2" />
                                Analyze Effectiveness
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onDelete(template)}
                                className="text-red-600"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="text-sm text-foreground/90 line-clamp-2 mt-1 px-0.5">
                    {template.description}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                    <Badge variant="outline" className="text-xs">
                        {template.category}
                    </Badge>
                    <div className="flex items-center gap-1 text-muted-foreground">
                        <Star className="w-3 h-3" />
                        {Math.round(template.effectiveness * 100)}%
                    </div>
                </div>

                <div className="flex flex-wrap gap-1">
                    {template.tags && template.tags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                        </Badge>
                    ))}
                    {template.tags && template.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                            +{template.tags.length - 3}
                        </Badge>
                    )}
                </div>

                <div className="text-xs text-muted-foreground">
                    Used {template.usageCount} times • {template.isActive ? 'Active' : 'Inactive'}
                </div>

                <div className="pt-2 border-t">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => onApply(template)}
                        disabled={isApplyPending}
                    >
                        <Play className="w-3 h-3 mr-1" />
                        Apply to Agent
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
