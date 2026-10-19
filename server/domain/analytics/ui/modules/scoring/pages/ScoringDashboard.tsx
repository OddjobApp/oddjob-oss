/**
 * Behavioral Intelligence — Scoring Dashboard (External/Customer-Facing)
 *
 * Route: /insights/scoring
 *
 * Shows: vector models, health metrics, recent threshold crossings,
 * quick actions (install template, view scores, manage keys).
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Activity, Layers, Users, Zap, Key, Plus, ArrowRight, AlertTriangle } from "lucide-react";

type BehavioralHealth = {
  metrics?: Record<string, any>;
  tier?: string;
  status?: string;
  alerts?: string[];
};

type BehavioralModelsResponse = {
  models?: any[];
};

type BehavioralTemplatesResponse = {
  templates?: any[];
};

export default function ScoringDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch health data
  const { data: health, isLoading } = useQuery<BehavioralHealth>({
    queryKey: ["/api/behavioral/health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/behavioral/health");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch models
  const { data: modelsData } = useQuery<BehavioralModelsResponse>({
    queryKey: ["/api/behavioral/models"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/behavioral/models");
      return res.json();
    },
  });

  // Fetch templates
  const { data: templatesData } = useQuery<BehavioralTemplatesResponse>({
    queryKey: ["/api/behavioral/models/templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/behavioral/models/templates");
      return res.json();
    },
  });

  // Install template mutation
  const installTemplate = useMutation({
    mutationFn: async (templateKey: string) => {
      return apiRequest("POST", "/api/behavioral/models/from-template", { template_key: templateKey });
    },
    onSuccess: (_, templateKey) => {
      toast({ title: "Model Installed", description: `${templateKey} template installed successfully.` });
      queryClient.invalidateQueries({ queryKey: ["/api/behavioral/models"] });
    },
    onError: (err: any) => {
      toast({ title: "Install Failed", description: err.message, variant: "destructive" });
    },
  });

  const models = modelsData?.models || [];
  const templates = templatesData?.templates || [];
  const metrics = health?.metrics || {};
  const tier = health?.tier || "—";
  const status = health?.status || "unknown";

  return (
    <div className="container mx-auto py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Behavioral Intelligence</h1>
          <p className="text-muted-foreground">Score entities, detect patterns, and trigger automated actions based on behavioral signals.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={status === "healthy" ? "default" : status === "degraded" ? "secondary" : "destructive"}>
            {status === "healthy" ? "● Healthy" : status === "degraded" ? "⚠ Degraded" : "✕ Critical"}
          </Badge>
          <Badge variant="outline">Tier: {tier}</Badge>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-primary">{models.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Vector Models</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-blue-500">{metrics.rules_compiled || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Active Rules</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-amber-500">{metrics.daily_events || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Events Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-emerald-500">{metrics.utilization_percent || 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">Tier Usage</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-violet-500">{metrics.consumer_lag || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Queue Lag</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vector Models */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Layers className="w-5 h-5" /> Vector Models</h2>
            <Button size="sm" variant="outline" onClick={() => navigate("/insights/scoring/live")}>
              <Users className="w-4 h-4 mr-2" /> Live Scores
            </Button>
          </div>

          {models.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Layers className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Vector Models Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">Install a template to get started with behavioral scoring.</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {templates.slice(0, 4).map((t: any) => (
                    <Button key={t.key} size="sm" variant="secondary" onClick={() => installTemplate.mutate(t.key)} disabled={installTemplate.isPending}>
                      <Plus className="w-3 h-3 mr-1" /> {t.name}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {models.map((model: any) => (
                <Card key={model.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/insights/scoring/models/${model.id}`)}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{model.name}</h3>
                        <p className="text-xs text-muted-foreground">{model.entity_type} · {model.vectors?.length || 0} vectors · {model.status}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {model.is_system && <Badge variant="outline" className="text-[10px]">System</Badge>}
                        <Badge variant={model.status === "active" ? "default" : "secondary"}>{model.status}</Badge>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    {model.vectors && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {model.vectors.map((v: any) => (
                          <Badge key={v.name} variant="outline" className="text-[10px]">{v.name}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full justify-start" variant="ghost" size="sm" onClick={() => navigate("/insights/scoring/live")}>
                <Activity className="w-4 h-4 mr-2" /> View Live Scores
              </Button>
              <Button className="w-full justify-start" variant="ghost" size="sm" onClick={() => toast({ title: "SDK Snippet", description: "npm install @oddjob/behavioral-sdk" })}>
                <Key className="w-4 h-4 mr-2" /> Get SDK Snippet
              </Button>
              <Button className="w-full justify-start" variant="ghost" size="sm" onClick={() => toast({ title: "Coming Soon", description: "API key management is available in the admin panel." })}>
                <Zap className="w-4 h-4 mr-2" /> Manage API Keys
              </Button>
            </CardContent>
          </Card>

          {/* Available Templates */}
          {templates.length > 0 && models.length < templates.length && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Available Templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {templates.filter((t: any) => !models.some((m: any) => m.name === t.name)).slice(0, 5).map((t: any) => (
                  <div key={t.key} className="flex items-center justify-between">
                    <span className="text-sm">{t.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => installTemplate.mutate(t.key)} disabled={installTemplate.isPending}>
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Health Alerts */}
          {health?.alerts && health.alerts.length > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {health.alerts.map((alert: string, i: number) => (
                  <p key={i} className="text-xs text-amber-600">{alert}</p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
