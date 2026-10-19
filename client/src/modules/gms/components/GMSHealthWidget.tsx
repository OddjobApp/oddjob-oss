/**
 * GMS Health Widget
 * 
 * Displays GMS system status in Admin Dashboard.
 * Shows verifier accuracy, active runs, and skill library stats.
 */

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Brain, Activity, Database, Sparkles, TrendingUp, AlertTriangle } from "lucide-react";

interface GMSStatus {
  initialized: boolean;
  config: {
    verifierEnabled: boolean;
    synthesisEnabled: boolean;
    shadowEnabled: boolean;
    evolutionEnabled: boolean;
  };
  verifier: {
    available: boolean;
    accuracy: number;
    totalPredictions: number;
  } | null;
  pmi: {
    available: boolean;
    cacheSize: number;
  } | null;
  shadow: {
    available: boolean;
    groundTruthObservations: number;
  } | null;
}

export const GMSHealthWidget: React.FC = () => {
  const [status, setStatus] = useState<GMSStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/gms/status");
        if (response.ok) {
          setStatus(await response.json());
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-24">
            <div className="animate-pulse text-muted-foreground">Loading GMS status...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status?.initialized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            GMS Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            <span>GMS not initialized</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activePhases = [
    status.config.verifierEnabled && "Phase 1: Neural Verifier",
    status.config.synthesisEnabled && "Phase 2: PMI",
    status.config.shadowEnabled && "Phase 3: Shadow Validation",
    status.config.evolutionEnabled && "Phase 4: Skill Evolution"
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Generative Mission Synthesis
          </div>
          <Badge variant="outline" className="text-xs">
            v4.0
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Phase Indicators */}
        <div className="grid grid-cols-2 gap-2">
          <div className={`p-2 rounded-md border ${status.config.verifierEnabled ? 'bg-green-50 border-green-200' : 'bg-muted'}`}>
            <div className="flex items-center gap-2 text-sm">
              <Activity className={`h-4 w-4 ${status.config.verifierEnabled ? 'text-green-600' : 'text-muted-foreground'}`} />
              <span className={status.config.verifierEnabled ? 'text-green-700' : 'text-muted-foreground'}>
                Phase 1: Neural
              </span>
            </div>
          </div>
          <div className={`p-2 rounded-md border ${status.config.synthesisEnabled ? 'bg-blue-50 border-blue-200' : 'bg-muted'}`}>
            <div className="flex items-center gap-2 text-sm">
              <Sparkles className={`h-4 w-4 ${status.config.synthesisEnabled ? 'text-blue-600' : 'text-muted-foreground'}`} />
              <span className={status.config.synthesisEnabled ? 'text-blue-700' : 'text-muted-foreground'}>
                Phase 2: PMI
              </span>
            </div>
          </div>
          <div className={`p-2 rounded-md border ${status.config.shadowEnabled ? 'bg-purple-50 border-purple-200' : 'bg-muted'}`}>
            <div className="flex items-center gap-2 text-sm">
              <Database className={`h-4 w-4 ${status.config.shadowEnabled ? 'text-purple-600' : 'text-muted-foreground'}`} />
              <span className={status.config.shadowEnabled ? 'text-purple-700' : 'text-muted-foreground'}>
                Phase 3: Shadow
              </span>
            </div>
          </div>
          <div className={`p-2 rounded-md border ${status.config.evolutionEnabled ? 'bg-orange-50 border-orange-200' : 'bg-muted'}`}>
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className={`h-4 w-4 ${status.config.evolutionEnabled ? 'text-orange-600' : 'text-muted-foreground'}`} />
              <span className={status.config.evolutionEnabled ? 'text-orange-700' : 'text-muted-foreground'}>
                Phase 4: Evolution
              </span>
            </div>
          </div>
        </div>

        {/* Verifier Stats */}
        {status.verifier && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Verifier Accuracy</span>
              <span className="font-medium">{(status.verifier.accuracy * 100).toFixed(1)}%</span>
            </div>
            <Progress value={status.verifier.accuracy * 100} className="h-2" />
            <div className="text-xs text-muted-foreground">
              {status.verifier.totalPredictions.toLocaleString()} predictions
            </div>
          </div>
        )}

        {/* PMI Cache */}
        {status.pmi?.available && (
          <div className="flex justify-between items-center py-2 border-t">
            <span className="text-sm text-muted-foreground">PMI Cache</span>
            <Badge variant="secondary">{status.pmi.cacheSize} candidates</Badge>
          </div>
        )}

        {/* Ground Truth */}
        {status.shadow?.available && (
          <div className="flex justify-between items-center py-2 border-t">
            <span className="text-sm text-muted-foreground">Ground Truth</span>
            <Badge variant="secondary">
              {status.shadow.groundTruthObservations.toLocaleString()} observations
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GMSHealthWidget;
