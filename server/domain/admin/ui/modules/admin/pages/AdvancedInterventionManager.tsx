import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import {
  Plus,
  Play,
  Pause,
  BarChart3,
  Users,
  Target,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Settings,
  TestTube,
  Brain,
  Eye,
  MousePointer,
  MessageSquare,
  Lightbulb,
  Activity,
  Sparkles
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Intervention {
  id: string;
  name: string;
  description: string;
  type: 'toast' | 'modal' | 'tooltip' | 'highlight' | 'guide' | 'suggestion';
  trigger: {
    vector: string;
    threshold: number;
    conditions: Record<string, any>;
  };
  content: {
    title?: string;
    message?: string;
    action?: string;
    variant?: 'default' | 'destructive' | 'success';
  };
  targeting: {
    userSegments: string[];
    aBTest: boolean;
    testGroups?: string[];
  };
  metrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    dismissals: number;
    effectiveness: number;
  };
  status: 'active' | 'inactive' | 'testing';
  createdAt: string;
  updatedAt: string;
}

interface ABTestResult {
  interventionId: string;
  testId: string;
  groupA: {
    name: string;
    impressions: number;
    conversions: number;
    rate: number;
  };
  groupB: {
    name: string;
    impressions: number;
    conversions: number;
    rate: number;
  };
  winner: string | null;
  confidence: number;
  status: 'running' | 'completed' | 'insufficient_data';
}

