/**
 * BlueprintEvolutionBlock
 * 
 * Self-improving blueprint management interface.
 * View metrics, evolution suggestions, generation history, and approve improvements.
 */
import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dna, Zap, TrendingUp, AlertTriangle, CheckCircle, XCircle,
  Clock, GitCommit, ChevronRight, Play, RotateCcw, BarChart3,
  Target, Sparkles, Cpu, GitBranch, ArrowRight, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Progress } from '../ui/progress.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.js';

interface BlueprintMetrics {
  blueprintId: string;
  totalAppsCreated: number;
  successRate: number;
  averageBuildTime: number;
  userSatisfaction: number;
  commonIssues: IssuePattern[];
  topFeatures: string[];
}

interface IssuePattern {
  type: string;
  frequency: number;
  severity: "low" | "medium" | "high";
  affectedFiles: string[];
}

interface EvolutionSuggestion {
  blueprintId: string;
  type: "performance" | "reliability" | "usability" | "feature";
  priority: "low" | "medium" | "high";
  description: string;
  recommendedChanges: CodeChange[];
  expectedImpact: {
    buildTimeReduction?: number;
    errorRateReduction?: number;
    satisfactionIncrease?: number;
  };
  confidence: number;
}

interface CodeChange {
  filePath: string;
  operation: "add" | "modify" | "remove";
  description: string;
  snippet?: string;
}

interface Generation {
  id: string;
  generationNumber: number;
  changes: CodeChange[];
  metrics: BlueprintMetrics;
  approved: boolean;
  createdAt: number;
}

interface BlueprintEvolutionBlockProps {
  blueprintId: string;
  showGenerations?: boolean;
  autoAnalyze?: boolean;
}

