/**
 * Behavioral Intelligence — Live Scores (External/Customer-Facing)
 *
 * Route: /insights/scoring/live
 *
 * Search entities and view their current behavioral scores in real-time.
 */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { Search, ArrowLeft, Eye } from "lucide-react";

type ScoreExplanation = {
  vectors?: Record<string, any>;
  recent_signals?: any[];
  rfg?: Record<string, any>;
  explanation?: string;
};

export default function LiveScores() {
  const [, navigate] = useLocation();
  const [entityType, setEntityType] = useState("contact");
  const [entityId, setEntityId] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);

  const { data: scoreData, isLoading, refetch } = useQuery<ScoreExplanation>({
    queryKey: ["/api/behavioral/explain", entityType, entityId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/behavioral/explain/${entityType}/${entityId}`);
      return res.json();
    },
    enabled: searchTriggered && !!entityId,
  });

  function handleSearch() {
    if (!entityId.trim()) return;
    setSearchTriggered(true);
    refetch();
  }

  const vectors = scoreData?.vectors || {};
  const signals = scoreData?.recent_signals || [];
  const rfg = scoreData?.rfg || {};

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/insights/scoring")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Live Scores</h1>
          <p className="text-sm text-muted-foreground">Search entities and view their current behavioral scores.</p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contact">Contact</SelectItem>
                <SelectItem value="account">Account</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="deal">Deal</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Enter entity ID..."
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={!entityId.trim() || isLoading}>
              <Search className="w-4 h-4 mr-2" /> Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading && <div className="text-center py-8 text-muted-foreground">Loading scores...</div>}

      {scoreData && !isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Score Vectors */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold">Score Vectors</h2>
            {Object.keys(vectors).length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">No scores found for this entity.</CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(vectors).map(([name, data]: [string, any]) => (
                  <Card key={name}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{name}</span>
                        <Badge variant="outline" className="text-[10px]">{data.source}</Badge>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="text-2xl font-bold">{data.decayed?.toFixed(2) || "0.00"}</span>
                        <span className="text-xs text-muted-foreground mb-1">/ {data.raw?.toFixed(2)} raw</span>
                      </div>
                      <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (data.decayed || 0) * 100)}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Decay: {data.decay_factor ? `${Math.round(data.decay_factor * 100)}%` : "—"} · Age: {data.age_hours ? `${data.age_hours}h` : "—"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Recent Signals */}
            {signals.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mt-6 mb-3">Recent Signals</h2>
                <Card>
                  <CardContent className="pt-4 space-y-2">
                    {signals.slice(0, 10).map((signal: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 py-1 border-b border-muted last:border-0">
                        <Badge variant="outline" className="text-[9px] w-20 justify-center">{signal.event_type}</Badge>
                        <span className="text-xs text-muted-foreground flex-1">{new Date(signal.timestamp).toLocaleString()}</span>
                        <span className="text-xs">{signal.metadata?.source || "—"}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Sidebar: RFG + Meta */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">RFG Modifiers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Recency</span>
                  <span className="text-sm font-mono font-bold">{rfg.recency?.toFixed(3) || "—"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Entity Type</span>
                  <Badge variant="outline">{entityType}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Entity ID</span>
                  <span className="text-xs font-mono truncate max-w-[120px]">{entityId}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Explanation</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{scoreData.explanation || "No explanation available."}</p>
              </CardContent>
            </Card>

            <Button className="w-full" variant="outline" onClick={() => navigate(`/insights/scoring/explain/${entityType}/${entityId}`)}>
              <Eye className="w-4 h-4 mr-2" /> Full Signal Inspector
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
