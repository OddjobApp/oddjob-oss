/**
 * Behavioral Intelligence — Model Detail (External/Customer-Facing)
 *
 * Route: /insights/scoring/models/:id
 *
 * Shows vector model configuration, rules, thresholds, and allows editing.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { ArrowLeft, Layers, Zap, Shield } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type BehavioralModelsResponse = {
  models?: any[];
};

export default function ModelDetail() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const modelId = params?.id;

  // In production: fetch model by ID from /api/behavioral/models/:id
  // For now, show a placeholder structure
  const { data: modelsData } = useQuery<BehavioralModelsResponse>({
    queryKey: ["/api/behavioral/models"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/behavioral/models");
      return res.json();
    },
  });
  const model = (modelsData?.models || []).find((m: any) => String(m.id) === String(modelId));

  if (!model) {
    return (
      <div className="container mx-auto py-8">
        <Button variant="ghost" onClick={() => navigate("/insights/scoring")}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <div className="text-center py-12 text-muted-foreground">Model not found.</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/insights/scoring")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{model.name}</h1>
          <p className="text-sm text-muted-foreground">{model.description}</p>
        </div>
        <Badge variant={model.status === "active" ? "default" : "secondary"}>{model.status}</Badge>
        {model.is_system && <Badge variant="outline">System</Badge>}
      </div>

      {/* Model Info */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 text-center"><div className="text-xl font-bold">{model.vectors?.length || 0}</div><p className="text-xs text-muted-foreground">Vectors</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-xl font-bold">{model.entity_type}</div><p className="text-xs text-muted-foreground">Entity Type</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-xl font-bold">{model.blend_config?.behavioral_weight ? `${Math.round(model.blend_config.behavioral_weight * 100)}%` : "—"}</div><p className="text-xs text-muted-foreground">Behavioral Weight</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><div className="text-xl font-bold">{model.tier_required}</div><p className="text-xs text-muted-foreground">Tier Required</p></CardContent></Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="vectors">
        <TabsList>
          <TabsTrigger value="vectors" className="flex items-center gap-2"><Layers className="w-4 h-4" /> Vectors</TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2"><Zap className="w-4 h-4" /> Rules</TabsTrigger>
          <TabsTrigger value="thresholds" className="flex items-center gap-2"><Shield className="w-4 h-4" /> Thresholds</TabsTrigger>
        </TabsList>

        <TabsContent value="vectors" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(model.vectors || []).map((v: any) => (
              <Card key={v.name}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{v.name}</span>
                    <Badge variant="outline" className="text-[10px]">{v.signal_category}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{v.description}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    <span>Decay: {v.decay?.type || "none"}</span>
                    {v.decay?.halfLifeDays && <span>· Half-life: {v.decay.halfLifeDays}d</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Zap className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p>Rules are configured via the Scoring Studio admin panel or blueprint YAML.</p>
              <p className="text-xs mt-1">Navigate to Admin → Scoring Studio → Rule Templates to manage rules.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="thresholds" className="mt-4">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p>Thresholds define when automated actions fire based on score conditions.</p>
              <p className="text-xs mt-1">Configure thresholds in Admin → Scoring Studio → Advanced Interventions.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
