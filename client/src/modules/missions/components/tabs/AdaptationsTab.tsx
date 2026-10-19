/**
 * Adaptations Tab
 * 
 * Execution path changes and their reasoning.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Zap, BrainCircuit } from "lucide-react";

interface AdaptationsTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function AdaptationsTab({ run }: AdaptationsTabProps) {
  const adaptations = (run?.dynamicTrace || []).filter((t: any) => 
    t.type === "adaptation" || t.event === "path_change"
  );
  
  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-lg font-bold">Adaptations</CardTitle>
        </div>
        <CardDescription>
          Execution path changes and their reasoning
        </CardDescription>
      </CardHeader>
      <CardContent>
        {adaptations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No adaptations recorded. Mission following original plan.
          </p>
        ) : (
          <div className="space-y-3">
            {adaptations.map((adaptation: any, idx: number) => (
              <div key={idx} className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500">
                    {adaptation.event || "adaptation"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {adaptation.timestamp ? new Date(adaptation.timestamp).toLocaleString() : "Unknown time"}
                  </span>
                </div>
                <p className="text-sm font-medium">{adaptation.note || adaptation.intent || "Path changed"}</p>
                {adaptation.reason && (
                  <p className="text-xs text-muted-foreground mt-1">Reason: {adaptation.reason}</p>
                )}
                {adaptation.decisionConfidence && (
                  <div className="flex items-center gap-1 mt-2">
                    <BrainCircuit className="w-3 h-3 text-violet-500" />
                    <span className="text-xs text-violet-500">
                      {Math.round(adaptation.decisionConfidence * 100)}% confidence
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
