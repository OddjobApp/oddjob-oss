import React from 'react';
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@domain-ui/core/ui/components/ui/tooltip";
import { Zap, Clock, AlertTriangle } from "lucide-react";
import { PipelinePerformanceEstimate } from "@/utils/pipeline-utils";

interface PipelinePerformanceBadgeProps {
    estimates: PipelinePerformanceEstimate;
}

export const PipelinePerformanceBadge: React.FC<PipelinePerformanceBadgeProps> = ({ estimates }) => {
    const { estimatedDuration, estimatedCost, recommendations } = estimates;

    return (
        <div className="flex items-center gap-2">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge variant="outline" className="flex items-center gap-1 cursor-help">
                            <Clock className="w-3 h-3" />
                            {estimatedDuration}s
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Estimated Execution Time</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge variant="outline" className="flex items-center gap-1 cursor-help">
                            <Zap className="w-3 h-3 text-yellow-500" />
                            ${estimatedCost.toFixed(4)}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Estimated Cost per Run</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {recommendations.length > 0 && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="destructive" className="flex items-center gap-1 cursor-help">
                                <AlertTriangle className="w-3 h-3" />
                                {recommendations.length} Issues
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                            <ul className="list-disc pl-4">
                                {recommendations.map((rec, i) => (
                                    <li key={i}>{rec}</li>
                                ))}
                            </ul>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
};
