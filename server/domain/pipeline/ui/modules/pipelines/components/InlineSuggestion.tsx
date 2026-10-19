import React, { useState, useCallback } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Progress } from '@domain-ui/core/ui/components/ui/progress';
import { Alert, AlertDescription } from '@domain-ui/core/ui/components/ui/alert';
import { 
  Sparkles, 
  Lightbulb, 
  CheckCircle, 
  X, 
  ChevronDown,
  ChevronUp,
  DollarSign,
  AlertTriangle
} from 'lucide-react';
import { usePipelineSuggestions, type PipelineSuggestion } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/usePipelineSuggestions';
import { cn } from '@/lib/utils';

interface InlineSuggestionProps {
  pipelineId?: number;
  pipeline?: any;
  onApplySuggestion: (suggestion: PipelineSuggestion) => void;
  className?: string;
  compact?: boolean;
}

export const InlineSuggestion: React.FC<InlineSuggestionProps> = ({
  pipelineId,
  pipeline,
  onApplySuggestion,
  className,
  compact = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [showAll, setShowAll] = useState(false);

  const {
    getSuggestions,
    isGettingSuggestions
  } = usePipelineSuggestions();

  const handleGenerateSuggestions = useCallback(async () => {
    if (!pipelineId && !pipeline) {
      return;
    }

    try {
      const result = await getSuggestions({ 
        pipelineId, 
        pipeline,
        options: {
          maxSuggestions: 3,
          includeCostEstimate: true,
          suggestionType: 'next_step'
        }
      });
      setSuggestions(result);
      setIsExpanded(true);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    }
  }, [pipelineId, pipeline, getSuggestions]);

  const handleApplySuggestion = useCallback(async (suggestion: PipelineSuggestion) => {
    onApplySuggestion(suggestion);
    // Remove the applied suggestion from the list
    if (suggestions) {
      setSuggestions({
        ...suggestions,
        suggestions: suggestions.suggestions.filter((s: any) => s.nodeId !== suggestion.nodeId)
      });
    }
  }, [onApplySuggestion, suggestions]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50 border-green-200';
    if (confidence >= 0.6) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  if (!suggestions) {
    return (
      <div className={cn("w-full", className)}>
        <Button
          variant="outline"
          onClick={handleGenerateSuggestions}
          disabled={isGettingSuggestions}
          className={cn(
            "w-full h-auto p-4 flex items-center justify-center gap-2 border-dashed",
            "hover:border-primary hover:bg-primary/5 transition-colors"
          )}
        >
          {isGettingSuggestions ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              <span className="text-sm">Generating suggestions...</span>
            </>
          ) : (
            <>
              <Lightbulb className="w-4 h-4" />
              <span className="text-sm">Get AI suggestions for next steps</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  const displaySuggestions = showAll ? suggestions.suggestions : suggestions.suggestions.slice(0, 2);

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">
            AI Suggestions ({suggestions.suggestions.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {suggestions.cost.tokensUsed > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              ${suggestions.cost.estimatedCost.toFixed(4)}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-3">
          {displaySuggestions.map((suggestion: PipelineSuggestion, index: number) => (
            <Card key={suggestion.nodeId || index} className="border-l-4 border-l-primary">
              <CardContent className="p-3">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {suggestion.nodeType}
                        </Badge>
                        <div className={cn(
                          "px-2 py-1 rounded text-xs font-medium border",
                          getConfidenceColor(suggestion.confidence)
                        )}>
                          {Math.round(suggestion.confidence * 100)}% confidence
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {suggestion.reason}
                      </p>
                    </div>
                  </div>

                  {suggestion.suggestedConfiguration && (
                    <Alert>
                      <AlertDescription className="text-xs">
                        <strong>Suggested config:</strong> {JSON.stringify(suggestion.suggestedConfiguration, null, 2)}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => handleApplySuggestion(suggestion)}
                      className="flex-1"
                    >
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Apply
                    </Button>
                    <Progress value={suggestion.confidence * 100} className="w-12 h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {!showAll && suggestions.suggestions.length > 2 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(true)}
              className="w-full"
            >
              Show {suggestions.suggestions.length - 2} more suggestions
            </Button>
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {suggestions.context.pipelineStepCount} steps in pipeline
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateSuggestions}
              disabled={isGettingSuggestions}
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Refresh
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

