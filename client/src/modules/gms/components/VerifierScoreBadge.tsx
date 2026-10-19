/**
 * Verifier Score Badge
 * 
 * Shows neural verifier confidence score on mission cards.
 * Color-coded based on success probability.
 */

import React from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Brain, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";

interface VerifierScoreBadgeProps {
  score: {
    successProbability: number;
    confidence: number;
    latencyEstimate: number;
    costEstimate: number;
    riskFactors: Array<{ type: string; severity: string }>;
  };
  size?: "sm" | "md" | "lg";
  showDetails?: boolean;
}

export const VerifierScoreBadge: React.FC<VerifierScoreBadgeProps> = ({
  score,
  size = "md",
  showDetails = true
}) => {
  const { successProbability, confidence, latencyEstimate, costEstimate, riskFactors } = score;

  const getVariant = () => {
    if (successProbability >= 0.8) return "default";
    if (successProbability >= 0.6) return "secondary";
    return "destructive";
  };

  const getIcon = () => {
    if (successProbability >= 0.8) return <CheckCircle className="h-3 w-3" />;
    if (successProbability >= 0.6) return <AlertTriangle className="h-3 w-3" />;
    return <XCircle className="h-3 w-3" />;
  };

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0",
    md: "text-sm px-2 py-0.5",
    lg: "text-base px-3 py-1"
  };

  const hasHighSeverityRisks = riskFactors.some(r => r.severity === "high");

  const tooltipContent = (
    <div className="space-y-2 max-w-xs">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <span className="font-medium">Neural Verifier Score</span>
      </div>
      
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Success Probability:</span>
          <span className="font-medium">{(successProbability * 100).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Confidence:</span>
          <span className="font-medium">{(confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Est. Latency:</span>
          <span className="font-medium">{(latencyEstimate / 1000).toFixed(1)}s</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Est. Cost:</span>
          <span className="font-medium">${costEstimate.toFixed(3)}</span>
        </div>
      </div>

      {riskFactors.length > 0 && (
        <>
          <div className="border-t pt-2">
            <span className="text-xs text-muted-foreground">Risk Factors:</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {riskFactors.map((risk, idx) => (
              <Badge 
                key={idx} 
                variant={risk.severity === "high" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {risk.type}
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const badge = (
    <Badge 
      variant={getVariant()} 
      className={`${sizeClasses[size]} flex items-center gap-1 ${hasHighSeverityRisks ? 'animate-pulse' : ''}`}
    >
      {getIcon()}
      <span>{(successProbability * 100).toFixed(0)}%</span>
      {hasHighSeverityRisks && <span className="ml-0.5">⚠️</span>}
    </Badge>
  );

  if (!showDetails) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default VerifierScoreBadge;