export default function BlueprintEvolutionBlock({
  blueprintId,
  showGenerations = true,
  autoAnalyze = true
}: BlueprintEvolutionBlockProps) {
  const [metrics, setMetrics] = useState<BlueprintMetrics | null>(null);
  const [suggestions, setSuggestions] = useState<EvolutionSuggestion[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<EvolutionSuggestion | null>(null);
  const [selectedGeneration, setSelectedGeneration] = useState<Generation | null>(null);
  const [loading, setLoading] = useState(false);
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch(`/api/blueprints/${blueprintId}/metrics`);
      if (response.ok) {
        const data = await response.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error("[BlueprintEvolution] Failed to fetch metrics:", err);
    }
  }, [blueprintId]);

  // Fetch suggestions
  const fetchSuggestions = useCallback(async () => {
    try {
      const response = await fetch(`/api/blueprints/${blueprintId}/suggestions`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (err) {
      console.error("[BlueprintEvolution] Failed to fetch suggestions:", err);
    }
  }, [blueprintId]);

  // Fetch generations
  const fetchGenerations = useCallback(async () => {
    if (!showGenerations) return;
    
    try {
      const response = await fetch(`/api/blueprints/${blueprintId}/generations`);
      if (response.ok) {
        const data = await response.json();
        setGenerations(data.generations || []);
      }
    } catch (err) {
      console.error("[BlueprintEvolution] Failed to fetch generations:", err);
    }
  }, [blueprintId, showGenerations]);

  React.useEffect(() => {
    if (autoAnalyze) {
      fetchMetrics();
      fetchSuggestions();
      fetchGenerations();
    }
  }, [autoAnalyze, fetchMetrics, fetchSuggestions, fetchGenerations]);

  const handleEvolve = async () => {
    if (!selectedSuggestion) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/blueprints/${blueprintId}/evolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestion: selectedSuggestion,
          author: "system"
        })
      });

      if (response.ok) {
        await fetchGenerations();
        setEvolveDialogOpen(false);
        setSelectedSuggestion(null);
      }
    } catch (err) {
      console.error("[BlueprintEvolution] Evolution failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (generationId: string, approved: boolean) => {
    try {
      await fetch(`/api/blueprints/generations/${generationId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved })
      });

      await fetchGenerations();
    } catch (err) {
      console.error("[BlueprintEvolution] Approval failed:", err);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "performance": return <Zap className="h-4 w-4 text-amber-400" />;
      case "reliability": return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case "usability": return <Target className="h-4 w-4 text-blue-400" />;
      case "feature": return <Sparkles className="h-4 w-4 text-purple-400" />;
      default: return <Dna className="h-4 w-4 text-foreground/40" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "performance": return "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30";
      case "reliability": return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
      case "usability": return "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30";
      case "feature": return "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30";
      default: return "bg-foreground/10 text-foreground/60";
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "high": return <Badge className="bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30">High</Badge>;
      case "medium": return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30">Medium</Badge>;
      default: return <Badge className="bg-foreground/10 text-foreground/60">Low</Badge>;
    }
  };

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Dna className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg font-bold text-foreground">Blueprint Evolution</CardTitle>
            <Badge variant="outline" className="bg-foreground/10 text-foreground/60 font-mono">
              {blueprintId}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchMetrics();
                fetchSuggestions();
                fetchGenerations();
              }}
              className="border-foreground/10 text-foreground/60"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="metrics">
          <TabsList className="bg-foreground/5 border-foreground/10 mb-4">
            <TabsTrigger value="metrics" className="data-[state=active]:bg-foreground/10">
              <BarChart3 className="h-4 w-4 mr-2" />
              Metrics
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="data-[state=active]:bg-foreground/10">
              <Sparkles className="h-4 w-4 mr-2" />
              Suggestions ({suggestions.length})
            </TabsTrigger>
            {showGenerations && (
              <TabsTrigger value="generations" className="data-[state=active]:bg-foreground/10">
                <GitCommit className="h-4 w-4 mr-2" />
                Generations ({generations.length})
              </TabsTrigger>
            )}
          </TabsList>

          {/* Metrics Tab */}
          <TabsContent value="metrics" className="space-y-4">
            {!metrics ? (
              <div className="text-center py-12 text-foreground/30">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Loading metrics...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-foreground/5 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{metrics.totalAppsCreated}</p>
                    <p className="text-xs text-foreground/40">Apps Created</p>
                  </div>
                  <div className="bg-foreground/5 rounded-lg p-4 text-center">
                    <p className={`text-2xl font-bold ${metrics.successRate >= 0.9 ? "text-emerald-400" : "text-amber-400"}`}>
                      {(metrics.successRate * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs text-foreground/40">Success Rate</p>
                  </div>
                  <div className="bg-foreground/5 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{(metrics.averageBuildTime / 1000).toFixed(0)}s</p>
                    <p className="text-xs text-foreground/40">Avg Build Time</p>
                  </div>
                  <div className="bg-foreground/5 rounded-lg p-4 text-center">
                    <p className={`text-2xl font-bold ${metrics.userSatisfaction >= 4 ? "text-emerald-400" : "text-amber-400"}`}>
                      {metrics.userSatisfaction.toFixed(1)}
                    </p>
                    <p className="text-xs text-foreground/40">Satisfaction</p>
                  </div>
                </div>

                {/* Common Issues */}
                {metrics.commonIssues.length > 0 && (
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-rose-700 dark:text-rose-300 mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Common Issues ({metrics.commonIssues.length})
                    </h4>
                    <div className="space-y-2">
                      {metrics.commonIssues.slice(0, 5).map((issue, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="text-foreground/60">{issue.type}</span>
                          <div className="flex items-center gap-2">
                            <Badge className={
                              issue.severity === "high" ? "bg-rose-500/20 text-rose-700 dark:text-rose-300" :
                              issue.severity === "medium" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" :
                              "bg-foreground/10 text-foreground/60"
                            }>
                              {issue.severity}
                            </Badge>
                            <span className="text-foreground/40">{issue.frequency}×</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Features */}
                {metrics.topFeatures.length > 0 && (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-3">Top Features</h4>
                    <div className="flex flex-wrap gap-2">
                      {metrics.topFeatures.map((feature) => (
                        <Badge key={feature} variant="outline" className="border-indigo-500/30 text-indigo-700 dark:text-indigo-300">
                          {feature}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Suggestions Tab */}
          <TabsContent value="suggestions">
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {suggestions.length === 0 ? (
                  <div className="text-center py-8 text-foreground/30">
                    <Sparkles className="h-8 w-8 mx-auto mb-2" />
                    <p>No evolution suggestions</p>
                    <p className="text-sm mt-1">Blueprint is performing optimally</p>
                  </div>
                ) : (
                  suggestions.map((suggestion, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedSuggestion === suggestion
                          ? "bg-indigo-500/10 border-indigo-500/30"
                          : "bg-foreground/5 border-foreground/10 hover:bg-foreground/10"
                      }`}
                      onClick={() => setSelectedSuggestion(suggestion)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${getTypeColor(suggestion.type)}`}>
                            {getTypeIcon(suggestion.type)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground capitalize">{suggestion.type}</span>
                              {getPriorityBadge(suggestion.priority)}
                            </div>
                            <p className="text-sm text-foreground/60 mt-1">{suggestion.description}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-indigo-400">
                            {(suggestion.confidence * 100).toFixed(0)}%
                          </div>
                          <div className="text-xs text-foreground/40">confidence</div>
                        </div>
                      </div>

                      {suggestion.expectedImpact && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {suggestion.expectedImpact.buildTimeReduction && (
                            <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                              <TrendingUp className="h-3 w-3 mr-1" />
                              -{(suggestion.expectedImpact.buildTimeReduction * 100).toFixed(0)}% build time
                            </Badge>
                          )}
                          {suggestion.expectedImpact.errorRateReduction && (
                            <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              -{(suggestion.expectedImpact.errorRateReduction * 100).toFixed(0)}% errors
                            </Badge>
                          )}
                          {suggestion.expectedImpact.satisfactionIncrease && (
                            <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                              <Target className="h-3 w-3 mr-1" />
                              +{(suggestion.expectedImpact.satisfactionIncrease * 100).toFixed(0)}% satisfaction
                            </Badge>
                          )}
                        </div>
                      )}

                      <div className="mt-3 text-xs text-foreground/40">
                        {suggestion.recommendedChanges.length} recommended changes
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </ScrollArea>

            {selectedSuggestion && (
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => setEvolveDialogOpen(true)}
                  className="bg-indigo-500 hover:bg-indigo-400 text-foreground"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Evolve Blueprint
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Generations Tab */}
          {showGenerations && (
            <TabsContent value="generations">
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {generations.length === 0 ? (
                    <div className="text-center py-8 text-foreground/30">
                      <GitCommit className="h-8 w-8 mx-auto mb-2" />
                      <p>No evolution generations</p>
                      <p className="text-sm mt-1">Apply suggestions to create new generations</p>
                    </div>
                  ) : (
                    generations.map((gen) => (
                      <div
                        key={gen.id}
                        className={`p-4 rounded-lg border ${
                          gen.approved
                            ? "bg-emerald-500/10 border-emerald-500/30"
                            : "bg-foreground/5 border-foreground/10"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="font-mono text-lg font-bold text-foreground">
                              Gen {gen.generationNumber}
                            </div>
                            {gen.approved ? (
                              <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Approved
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                <Clock className="h-3 w-3 mr-1" />
                                Pending
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-foreground/40">
                            {new Date(gen.createdAt).toLocaleDateString()}
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                          <div className="bg-background/40 rounded p-2">
                            <div className="text-sm font-bold text-foreground">
                              {(gen.metrics.successRate * 100).toFixed(0)}%
                            </div>
                            <div className="text-xs text-foreground/40">Success</div>
                          </div>
                          <div className="bg-background/40 rounded p-2">
                            <div className="text-sm font-bold text-foreground">
                              {(gen.metrics.averageBuildTime / 1000).toFixed(0)}s
                            </div>
                            <div className="text-xs text-foreground/40">Build</div>
                          </div>
                          <div className="bg-background/40 rounded p-2">
                            <div className="text-sm font-bold text-foreground">
                              {gen.metrics.userSatisfaction.toFixed(1)}
                            </div>
                            <div className="text-xs text-foreground/40">Rating</div>
                          </div>
                        </div>

                        {!gen.approved && (
                          <div className="mt-3 flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleApprove(gen.id, true)}
                              className="flex-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleApprove(gen.id, false)}
                              className="flex-1 border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>

      {/* Evolve Dialog */}
      <Dialog open={evolveDialogOpen} onOpenChange={setEvolveDialogOpen}>
        <DialogContent className="bg-card border-foreground/10 text-foreground max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dna className="h-5 w-5 text-indigo-400" />
              Evolve Blueprint
            </DialogTitle>
          </DialogHeader>

          {selectedSuggestion && (
            <div className="space-y-4">
              <div className="bg-foreground/5 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {getTypeIcon(selectedSuggestion.type)}
                  <span className="font-medium capitalize">{selectedSuggestion.type} Improvement</span>
                  {getPriorityBadge(selectedSuggestion.priority)}
                </div>
                <p className="text-foreground/60">{selectedSuggestion.description}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-foreground/60 mb-2">
                  Recommended Changes ({selectedSuggestion.recommendedChanges.length})
                </h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {selectedSuggestion.recommendedChanges.map((change, idx) => (
                      <div key={idx} className="bg-background/40 rounded p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs border-foreground/20 text-foreground/40">
                            {change.operation}
                          </Badge>
                          <span className="text-sm font-mono text-foreground">{change.filePath}</span>
                        </div>
                        <p className="text-xs text-foreground/40">{change.description}</p>
                        {change.snippet && (
                          <pre className="mt-2 p-2 bg-background/60 rounded text-xs text-foreground/60 overflow-x-auto">
                            {change.snippet.slice(0, 100)}...
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEvolveDialogOpen(false)}
              className="text-foreground/60"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEvolve}
              disabled={loading}
              className="bg-indigo-500 hover:bg-indigo-400 text-foreground"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Evolving...
                </>
              ) : (
                <>
                  <Dna className="h-4 w-4 mr-2" />
                  Create Generation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
