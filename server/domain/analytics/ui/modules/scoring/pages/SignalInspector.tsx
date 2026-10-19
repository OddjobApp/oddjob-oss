/**
 * Behavioral Intelligence — Signal Inspector (External/Customer-Facing)
 *
 * Route: /insights/scoring/explain/:entityType/:entityId
 *
 * Full score explainability: every contributing event, rule match, weight, decay.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Activity, Clock, TrendingUp } from "lucide-react";

type ScoreExplanation = {
  vectors?: Record<string, any>;
  recent_signals?: any[];
  temporal_metrics?: Record<string, any>;
  rfg?: Record<string, any>;
  explanation?: string;
};

export default function SignalInspector() {
  const params = useParams<{ entityType?: string; entityId?: string }>();
  const [, navigate] = useLocation();
  const entityType = params?.entityType || "contact";
  const entityId = params?.entityId || "";

  const { data, isLoading } = useQuery<ScoreExplanation>({
    queryKey: ["/api/behavioral/explain", entityType, entityId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/behavioral/explain/${entityType}/${entityId}`);
      return res.json();
    },
    enabled: !!entityId,
  });

  const vectors = data?.vectors || {};
  const signals = data?.recent_signals || [];
  const temporal = data?.temporal_metrics || {};
  const rfg = data?.rfg || {};

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/insights/scoring/live")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Live Scores
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Signal Inspector</h1>
          <p className="text-sm text-muted-foreground">
            Full score derivation for <Badge variant="outline">{entityType}</Badge> <code className="text-xs">{entityId}</code>
          </p>
        </div>
      </div>

      {isLoading && <div className="text-center py-8 text-muted-foreground">Loading signal data...</div>}

      {data && !isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main: Vector Breakdown */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Vector Breakdown</h2>

            {Object.entries(vectors).map(([name, data]: [string, any]) => (
              <Card key={name}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{name}</span>
                      <Badge variant="outline" className="text-[10px]">{data.source}</Badge>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">{data.decayed?.toFixed(3)}</div>
                      <div className="text-[10px] text-muted-foreground">raw: {data.raw?.toFixed(3)}</div>
                    </div>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full" style={{ width: `${Math.min(100, (data.decayed || 0) * 100)}%` }} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                    <span>Decay factor: {data.decay_factor ? `${Math.round(data.decay_factor * 100)}%` : "—"}</span>
                    <span>Age: {data.age_hours ? `${data.age_hours}h` : "—"}</span>
                    <span>Last update: {data.last_update ? new Date(data.last_update).toLocaleString() : "—"}</span>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Signal Timeline */}
            <h2 className="text-lg font-semibold flex items-center gap-2 mt-6"><Activity className="w-5 h-5" /> Signal Timeline</h2>
            <Card>
              <CardContent className="pt-4">
                {signals.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No recent signals recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {signals.map((signal: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-muted last:border-0">
                        <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[9px]">{signal.event_type}</Badge>
                            {signal.metadata?.source && <span className="text-[10px] text-muted-foreground">{signal.metadata.source}</span>}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {new Date(signal.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Meta */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">RFG Modifiers</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between"><span className="text-sm">Recency</span><span className="font-mono text-sm font-bold">{rfg.recency?.toFixed(3) || "—"}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Temporal Metrics</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.keys(temporal).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No temporal data available yet.</p>
                ) : (
                  Object.entries(temporal).map(([key, value]: [string, any]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-xs text-muted-foreground">{key}</span>
                      <span className="text-xs font-mono">{typeof value === "number" ? value.toFixed(4) : String(value)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Explanation</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{data.explanation || "Score derived from behavioral signals processed by the scoring engine."}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