export default function AdvancedInterventionManager() {
  const [selectedIntervention, setSelectedIntervention] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const queryClient = useQueryClient();

  // Fetch interventions
  const { data: interventions = [], isLoading } = useQuery<Intervention[]>({
    queryKey: ['/api/interventions'],
    queryFn: async () => {
      const res = await fetch('/api/interventions');
      if (!res.ok) throw new Error('Failed to fetch interventions');
      return res.json();
    },
  });

  // Fetch A/B test results
  const { data: abTests = [] } = useQuery<ABTestResult[]>({
    queryKey: ['/api/interventions/ab-tests'],
    queryFn: async () => {
      const res = await fetch('/api/interventions/ab-tests');
      if (!res.ok) throw new Error('Failed to fetch A/B tests');
      return res.json();
    },
  });

  // Toggle intervention status
  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'inactive' }) => {
      const res = await fetch(`/api/interventions/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update intervention');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/interventions'] });
    },
  });

  // Start A/B test
  const startABTestMutation = useMutation({
    mutationFn: async (interventionId: string) => {
      const res = await fetch(`/api/interventions/${interventionId}/ab-test`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to start A/B test');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/interventions/ab-tests'] });
    },
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'toast': return <MessageSquare className="w-4 h-4" />;
      case 'modal': return <Eye className="w-4 h-4" />;
      case 'tooltip': return <Lightbulb className="w-4 h-4" />;
      case 'highlight': return <Target className="w-4 h-4" />;
      case 'guide': return <Users className="w-4 h-4" />;
      case 'suggestion': return <Brain className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-muted text-foreground';
      case 'testing': return 'bg-blue-100 text-blue-800';
      default: return 'bg-muted text-foreground';
    }
  };

  const calculateCTR = (clicks: number, impressions: number) => {
    return impressions > 0 ? (clicks / impressions) * 100 : 0;
  };

  const getABTestWinner = (test: ABTestResult) => {
    if (test.status !== 'completed') return null;
    if (test.groupA.rate > test.groupB.rate) return test.groupA.name;
    if (test.groupB.rate > test.groupA.rate) return test.groupB.name;
    return 'tie';
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30">
      {/* Cinematic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cinematic-grid opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay" />
      </div>

      <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8"
        >
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-[0.3em] uppercase italic">
              <Zap className="w-4 h-4 shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
              Intervention Protocol Omega
            </div>
            <div className="space-y-2">
              <h1 className="text-6xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                Tactical <span className="text-primary font-light not-italic tracking-[-0.05em]">Intervention Command</span>
              </h1>
              <p className="text-lg text-muted-foreground font-medium tracking-tight max-w-xl leading-relaxed">
                Autonomous user-engagement orchestration with predictive targeting and holographic A/B telemetry.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="outline" className="h-16 px-8 rounded-[2rem] glass-panel border-foreground/10 text-[11px] font-black uppercase tracking-[0.2em] text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all">
              <BarChart3 className="w-4 h-4 mr-3" />
              Neural Analytics
            </Button>
            <Button onClick={() => setShowCreateModal(true)} className="h-16 px-10 rounded-[2rem] bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all active:scale-95 group">
              <Plus className="h-5 w-5 mr-3 group-hover:rotate-90 transition-transform" />
              Initiate Module
            </Button>
          </div>
        </motion.div>

        {/* Key Metrics */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative group p-8">
              <div className="flex flex-row items-center justify-between space-y-0 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Active Deployments</CardTitle>
                <Zap className="w-5 h-5 text-primary animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="text-5xl font-black italic tracking-tighter text-foreground">
                  {interventions.filter(i => i.status === 'active').length}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">
                  OF {interventions.length} TOTAL VECTORS
                </p>
              </div>
              <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative group p-8">
              <div className="flex flex-row items-center justify-between space-y-0 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Neural Impressions</CardTitle>
                <Eye className="w-5 h-5 text-blue-400" />
              </div>
              <div className="space-y-1">
                <div className="text-5xl font-black italic tracking-tighter text-foreground">
                  {interventions.reduce((sum, i) => sum + i.metrics.impressions, 0).toLocaleString()}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">
                  TOTAL SENSORY UPLINK
                </p>
              </div>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative group p-8">
              <div className="flex flex-row items-center justify-between space-y-0 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Avg Effectiveness</CardTitle>
                <Target className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="space-y-3">
                <div className="text-5xl font-black italic tracking-tighter text-foreground">
                  {interventions.length > 0
                    ? (interventions.reduce((sum, i) => sum + i.metrics.effectiveness, 0) / interventions.length).toFixed(1)
                    : '0'
                  }%
                </div>
                <div className="h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden border border-foreground/5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${interventions.length > 0 ? (interventions.reduce((sum, i) => sum + i.metrics.effectiveness, 0) / interventions.length) : 0}%` }}
                    className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" 
                  />
                </div>
              </div>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden relative group p-8">
              <div className="flex flex-row items-center justify-between space-y-0 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">Ongoing Simulations</CardTitle>
                <TestTube className="w-5 h-5 text-purple-400" />
              </div>
              <div className="space-y-1">
                <div className="text-5xl font-black italic tracking-tighter text-foreground">
                  {abTests.filter(t => t.status === 'running').length}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic">
                  {abTests.filter(t => t.status === 'completed').length} COMPLETED TESTS
                </p>
              </div>
            </Card>
          </motion.div>
        </div>

        <Tabs defaultValue="interventions" className="space-y-8">
          <TabsList className="h-20 bg-foreground/[0.03] p-2 rounded-[2rem] border border-foreground/10 gap-2">
            <TabsTrigger value="interventions" className="h-full px-10 rounded-2xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-[0.2em] transition-all italic">
              Registry
            </TabsTrigger>
            <TabsTrigger value="ab-tests" className="h-full px-10 rounded-2xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-[0.2em] transition-all italic">
              Simulations
            </TabsTrigger>
            <TabsTrigger value="analytics" className="h-full px-10 rounded-2xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-[0.2em] transition-all italic">
              Performance
            </TabsTrigger>
            <TabsTrigger value="predictive" className="h-full px-10 rounded-2xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-[0.2em] transition-all italic">
              Neural Logic
            </TabsTrigger>
          </TabsList>

        <TabsContent value="interventions" className="space-y-4">
          {isLoading ? (
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-muted-foreground">Loading interventions...</p>
            </div>
          ) : interventions.length === 0 ? (
            <Card>
              <CardContent className="text-center py-6">
                <Zap className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Interventions Created</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first intervention to help guide users through your application.
                </p>
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Intervention
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {interventions.map((intervention) => (
                <motion.div 
                  key={intervention.id} 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="group"
                >
                  <Card className="glass-panel-deep border-foreground/10 hover:shadow-primary/5 transition-all duration-500 overflow-hidden relative flex flex-col h-full rounded-[2.5rem]">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <CardHeader className="relative pb-4 pt-10 px-8">
                      <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-5 transition-opacity translate-x-4 -translate-y-4 pointer-events-none">
                        {getTypeIcon(intervention.type)}
                      </div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-foreground/5 border border-foreground/10 text-primary">
                            {getTypeIcon(intervention.type)}
                          </div>
                          <Badge variant="outline" className="bg-foreground/5 text-foreground/40 border-foreground/10 text-[9px] font-black tracking-widest uppercase h-6 px-3 rounded-lg italic">
                            {intervention.type}_MODULE
                          </Badge>
                        </div>
                        <Badge className={cn(
                          "text-[9px] tracking-[0.2em] font-black h-6 px-3 rounded-lg uppercase italic border",
                          intervention.status === 'active' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-foreground/5 text-foreground/20 border-foreground/10"
                        )}>
                          {intervention.status}
                        </Badge>
                      </div>
                      <CardTitle className="text-2xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors uppercase italic leading-none">
                        {intervention.name}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-foreground/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed h-12 pt-2 italic">
                        {intervention.description}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-6 pt-2 px-8 flex-grow">
                      {/* Metrics HUD */}
                      <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                        <div className="space-y-1">
                          <p className="text-[9px] font-black uppercase text-foreground/20 tracking-widest italic">Signal Uplink</p>
                          <p className="text-xl font-black italic tracking-tighter text-foreground">{intervention.metrics.impressions.toLocaleString()}</p>
                        </div>
                        <div className="space-y-1 border-l border-foreground/5 pl-4">
                          <p className="text-[9px] font-black uppercase text-foreground/20 tracking-widest italic">Efficiency</p>
                          <p className="text-xl font-black italic tracking-tighter text-primary">
                            {calculateCTR(intervention.metrics.clicks, intervention.metrics.impressions).toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      {/* Vector Targeting */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-foreground/20 italic">
                          <span>Target Vector: {intervention.trigger.vector}</span>
                          <span className="text-primary">{intervention.trigger.threshold} THRESHOLD</span>
                        </div>
                        <div className="h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: "65%" }}
                            className="h-full bg-primary/50 shadow-[0_0_10px_rgba(var(--primary),0.3)]" 
                          />
                        </div>
                      </div>
                    </CardContent>

                    <CardFooter className="pt-4 pb-8 px-8 flex items-center justify-between border-t border-foreground/5 bg-foreground/[0.01]">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={intervention.status === 'active'}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({
                              id: intervention.id,
                              status: checked ? 'active' : 'inactive'
                            })
                          }
                          className="data-[state=checked]:bg-primary"
                        />
                        <span className="text-[9px] font-black text-foreground/20 uppercase tracking-[0.1em] italic">
                          {intervention.status === 'active' ? 'SIGNAL_LIVE' : 'SIGNAL_IDLE'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {intervention.targeting.aBTest && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 rounded-xl border-foreground/10 text-[9px] font-black uppercase tracking-widest text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all px-4"
                            onClick={() => startABTestMutation.mutate(intervention.id)}
                            disabled={abTests.some(t => t.interventionId === intervention.id && t.status === 'running')}
                          >
                            <TestTube className="w-3.5 h-3.5 mr-2 text-purple-400" />
                            Simulate
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-foreground/10 transition-all">
                          <Settings className="w-4 h-4 text-foreground/40" />
                        </Button>
                      </div>
                    </CardFooter>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ab-tests" className="space-y-8">
          {abTests.length === 0 ? (
            <div className="text-center py-32 glass-panel-deep border-foreground/10 rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center space-y-8 text-center px-12">
              <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20 shadow-glow/10">
                <TestTube className="w-10 h-10 text-primary animate-pulse" />
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter italic">No Active Simulations</h3>
                <p className="text-foreground/40 text-[10px] font-black uppercase tracking-widest max-w-sm mx-auto italic">Enable A/B telemetry on verified modules to optimize engagement efficiency.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {abTests.map((test) => (
                <Card key={test.testId} className="glass-panel-deep border-foreground/10 rounded-[3rem] p-10 relative overflow-hidden group">
                  <div className="flex flex-col lg:flex-row items-center justify-between gap-12 relative z-10">
                    <div className="flex-1 space-y-4 text-center lg:text-left">
                      <div className="flex items-center justify-center lg:justify-start gap-4">
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full uppercase italic">
                           SIMULATION_{test.testId.slice(0, 8)}
                        </Badge>
                        <Badge className={cn("text-[10px] tracking-widest font-black px-4 py-1.5 rounded-full uppercase italic", test.status === 'completed' ? "bg-emerald-500 text-foreground" : "bg-primary text-primary-foreground")}>
                          {test.status}
                        </Badge>
                      </div>
                      <h3 className="text-3xl font-black italic tracking-tighter uppercase text-foreground">
                        {interventions.find(i => i.id === test.interventionId)?.name || 'NEURAL VECTOR'}
                      </h3>
                    </div>

                    <div className="flex-1 grid grid-cols-2 gap-8 w-full max-w-xl">
                      <div className="p-8 rounded-[2rem] bg-indigo-500/5 border border-indigo-500/10 text-center relative overflow-hidden group/variant">
                        <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 opacity-20" />
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-2 italic">{test.groupA.name}</h4>
                        <div className="text-5xl font-black italic tracking-tighter text-foreground mb-2">{test.groupA.rate.toFixed(1)}%</div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-foreground/20 italic">
                          {test.groupA.conversions} CONV UNITS
                        </p>
                      </div>

                      <div className="p-8 rounded-[2rem] bg-emerald-500/5 border border-emerald-500/10 text-center relative overflow-hidden group/variant">
                        <div className="absolute top-0 right-0 w-1 h-full bg-emerald-500 opacity-20" />
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-2 italic">{test.groupB.name}</h4>
                        <div className="text-5xl font-black italic tracking-tighter text-foreground mb-2">{test.groupB.rate.toFixed(1)}%</div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-foreground/20 italic">
                          {test.groupB.conversions} CONV UNITS
                        </p>
                      </div>
                    </div>

                    <div className="flex-1 text-center lg:text-right space-y-4">
                        {test.status === 'completed' ? (
                          <div className="p-8 rounded-[2rem] bg-primary/10 border border-primary/20 shadow-glow/5">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2 italic">Primary Victor</h4>
                            <div className="text-3xl font-black italic tracking-tighter text-foreground uppercase">{getABTestWinner(test)}</div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic mt-2">
                              {test.confidence.toFixed(1)}% CONFIDENCE STRENGTH
                            </p>
                          </div>
                        ) : (
                          <div className="p-8 rounded-[2rem] bg-foreground/[0.03] border border-foreground/10 animate-pulse">
                            <Activity className="w-8 h-8 text-primary mx-auto mb-2" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic">COLLECTING SIGNAL TRAFFIC</p>
                          </div>
                        )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-8">
          <div className="grid gap-8 md:grid-cols-2">
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden group p-10">
              <CardHeader className="p-0 pb-8">
                <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-4">
                  <TrendingUp className="w-6 h-6 text-primary" />
                  Efficiency Heatmap
                </CardTitle>
                <CardDescription className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic pt-1">Current module effectiveness distribution across neural vectors.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 space-y-6">
                {interventions.slice(0, 5).map((intervention) => (
                  <div key={intervention.id} className="space-y-3">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-foreground/40 italic">
                      <span className="truncate">{intervention.name}</span>
                      <span className="text-primary">{intervention.metrics.effectiveness.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden border border-foreground/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${intervention.metrics.effectiveness}%` }}
                        className="h-full bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" 
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden group p-10 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20 mb-6">
                   <Users className="w-8 h-8 text-primary opacity-40" />
                </div>
                <h4 className="text-xl font-black italic tracking-tighter text-foreground uppercase mb-4">Neural Flow Geometry</h4>
                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20 italic max-w-xs">
                    Engage secondary telemetry uplink to visualize real-time user session trajectories and intervention impact.
                </p>
                <Button variant="outline" className="mt-8 h-12 px-8 rounded-2xl border-foreground/10 text-[10px] font-black uppercase tracking-widest text-foreground/40 hover:text-foreground transition-all">
                   Initialize Visual Feed
                </Button>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="predictive" className="space-y-8">
          <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] overflow-hidden relative group p-12">
            <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 rotate-12">
                <Brain className="w-48 h-48 text-primary" />
            </div>
            
            <CardHeader className="p-0 pb-10">
              <CardTitle className="text-3xl font-black italic tracking-tighter uppercase text-foreground flex items-center gap-6">
                <Brain className="w-8 h-8 text-primary shadow-glow" />
                Predictive Logic Core
              </CardTitle>
              <CardDescription className="text-[11px] font-black uppercase tracking-widest text-foreground/20 italic pt-2">
                AI-driven strategy generated from global user behavior telemetry.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 space-y-10">
              <div className="p-10 bg-primary/5 border border-primary/20 rounded-[2.5rem] relative overflow-hidden group/alert">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                    <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                  </div>
                  <span className="text-sm font-black italic uppercase tracking-wider text-foreground">System Insight Alpha 7</span>
                </div>
                <p className="text-base text-foreground/60 mb-8 italic leading-relaxed max-w-2xl font-medium">
                  Behavioral pattern analysis indicates a <span className="text-primary font-black">42% friction spike</span> in form validation cycles. 
                  Consider deploying a <span className="text-foreground font-black italic">Contextual Assist</span> module to users exceeding 180s on "Step 3".
                </p>
                <Button className="h-14 px-10 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] text-[10px] shadow-xl transition-all">
                  Generate Module Primitive
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="p-8 rounded-[2rem] bg-foreground/[0.02] border border-foreground/5 space-y-4">
                    <div className="flex items-center gap-3">
                       <Target className="w-5 h-5 text-emerald-400" />
                       <h4 className="text-[11px] font-black uppercase tracking-widest text-foreground italic">Optimal Window Detected</h4>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/20 italic leading-relaxed">
                        Data confirms peak receptivity between 600-900ms post-action completion. 
                        Threshold verified at <span className="text-emerald-400">98.4% accuracy</span>.
                    </p>
                 </div>
                 <div className="p-8 rounded-[2rem] bg-foreground/[0.02] border border-foreground/5 space-y-4">
                    <div className="flex items-center gap-3">
                       <Users className="w-5 h-5 text-blue-400" />
                       <h4 className="text-[11px] font-black uppercase tracking-widest text-foreground italic">Segment Sync Active</h4>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/20 italic leading-relaxed">
                        High-intent architects are currently being prioritized for <span className="text-blue-400 italic">Advanced Feedback</span> modules.
                        Total population: 2,841 active entities.
                    </p>
                 </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  </div>
  );
}
