/**
 * AI Decisions Tab
 * 
 * Shows AI decision timeline and reasoning for dynamic autonomous missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Brain, Sparkles, Clock, ChevronRight } from "lucide-react";

interface AIDecisionsTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function AIDecisionsTab({ mission, run }: AIDecisionsTabProps) {
  const trace = run?.dynamicTrace || mission?.dynamicTrace || [];
  
  const decisions = trace
    .filter((t: any) => t.type === "decision")
    .map((t: any) => ({
      timestamp: t.timestamp,
      description: `AI selected action "${t.action}"${t.params ? ' with parameters: ' + JSON.stringify(t.params) : ''}`,
      confidence: t.confidence || t.score,
      type: "decision"
    }));

  const adaptations = trace
    .filter((t: any) => t.type === "adaptation" || t.event === "path_change")
    .map((t: any) => ({
      timestamp: t.timestamp,
      description: t.note || t.intent || "Execution path changed",
      confidence: t.decisionConfidence || t.score || t.confidence,
      type: "adaptation"
    }));

  const allDecisions = [...decisions, ...adaptations].sort(
    (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-500" />
          <CardTitle className="text-lg font-bold tracking-tight">AI Decision Timeline</CardTitle>
        </div>
        <CardDescription>
          Autonomous decisions and adaptations made during mission execution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {allDecisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Sparkles className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No AI decisions recorded yet</p>
              <p className="text-xs mt-1">Decisions will appear as the AI adapts</p>
            </div>
          ) : (
            <div className="space-y-3">
              {allDecisions.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    item.type === "adaptation"
                      ? "bg-purple-500/5 border-purple-500/20"
                      : "bg-blue-500/5 border-blue-500/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${item.type === "adaptation" ? "text-purple-500" : "text-blue-500"}`}>
                      {item.type === "adaptation" ? (
                        <Sparkles className="w-4 h-4" />
                      ) : (
                        <Brain className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant="outline" 
                          className={`text-[9px] ${
                            item.type === "adaptation" 
                              ? "bg-purple-500/10 text-purple-500 border-purple-500/20" 
                              : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                          }`}
                        >
                          {item.type === "adaptation" ? "Adaptation" : "Decision"}
                        </Badge>
                        {item.timestamp && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground">
                        {item.description || item.reasoning || item.action || "AI action"}
                      </p>
                      {item.confidence && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Confidence: {Math.round(item.confidence * 100)}%
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
