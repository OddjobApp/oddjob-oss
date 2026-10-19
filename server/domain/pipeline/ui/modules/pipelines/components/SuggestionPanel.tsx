import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Progress } from '@domain-ui/core/ui/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@domain-ui/core/ui/components/ui/alert';
import { 
  Lightbulb, 
  TrendingUp, 
  CheckCircle, 
  AlertTriangle, 
  Info,
  Sparkles,
  Settings,
  DollarSign,
  Target
} from 'lucide-react';
import { usePipelineSuggestions, type PipelineSuggestion, type SuggestionResponse } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/usePipelineSuggestions';
import { cn } from '@/lib/utils';

interface SuggestionPanelProps {
  pipelineId?: number;
  pipeline?: any;
  onApplySuggestion: (suggestion: PipelineSuggestion) => void;
  className?: string;
  visible?: boolean;
}

export const SuggestionPanel: React.FC<SuggestionPanelProps> = ({
  pipelineId,
  pipeline,
  onApplySuggestion,
  className,
  visible = true
}) => {
  const [activeTab, setActiveTab] = useState('suggestions');
  const [selectedSuggestion, setSelectedSuggestion] = useState<PipelineSuggestion | null>(null);
  
  const {
    getSuggestions,
    isGettingSuggestions,
    availableJobs,
    commonPatterns,
    analytics
  } = usePipelineSuggestions();

  const [suggestions, setSuggestions] = useState<SuggestionResponse | null>(null);

  const handleGenerateSuggestions = useCallback(async () => {
    if (!pipelineId && !pipeline) {
      return;
    }

    try {
      const result = await getSuggestions({ 
        pipelineId, 
        pipeline,
        options: {
          maxSuggestions: 5,
          includeCostEstimate: true,
          suggestionType: 'next_step'
        }
      });
      setSuggestions(result);
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
        suggestions: suggestions.suggestions.filter(s => s.nodeId !== suggestion.nodeId)
      });
    }
  }, [pipelineId, pipeline, onApplySuggestion, suggestions]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-500';
    if (confidence >= 0.6) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getConfidenceText = (confidence: number) => {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    return 'Low';
  };

  if (!visible) {
    return null;
  }

  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          AI Assistant
        </CardTitle>
        <CardDescription>
          Get intelligent suggestions to enhance your pipeline
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="suggestions" className="text-xs">
              <Lightbulb className="w-3 h-3 mr-1" />
              Suggestions
            </TabsTrigger>
            <TabsTrigger value="patterns" className="text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              Patterns
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs">
              <Target className="w-3 h-3 mr-1" />
              Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggestions" className="space-y-4">
            {!suggestions ? (
              <div className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>AI-Powered Suggestions</AlertTitle>
                  <AlertDescription>
                    Get intelligent recommendations for the next logical steps in your pipeline based on your current context and common patterns.
                  </AlertDescription>
                </Alert>
                
                <Button 
                  onClick={handleGenerateSuggestions}
                  disabled={isGettingSuggestions}
                  className="w-full"
                >
                  {isGettingSuggestions ? (
                    <>
                      <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                      Generating Suggestions...
                    </>
                  ) : (
                    <>
                      <Lightbulb className="w-4 h-4 mr-2" />
                      Generate Suggestions
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Found {suggestions.suggestions.length} suggestions</span>
                  <Button variant="outline" size="sm" onClick={handleGenerateSuggestions}>
                    <Sparkles className="w-3 h-3 mr-1" />
                    Refresh
                  </Button>
                </div>

                {(suggestions.cost.tokensUsed > 0 || suggestions.cost.estimatedCost > 0) && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <DollarSign className="w-3 h-3" />
                    {suggestions.cost.tokensUsed} tokens used • ${suggestions.cost.estimatedCost.toFixed(4)} estimated cost
                  </div>
                )}

                <div className="space-y-3">
                  {suggestions.suggestions.map((suggestion, index) => (
                    <Card 
                      key={suggestion.nodeId || index} 
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-md",
                        selectedSuggestion?.nodeId === suggestion.nodeId && "ring-2 ring-primary"
                      )}
                      onClick={() => setSelectedSuggestion(suggestion)}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">
                                  {suggestion.nodeType}
                                </Badge>
                                <Badge 
                                  variant="outline" 
                                  className={cn("text-xs", getConfidenceColor(suggestion.confidence))}
                                >
                                  {getConfidenceText(suggestion.confidence)} ({Math.round(suggestion.confidence * 100)}%)
                                </Badge>
                              </div>
                            </div>
                            <Progress value={suggestion.confidence * 100} className="w-16 h-2" />
                          </div>

                          <p className="text-sm text-muted-foreground">
                            {suggestion.reason}
                          </p>

                          {suggestion.estimatedCost && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <DollarSign className="w-3 h-3" />
                              Est. ${suggestion.estimatedCost.toFixed(4)}
                            </div>
                          )}

                          <Button 
                            size="sm" 
                            className="w-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApplySuggestion(suggestion);
                            }}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Apply Suggestion
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="patterns" className="space-y-4">
            {commonPatterns ? (
              <div className="space-y-3">
                <Alert>
                  <TrendingUp className="h-4 w-4" />
                  <AlertTitle>Common Pipeline Patterns</AlertTitle>
                  <AlertDescription>
                    Based on analysis of successful pipelines in your organization
                  </AlertDescription>
                </Alert>

                {commonPatterns.patterns.map((pattern, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
                    <CheckCircle className="w-4 h-4 mt-0.5 text-green-600" />
                    <div>
                      <p className="text-sm">{pattern}</p>
                    </div>
                  </div>
                ))}

                <div className="text-xs text-muted-foreground text-center">
                  Last updated: {new Date(commonPatterns.lastUpdated).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                Loading common patterns...
              </div>
            )}
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            {analytics ? (
              <div className="space-y-4">
                <Alert>
                  <Target className="h-4 w-4" />
                  <AlertTitle>Suggestion Analytics</AlertTitle>
                  <AlertDescription>
                    Track the effectiveness of AI suggestions
                  </AlertDescription>
                </Alert>

                <div className="grid gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Total Suggestions</span>
                      <span className="font-medium">{analytics.totalSuggestions}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Accepted Suggestions</span>
                      <span className="font-medium">{analytics.acceptedSuggestions}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Average Confidence</span>
                      <span className="font-medium">{Math.round(analytics.averageConfidence * 100)}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Total Cost</span>
                      <span className="font-medium">${analytics.costToDate.toFixed(4)}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center">
                  {new Date(analytics.period.start).toLocaleDateString()} - {new Date(analytics.period.end).toLocaleDateString()}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                Loading analytics...
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

