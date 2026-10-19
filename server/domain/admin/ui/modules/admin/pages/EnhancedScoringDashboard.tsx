import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Users,
  Target,
  Clock,
  Zap,
  BarChart3,
  Brain,
  AlertTriangle,
  CheckCircle,
  Eye,
  MousePointer,
  Keyboard,
  Timer,
  Award,
  Lightbulb,
  ChevronRight,
  ArrowUpRight,
  History,
  Cpu,
  Layers
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ActivityMetrics {
  totalUsers: number;
  activeUsers: number;
  avgSessionTime: number;
  totalSessions: number;
  avgScore: number;
  topActivities: Array<{
    activity: string;
    count: number;
    avgScore: number;
  }>;
  vectorBreakdown: Record<string, {
    score: number;
    trend: number;
    activities: number;
  }>;
  interventionStats: {
    triggered: number;
    effective: number;
    ignored: number;
  };
}

interface UserActivity {
  userId: string;
  score: number;
  vector: string;
  activity: string;
  timestamp: string;
  sessionId: string;
  metadata: Record<string, any>;
}

// Skeleton helper for loading state
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-foreground/5 rounded-2xl", className)} />;
}

export default function EnhancedScoringDashboard() {
  const [timeRange, setTimeRange] = useState("24h");
  const [selectedVector, setSelectedVector] = useState("all");

  // Fetch enhanced activity metrics
  const { data: metrics, isLoading } = useQuery<ActivityMetrics>({
    queryKey: ['/api/scoring/enhanced-metrics', timeRange],
    queryFn: async () => {
      const res = await fetch(`/api/scoring/enhanced-metrics?range=${timeRange}`);
      if (!res.ok) throw new Error('Failed to fetch metrics');
      return res.json();
    },
  });

  // Fetch real-time user activities
  const { data: recentActivities } = useQuery<UserActivity[]>({
    queryKey: ['/api/scoring/recent-activities'],
    queryFn: async () => {
      const res = await fetch('/api/scoring/recent-activities?limit=50');
      if (!res.ok) throw new Error('Failed to fetch activities');
      return res.json();
    },
    refetchInterval: 5000, 
  });

  const vectorColors = {
    S: "text-rose-500",
    C: "text-amber-500",
    O: "text-emerald-500",
    R: "text-primary",
    E: "text-purple-500"
  };

  const vectorGlows = {
    S: "shadow-glow-rose",
    C: "shadow-glow-amber",
    O: "shadow-glow-emerald",
    R: "shadow-glow",
    E: "shadow-glow-purple"
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      <main className="flex-1 flex flex-col gap-6">
        {/* Page Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Score Analytics</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Neural scoring & performance matrix</p>
          </div>
          <div className="flex gap-2 items-center">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last Hour</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Export
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : (
          <>
            {/* Intelligence HUD */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                  <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/10 transition-all group overflow-hidden">
                    <CardContent className="p-8">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Cognition</p>
                        <div className="p-3 bg-primary/10 rounded-xl group-hover:scale-110 transition-transform shadow-glow">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-1">
                        {metrics?.activeUsers || 0}
                      </div>
                      <p className="text-[8px] font-bold text-foreground/10 uppercase tracking-widest italic">
                        {metrics?.totalUsers || 0} Entities Registered
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                  <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/10 transition-all group overflow-hidden">
                    <CardContent className="p-8">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Temporal Resonance</p>
                        <div className="p-3 bg-foreground/5 rounded-xl group-hover:scale-110 transition-transform">
                          <Clock className="w-5 h-5 text-foreground/40" />
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-1">
                        {Math.round((metrics?.avgSessionTime || 0) / 60)}<span className="text-sm">m</span>
                      </div>
                      <p className="text-[8px] font-bold text-foreground/10 uppercase tracking-widest italic">
                        {metrics?.totalSessions || 0} Concurrent Sessions_
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                  <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/10 transition-all group overflow-hidden">
                    <CardContent className="p-8">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mean Coefficient</p>
                        <div className="p-3 bg-emerald-500/10 rounded-xl group-hover:scale-110 transition-transform shadow-glow-emerald">
                          <Target className="w-5 h-5 text-emerald-500" />
                        </div>
                      </div>
                      <div className="text-4xl font-black font-mono tracking-tighter italic text-emerald-500 mb-2">
                        {(metrics?.avgScore || 0).toFixed(1)}
                      </div>
                      <div className="h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }} 
                          animate={{ width: `${(metrics?.avgScore || 0) * 10}%` }} 
                          className="h-full bg-emerald-500 shadow-glow-emerald" 
                        />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                  <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/10 transition-all group overflow-hidden">
                    <CardContent className="p-8">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Intervention State</p>
                        <div className="p-3 bg-amber-500/10 rounded-xl group-hover:scale-110 transition-transform shadow-glow-amber">
                          <Zap className="w-5 h-5 text-amber-500" />
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-1">
                        {metrics?.interventionStats.triggered || 0}
                      </div>
                      <p className="text-[8px] font-bold text-amber-500 uppercase tracking-widest italic">
                        {Math.round(((metrics?.interventionStats.effective || 0) / Math.max(1, metrics?.interventionStats.triggered || 0)) * 100)}% Conversion Rate_
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
            </section>

            <Tabs defaultValue="vectors" className="space-y-12">
              <TabsList className="bg-foreground/5 p-1.5 rounded-2xl border border-foreground/5 h-16">
                <TabsTrigger value="vectors" className="rounded-xl px-10 text-[10px] font-black uppercase italic tracking-widest data-[state=active]:bg-primary data-[state=active]:text-background transition-all">S.C.O.R.E._Vectors_</TabsTrigger>
                <TabsTrigger value="activities" className="rounded-xl px-10 text-[10px] font-black uppercase italic tracking-widest data-[state=active]:bg-primary data-[state=active]:text-background transition-all">Top Activities_</TabsTrigger>
                <TabsTrigger value="realtime" className="rounded-xl px-10 text-[10px] font-black uppercase italic tracking-widest data-[state=active]:bg-primary data-[state=active]:text-background transition-all">Live Resonances_</TabsTrigger>
                <TabsTrigger value="insights" className="rounded-xl px-10 text-[10px] font-black uppercase italic tracking-widest data-[state=active]:bg-primary data-[state=active]:text-background transition-all">Neural Insights_</TabsTrigger>
              </TabsList>

              <TabsContent value="vectors" className="space-y-8 outline-none pb-20">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
                  {Object.entries(metrics?.vectorBreakdown || {}).map(([vector, data], idx) => (
                    <motion.div
                      key={vector}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <Card className="glass-panel-deep border-foreground/5 hover:border-foreground/20 hover:-translate-y-2 transition-all group overflow-hidden h-full rounded-[2rem]">
                        <div className={cn("absolute top-0 left-0 w-full h-1 opacity-50 bg-current", vectorColors[vector as keyof typeof vectorColors])} />
                        <CardHeader className="p-8 pb-4">
                           <div className="flex items-center justify-between">
                            <h3 className={cn("text-5xl font-black italic tracking-tighter transition-all group-hover:scale-110", vectorColors[vector as keyof typeof vectorColors], vectorGlows[vector as keyof typeof vectorColors])}>{vector}</h3>
                            <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/10">
                              {data.trend > 0 ? (
                                <TrendingUp className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <TrendingDown className="w-4 h-4 text-rose-500" />
                              )}
                            </div>
                           </div>
                           <p className="text-[8px] font-black uppercase tracking-[0.3em] text-foreground/20 mt-2 italic">Vector Identity Monitor</p>
                        </CardHeader>
                        <CardContent className="p-8 pt-0 space-y-6">
                           <div>
                              <div className="flex justify-between items-end mb-2">
                                <span className="text-[10px] font-black text-foreground italic uppercase tracking-widest">Coeff_</span>
                                <span className="text-2xl font-black font-mono text-foreground italic tracking-tighter">{data.score.toFixed(1)}</span>
                              </div>
                              <div className="h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }} 
                                  animate={{ width: `${data.score * 10}%` }} 
                                  className={cn("h-full transition-all", vectorColors[vector as keyof typeof vectorColors].replace('text-', 'bg-'), vectorGlows[vector as keyof typeof vectorColors])} 
                                />
                              </div>
                           </div>

                           <div className="flex justify-between items-center p-3 rounded-xl bg-foreground/[0.02] border border-foreground/10">
                              <span className="text-[8px] font-black text-foreground/20 uppercase tracking-widest italic">Trend Resonance</span>
                              <span className={cn("text-[10px] font-black font-mono italic", data.trend > 0 ? "text-emerald-500" : "text-rose-500")}>
                                {data.trend > 0 ? "+" : ""}{data.trend.toFixed(1)}
                              </span>
                           </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="activities" className="outline-none pb-20">
                <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden shadow-2xl">
                  <CardHeader className="p-10 border-b border-foreground/5 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground mb-1">Activity Hierarchies_</CardTitle>
                      <CardDescription className="text-[10px] font-bold text-foreground/40 italic uppercase tracking-widest">Global Interaction Distribution Matrix</CardDescription>
                    </div>
                    <Layers className="text-primary/20 w-8 h-8" />
                  </CardHeader>
                  <CardContent className="p-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {metrics?.topActivities.slice(0, 10).map((activity, idx) => (
                        <motion.div
                          key={activity.activity}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="flex items-center justify-between p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5 hover:bg-foreground/[0.05] hover:border-primary/20 transition-all group"
                        >
                          <div className="flex items-center gap-6">
                            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-foreground/5 border border-foreground/10 text-primary font-black italic text-xs shadow-glow">
                              {idx + 1}
                            </div>
                            <div>
                              <p className="text-sm font-black italic uppercase tracking-tighter text-foreground group-hover:text-primary transition-colors">{activity.activity}</p>
                              <p className="text-[9px] font-bold text-foreground/10 uppercase tracking-widest italic">{activity.count} Occurrences Verified</p>
                            </div>
                          </div>
                          <Badge className="h-10 px-6 rounded-xl bg-foreground/5 border-foreground/10 text-xs font-black italic text-foreground shadow-xl">
                            {activity.avgScore.toFixed(1)} <span className="text-[8px] ml-1 opacity-50 uppercase tracking-widest font-bold">PTS</span>
                          </Badge>
                        </motion.div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="realtime" className="outline-none pb-20">
                <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden shadow-2xl flex flex-col h-[700px]">
                  <CardHeader className="p-10 border-b border-foreground/5 flex flex-row items-center justify-between shrink-0">
                    <div className="flex gap-4 items-center">
                      <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 shadow-glow">
                        <Activity className="w-6 h-6 text-primary animate-pulse" />
                      </div>
                      <div>
                        <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground mb-1">Live Resonance Stream_</CardTitle>
                        <CardDescription className="text-[10px] font-bold text-foreground/40 italic uppercase tracking-widest">Real-time Neural Activity Monitoring</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex gap-4">
                        {['S', 'C', 'O', 'R', 'E'].map(v => (
                          <div key={v} className={cn("w-3 h-3 rounded-full", vectorColors[v as keyof typeof vectorColors].replace('text-', 'bg-'), vectorGlows[v as keyof typeof vectorColors])} title={`Vector ${v}`} />
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 flex-1 overflow-hidden">
                    <div className="h-full overflow-y-auto custom-scrollbar p-10 space-y-4">
                      <AnimatePresence>
                        {recentActivities?.map((activity, idx) => (
                          <motion.div
                            key={`${activity.userId}-${activity.timestamp}-${idx}`}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center justify-between p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/5 hover:border-foreground/10 transition-all group"
                          >
                            <div className="flex items-center gap-6">
                              <div className={cn("p-4 rounded-xl border relative overflow-hidden", vectorColors[activity.vector as keyof typeof vectorColors].replace('text-', 'bg-').replace('500', '500/10'), vectorColors[activity.vector as keyof typeof vectorColors].replace('text-', 'border-').replace('500', '500/20'))}>
                                <div className={cn("absolute inset-0 bg-noise opacity-20", vectorGlows[activity.vector as keyof typeof vectorColors])} />
                                <Cpu size={20} className={cn("relative z-10", vectorColors[activity.vector as keyof typeof vectorColors])} />
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-black italic uppercase tracking-tighter text-foreground">{activity.activity}</p>
                                <p className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest italic">
                                  Identity: {activity.userId.slice(0, 12)}... // Vector: {activity.vector}
                                </p>
                              </div>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                              <Badge className={cn("h-10 px-6 rounded-xl border-none text-background text-[11px] font-black italic shadow-glow-emerald", vectorColors[activity.vector as keyof typeof vectorColors].replace('text-', 'bg-'))}>
                                {activity.score.toFixed(1)} <span className="text-[8px] ml-1 opacity-60 uppercase font-black">Coeff</span>
                              </Badge>
                              <div className="flex items-center gap-2 text-foreground/10">
                                <History size={10} />
                                <span className="text-[9px] font-black italic font-mono">{new Date(activity.timestamp).toLocaleTimeString()}</span>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="insights" className="outline-none pb-20 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden shadow-2xl relative">
                    <div className="absolute -top-10 -right-10 opacity-10">
                      <Brain size={200} className="text-primary animate-pulse" />
                    </div>
                    <CardHeader className="p-10 border-b border-foreground/5">
                      <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 shadow-glow">
                          <Brain className="w-6 h-6 text-primary" />
                        </div>
                        Cognitive Inferences_
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-10 space-y-6">
                      <div className="p-8 rounded-[2rem] bg-indigo-500/5 border border-indigo-500/10 relative group overflow-hidden transition-all hover:bg-indigo-500/10">
                        <div className="absolute top-0 right-0 p-8">
                          <Lightbulb className="text-indigo-500/20 group-hover:text-indigo-500 transition-colors" />
                        </div>
                        <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-500 mb-2 italic">Optimization Protocol_</h5>
                        <p className="text-sm font-bold text-foreground/60 italic uppercase tracking-tighter leading-relaxed max-w-sm">
                          ENTITIES SPENDING &gt;5M ON COMMAND SEARCH EXHIBIT NEURAL LATENCY. ENGINE RECOMMENDS NAVIGATION HINT INJECTION.
                        </p>
                        <ArrowUpRight className="absolute bottom-8 right-8 text-foreground/10 group-hover:text-foreground transition-all" size={20} />
                      </div>

                      <div className="p-8 rounded-[2rem] bg-emerald-500/5 border border-emerald-500/10 relative group overflow-hidden transition-all hover:bg-emerald-500/10">
                        <div className="absolute top-0 right-0 p-8">
                          <Award className="text-emerald-500/20 group-hover:text-emerald-500 transition-colors" />
                        </div>
                        <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-500 mb-2 italic">Efficient Heuristic_</h5>
                        <p className="text-sm font-bold text-foreground/60 italic uppercase tracking-tighter leading-relaxed max-w-sm">
                          ENTITIES WITH HIGH OUTCOME VECTORS COMPLETE MISSIONS 40% FASTER. POSITIVE REINFORCEMENT CYCLE DETECTED.
                        </p>
                        <ArrowUpRight className="absolute bottom-8 right-8 text-foreground/10 group-hover:text-foreground transition-all" size={20} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden shadow-2xl">
                    <CardHeader className="p-10 border-b border-foreground/5">
                      <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 shadow-glow-rose">
                          <AlertTriangle className="w-6 h-6 text-rose-500" />
                        </div>
                        Intervention Efficiency_
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-10 space-y-10">
                      <div className="space-y-6">
                        <div className="flex justify-between items-end">
                          <p className="text-[10px] font-black uppercase tracking-widest italic text-emerald-500">Effective Interventions</p>
                          <span className="text-2xl font-black font-mono tracking-tighter italic text-foreground">{metrics?.interventionStats.effective || 0}</span>
                        </div>
                        <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden shadow-inner">
                          <motion.div 
                            initial={{ width: 0 }} 
                            animate={{ width: `${((metrics?.interventionStats.effective || 0) / Math.max(1, metrics?.interventionStats.triggered || 0)) * 100}%` }} 
                            className="h-full bg-emerald-500 shadow-glow-emerald" 
                          />
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="flex justify-between items-end">
                          <p className="text-[10px] font-black uppercase tracking-widest italic text-rose-500">Ignored Cognitions</p>
                          <span className="text-2xl font-black font-mono tracking-tighter italic text-foreground">{metrics?.interventionStats.ignored || 0}</span>
                        </div>
                        <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden shadow-inner">
                          <motion.div 
                            initial={{ width: 0 }} 
                            animate={{ width: `${((metrics?.interventionStats.ignored || 0) / Math.max(1, metrics?.interventionStats.triggered || 0)) * 100}%` }} 
                            className="h-full bg-rose-500 shadow-glow-rose" 
                          />
                        </div>
                      </div>

                      <Button className="w-full h-16 rounded-[1.5rem] bg-foreground text-background hover:bg-primary transition-all text-[11px] font-black uppercase italic tracking-[0.3em] font-mono shadow-xl group">
                        <Brain className="w-4 h-4 mr-3 group-hover:animate-pulse" />
                        OPTIMIZE INTERVENTION KINETICS_
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>

      <style>{`
        .shadow-glow-emerald {
          filter: drop-shadow(0 0 10px rgba(16,185,129,0.5));
        }
        .shadow-glow-rose {
          filter: drop-shadow(0 0 10px rgba(244,63,94,0.5));
        }
        .shadow-glow-amber {
          filter: drop-shadow(0 0 10px rgba(245,158,11,0.5));
        }
        .shadow-glow-purple {
          filter: drop-shadow(0 0 10px rgba(168,85,247,0.5));
        }
      `}</style>
    </div>
  );
}
