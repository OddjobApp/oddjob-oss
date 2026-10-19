import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { ScoringRuleTemplate } from "@shared/schema/scoring";
import { Loader2, Box, MousePointerClick, AlertTriangle, FastForward, CheckCircle, XCircle, RefreshCw, AlertCircle } from "lucide-react";

export interface RuleTemplate {
    id: string;
    name: string;
    description: string;
    icon: string | React.ElementType; // Handling string from DB or component from legacy
    config: {
        activity: string;
        vector: string;
        weight: number;
        priority: string;
        activityModifier?: number;
        elementType?: string;
        pageState?: string;
        triggeredAction?: any;
    }
}

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

interface RuleTemplateSelectorProps {
    onSelect: (template: RuleTemplate) => void;
}

export function RuleTemplateSelector({ onSelect }: RuleTemplateSelectorProps) {
    const { data: templates, isLoading } = useQuery<ScoringRuleTemplate[]>({
        queryKey: ['/api/scoring/templates'],
    });

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-48">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!templates || templates.length === 0) {
        return (
            <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                No templates available. Create one in the Templates tab.
            </div>
        );
    }

    return (
        <ScrollArea className="h-[60vh] pr-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map((template) => {
                    const IconComponent = template.icon ? (ICON_MAP[template.icon] || Box) : Box;
                    // Compatibility map for ScoringRuleForm (which expects specific structure)
                    // The DB 'config' is JSONB, so it matches.
                    // The 'onSelect' in form usually extracts config.

                    return (
                        <Card
                            key={template.id}
                            className="cursor-pointer hover:border-primary transition-colors group relative overflow-hidden"
                            onClick={() => onSelect({
                                ...template,
                                description: template.description || '',
                                icon: template.icon || '',
                                config: template.config as unknown as RuleTemplate['config']
                            })}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <CardHeader className="p-4">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <IconComponent className="w-4 h-4 text-primary" />
                                            {template.name}
                                        </CardTitle>
                                        <div className="flex gap-2">
                                            <Badge variant="outline" className="text-xs font-normal">
                                                Vector: {(template.config as any)?.vector || 'N/A'}
                                            </Badge>
                                            <Badge variant="outline" className="text-xs font-normal">
                                                Priority: {(template.config as any)?.priority || 'medium'}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <CardDescription className="text-xs line-clamp-2">
                                    {template.description}
                                </CardDescription>
                                {(template.config as any)?.triggeredAction && (
                                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                        Includes Action: {(template.config as any)?.triggeredAction?.type}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </ScrollArea>
    );
}
