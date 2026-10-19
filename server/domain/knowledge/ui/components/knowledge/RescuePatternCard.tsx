/**
 * Rescue Pattern Card
 * 
 * Special card component for displaying rescue-derived knowledge patterns.
 * Shows success metrics, recovery strategies, and application actions.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { 
    LifeBuoy, 
    TrendingUp, 
    CheckCircle2, 
    Clock,
    Copy,
    Play,
    ExternalLink,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    Zap,
    History
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { 
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@domain-ui/core/ui/components/ui/collapsible";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";

interface RescuePattern {
    id: number;
    problemType: string;
    failureContext: string;
    recoveryStrategy: string;
    successCount: number;
    successRate?: number;
    capturedAt: string;
    sessionId?: number;
    missionId?: number;
    originalServiceType?: string;
    triageSummary?: string;
}

interface RescuePatternCardProps {
    pattern: RescuePattern;
    compact?: boolean;
    showApplyButton?: boolean;
    currentMissionId?: number;
}

export function RescuePatternCard({ 
    pattern, 
    compact = false, 
    showApplyButton = false,
    currentMissionId 
}: RescuePatternCardProps) {
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(!compact);

    const applyPattern = useMutation({
        mutationFn: async () => {
            if (!currentMissionId) throw new Error("No current mission");
            const res = await apiRequest("POST", `/api/missions/${currentMissionId}/apply-rescue-pattern`, {
                patternId: pattern.id,
            });
            if (!res.ok) throw new Error("Failed to apply pattern");
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Pattern Applied",
                description: "The rescue strategy has been applied to your mission",
            });
        },
        onError: () => {
            toast({
                title: "Application Failed",
                description: "Could not apply the rescue pattern",
                variant: "destructive",
            });
        },
    });

    const copyStrategy = () => {
        navigator.clipboard.writeText(pattern.recoveryStrategy);
        toast({
            title: "Copied",
            description: "Recovery strategy copied to clipboard",
        });
    };

    // Compact view for lists
    if (compact) {
        return (
            <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <LifeBuoy className="w-4 h-4 text-amber-500" />
                                <span className="font-medium text-sm truncate">
                                    {pattern.problemType}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                                {pattern.recoveryStrategy}
                            </p>
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0">
                            <Badge 
                                variant={pattern.successCount > 3 ? "default" : "secondary"}
                                className="text-xs gap-1"
                            >
                                <CheckCircle2 className="w-3 h-3" />
                                {pattern.successCount}
                            </Badge>
                            
                            {showApplyButton && currentMissionId && (
                                <Button 
                                    size="sm" 
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={() => applyPattern.mutate()}
                                    disabled={applyPattern.isPending}
                                >
                                    <Play className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Full expanded view
    return (
        <Card className="border-l-4 border-l-amber-500">
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-500/10 rounded-lg">
                                <LifeBuoy className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <CardTitle className="text-lg">Rescue Pattern</CardTitle>
                                <CardDescription className="line-clamp-1">
                                    {pattern.problemType}
                                </CardDescription>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <Badge 
                                variant={pattern.successCount >= 5 ? "default" : "secondary"}
                                className="gap-1"
                            >
                                <TrendingUp className="w-3 h-3" />
                                {pattern.successCount} successes
                            </Badge>
                            
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    {isExpanded ? (
                                        <ChevronUp className="w-4 h-4" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4" />
                                    )}
                                </Button>
                            </CollapsibleTrigger>
                        </div>
                    </div>
                </CardHeader>

                <CollapsibleContent>
                    <CardContent className="space-y-4 pt-0">
                        {/* Success Metrics */}
                        {pattern.successRate !== undefined && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">Success Rate</span>
                                    <span className="font-medium">{Math.round(pattern.successRate * 100)}%</span>
                                </div>
                                <Progress value={pattern.successRate * 100} className="h-2" />
                            </div>
                        )}

                        {/* Problem Section */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                Problem
                            </h4>
                            <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                                {pattern.problemType}
                            </p>
                        </div>

                        {/* Context Section */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium text-muted-foreground">Failure Context</h4>
                            <p className="text-sm text-muted-foreground">
                                {pattern.failureContext}
                            </p>
                        </div>

                        {/* Recovery Strategy */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium flex items-center gap-2">
                                <Zap className="w-4 h-4 text-blue-500" />
                                Recovery Strategy
                            </h4>
                            <div className="bg-blue-500/5 border border-blue-500/20 p-3 rounded-lg">
                                <p className="text-sm font-medium">
                                    {pattern.recoveryStrategy}
                                </p>
                            </div>
                            
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="gap-2"
                                onClick={copyStrategy}
                            >
                                <Copy className="w-4 h-4" />
                                Copy Strategy
                            </Button>
                        </div>

                        {/* Triage Summary */}
                        {pattern.triageSummary && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium text-muted-foreground">Original Triage Summary</h4>
                                <p className="text-sm italic text-muted-foreground">
                                    "{pattern.triageSummary}"
                                </p>
                            </div>
                        )}

                        {/* Metadata */}
                        <div className="flex flex-wrap gap-3 pt-2 border-t text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Captured {new Date(pattern.capturedAt).toLocaleDateString()}
                            </div>
                            
                            {pattern.originalServiceType && (
                                <Badge variant="outline" className="text-xs">
                                    {pattern.originalServiceType}
                                </Badge>
                            )}
                            
                            {pattern.sessionId && (
                                <div className="flex items-center gap-1">
                                    <History className="w-3 h-3" />
                                    Session #{pattern.sessionId}
                                </div>
                            )}
                        </div>

                        {/* Apply Button */}
                        {showApplyButton && currentMissionId && (
                            <div className="pt-2">
                                <Button 
                                    className="w-full gap-2"
                                    onClick={() => applyPattern.mutate()}
                                    disabled={applyPattern.isPending}
                                >
                                    <Play className="w-4 h-4" />
                                    {applyPattern.isPending ? "Applying..." : "Apply to Current Mission"}
                                </Button>
                            </div>
                        )}

                        {/* Links */}
                        <div className="flex gap-2 pt-2">
                            {pattern.sessionId && (
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="gap-2"
                                    onClick={() => window.open(`/rescues/${pattern.sessionId}`, '_blank')}
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    View Original Rescue
                                </Button>
                            )}
                            
                            {pattern.missionId && (
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="gap-2"
                                    onClick={() => window.open(`/missions/${pattern.missionId}`, '_blank')}
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    View Mission
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}

export default RescuePatternCard;
