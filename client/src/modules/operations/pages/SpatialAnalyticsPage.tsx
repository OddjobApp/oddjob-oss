import React, { useState } from "react";
import {
  Globe,
  Radio,
  Layers,
  Hexagon,
  TrendingUp,
  Activity,
  ShieldAlert,
  Zap,
  RefreshCw,
  Compass,
  Crosshair,
  Sliders,
  Sparkles,
  MapPin,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";
import { H3SpatialPalette } from "@/components/signal-intelligence/spatial/H3SpatialPalette";

export default function SpatialAnalyticsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("deck");

  // Spatial query state
  const [lat, setLat] = useState<number>(37.7749);
  const [lng, setLng] = useState<number>(-122.4194);
  const [resolution, setResolution] = useState<number>(8);
  const [riskFluxDensity, setRiskFluxDensity] = useState<number>(0.68);
  const [expectedRiskPhi, setExpectedRiskPhi] = useState<number>(0.45);

  // Evaluate Spatial State Mutation
  const evalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prediction/spatial/evaluate", {
        lat,
        lng,
        resolution,
        riskFluxDensity,
        expectedRiskPhi,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Spatial State Evaluated",
        description: `Eulerian H3 Hexagon at Res ${resolution} analyzed.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Evaluation Failed",
        description: err.message || "Failed to evaluate spatial state",
        variant: "destructive",
      });
    },
  });

  // Eigenvalue Drift Mutation
  const spectralMutation = useMutation({
    mutationFn: async () => {
      // Sample 4 spatial cluster points
      const points = [
        { lat: lat - 0.01, lng: lng - 0.01 },
        { lat: lat + 0.012, lng: lng + 0.008 },
        { lat: lat - 0.005, lng: lng + 0.015 },
        { lat: lat + 0.008, lng: lng - 0.012 },
      ];
      const res = await apiRequest("POST", "/api/prediction/spatial/eigenvalues", { points });
      return res.json();
    },
  });

  // Run initial evaluation
  React.useEffect(() => {
    evalMutation.mutate();
    spectralMutation.mutate();
  }, [resolution]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = evalMutation.data;
  const spatialState = result?.spatialState;
  const gaussianKernel = result?.gaussianKernel;
  const surpriseResult = result?.surpriseResult;
  const spectralResult = spectralMutation.data;

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-y-auto">
      {/* Header Banner */}
      <div className="border-b border-border/60 bg-card/60 backdrop-blur-md p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm">
              <Hexagon className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Eulerian Hexagonal Spatial Command Deck
                </h1>
                <Badge variant="outline" className="text-[10px] font-mono uppercase bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                  Uber H3 Engine
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Isotropic 6-neighbor radial flow fields, O(1) hierarchical spatial zoom, & geofenced risk envelopes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                evalMutation.mutate();
                spectralMutation.mutate();
              }}
              disabled={evalMutation.isPending}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", evalMutation.isPending && "animate-spin")} />
              Re-evaluate Spatial State
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-muted/50 p-1">
              <TabsTrigger value="deck" className="text-xs gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                Spatial Analytics & Flux Deck
              </TabsTrigger>
              <TabsTrigger value="palette" className="text-xs gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                H3 Region & Geofence Palette
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 p-6">
        {activeTab === "deck" && (
          <div className="space-y-6">
            {/* Top Control and Metric Strip */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Coordinate & Resolution Input Card */}
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
                    Spatial Target Coordinates
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Latitude</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={lat}
                        onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs font-mono rounded bg-background border border-border/60"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Longitude</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={lng}
                        onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs font-mono rounded bg-background border border-border/60"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>H3 Resolution: Res {resolution}</span>
                      <span>{resolution <= 6 ? "~36 km²" : resolution <= 8 ? "~0.7 km²" : "~15,000 m²"}</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={10}
                      value={resolution}
                      onChange={(e) => setResolution(parseInt(e.target.value))}
                      className="w-full mt-1 accent-cyan-500"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* H3 Index & Centroid */}
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Hexagon className="h-3.5 w-3.5 text-indigo-400" />
                    Active Hex Tile (Centroid)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 space-y-2">
                  <div className="p-2 rounded-lg bg-foreground/[0.02] border border-border/40 font-mono text-xs font-bold text-cyan-400 truncate">
                    {spatialState?.h3Index || "8828308281fffff"}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>Centroid:</span>
                    <span className="font-mono text-foreground">
                      {spatialState?.centerLat?.toFixed(4)}, {spatialState?.centerLng?.toFixed(4)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>Hierarchy Parent:</span>
                    <span className="font-mono text-indigo-400">Res 5 Zoom (O(1))</span>
                  </div>
                </CardContent>
              </Card>

              {/* Flux Density & Risk Slider */}
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-rose-400" />
                    Eulerian Risk Flux Density ($\Phi$)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 space-y-3">
                  <div className="flex justify-between text-xs font-bold font-mono">
                    <span className="text-muted-foreground">Density $\Phi$:</span>
                    <span className={cn(riskFluxDensity >= 0.7 ? "text-rose-400" : "text-emerald-400")}>
                      {(riskFluxDensity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={1.0}
                    step={0.05}
                    value={riskFluxDensity}
                    onChange={(e) => setRiskFluxDensity(parseFloat(e.target.value))}
                    className="w-full accent-rose-500"
                  />
                  <div className="text-[10px] text-muted-foreground flex justify-between">
                    <span>Observed: {(riskFluxDensity * 100).toFixed(0)}%</span>
                    <span>Expected: {(expectedRiskPhi * 100).toFixed(0)}%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Spatial Surprise Error */}
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                    Spatial Surprise Metric
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Surprise $\Delta\Phi$:</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-mono",
                        surpriseResult?.surpriseScore > 0.3
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      )}
                    >
                      {surpriseResult?.surpriseScore ? surpriseResult.surpriseScore.toFixed(3) : "0.230"}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>Bayesian Confidence:</span>
                    <span className="font-mono text-foreground font-bold">85.0%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Zero directional bias across all 6 neighbors.
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Isotropic Flux Field & Gaussian Generalization Rings */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Gaussian Generalization Rings */}
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="p-5 pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-cyan-400" />
                    Gaussian Kernel Decay & Concentric Hex Rings
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Isotropic radial expansion spreading risk density across adjacent hexagonal neighbors
                  </p>
                </CardHeader>
                <CardContent className="p-5 pt-2 space-y-4">
                  <div className="space-y-2.5">
                    {gaussianKernel?.ringDecayMap ? (
                      Object.entries(gaussianKernel.ringDecayMap).map(([ring, val]: [string, any]) => (
                        <div key={ring} className="p-3 rounded-xl bg-foreground/[0.02] border border-border/40 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                              Ring {ring}
                            </Badge>
                            <span className="text-xs text-foreground font-medium">
                              {ring === "0" ? "Centroid Hexagon" : `Radius ${Number(ring) * 500}m`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full"
                                style={{ width: `${Math.min(100, val * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono font-bold text-foreground">
                              {(val * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground p-4 text-center">
                        Evaluating Gaussian decay rings...
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Spectral Eigenvalues & Drift Vectors */}
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="p-5 pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Compass className="h-4 w-4 text-indigo-400" />
                    Spectral PCA Eigenvalues & Spatial Drift Direction
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Principal component decomposition of fleet cluster movement vectors
                  </p>
                </CardHeader>
                <CardContent className="p-5 pt-2 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-foreground/[0.02] border border-border/40 space-y-1">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Principal Eigenvalue (λ1)</div>
                      <div className="text-lg font-mono font-bold text-indigo-400">
                        {spectralResult?.eigenvalues?.[0] ? spectralResult.eigenvalues[0].toFixed(4) : "0.7842"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Dominant spatial variance axis</div>
                    </div>

                    <div className="p-3 rounded-xl bg-foreground/[0.02] border border-border/40 space-y-1">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Secondary Eigenvalue (λ2)</div>
                      <div className="text-lg font-mono font-bold text-cyan-400">
                        {spectralResult?.eigenvalues?.[1] ? spectralResult.eigenvalues[1].toFixed(4) : "0.2158"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Orthogonal drift spread</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-xs text-muted-foreground space-y-1">
                    <div className="font-bold text-foreground flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                      Spatial Agent Dispatch Guidance
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Eigenvalue ratio $\lambda_1 / \lambda_2 \ge 3.0$ indicates strong directional trajectory alignment. Autonomous dispatch models prioritize agent routing along the primary $\lambda_1$ eigenvector.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "palette" && (
          <div className="h-[750px] rounded-xl border border-border/60 overflow-hidden bg-card/80">
            <H3SpatialPalette />
          </div>
        )}
      </div>
    </div>
  );
}
