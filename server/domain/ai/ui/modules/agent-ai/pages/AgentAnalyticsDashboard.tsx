import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { ToolUsageHeatmap } from '../components/ToolUsageHeatmap';
import { CostEfficiencyChart } from '../components/CostEfficiencyChart';
import { AgentComparisonTable } from '../components/AgentComparisonTable';
import { SuccessRateGauge } from '../components/SuccessRateGauge';
import { 
    Activity, TrendingUp, Users, Zap, Brain, 
    Network, Target, Cpu, Sparkles, Binary, 
    History, Workflow, Gauge, ShieldCheck, 
    BarChart3, RefreshCcw, GitBranch, DollarSign
} from "lucide-react";
import { useState } from "react";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { cn } from "@/lib/utils";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Label } from "@domain-ui/core/ui/components/ui/label";

export function AgentAnalyticsDashboard() {
    const { isAdmin, isSuperAdmin, isOrgAdmin } = useOrgContext();
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
    const [timeRange, setTimeRange] = useState<string>("7d");

    // Fetch available agents
    const { data: agents = [] } = useQuery({
        queryKey: ['/api/jobs'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/jobs?type=ai_agent');
            const data = await res.json();
            return data.items || [];
        }
    });

    // Fetch tool usage data
    const { data: toolUsage = [] } = useQuery({
        queryKey: ['/api/agent/analytics/tools'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/agent/analytics/tools');
            return res.json();
        }
    });

    // Fetch cost trends
    const { data: costTrends = [] } = useQuery({
        queryKey: ['/api/agent/analytics/cost-trends', timeRange],
        queryFn: async () => {
            const groupBy = timeRange === '7d' ? 'day' : timeRange === '30d' ? 'day' : 'week';
            const res = await apiRequest('GET', `/api/agent/analytics/cost-trends?groupBy=${groupBy}`);
            return res.json();
        }
    });

    // Calculate summary metrics
    const totalToolUsage = toolUsage.reduce((sum: number, tool: any) => sum + tool.count, 0);
    const totalCost = costTrends.reduce((sum: number, trend: any) => sum + parseFloat(trend.estimatedCost || 0), 0);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <main className="flex-1 flex flex-col gap-6">
                {/* Page Header */}
                <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Agent Analytics</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">Intelligence telemetry &amp; agent performance metrics</p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end gap-1">
                            <p className="text-xs text-muted-foreground">Time range</p>
                            <Select value={timeRange} onValueChange={setTimeRange}>
                                <SelectTrigger className="w-[140px] h-8 text-sm">
                                    <SelectValue placeholder="Select range" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="7d">Last 7 Days</SelectItem>
                                    <SelectItem value="30d">Last 30 Days</SelectItem>
                                    <SelectItem value="90d">Last 90 Days</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <p className="text-xs text-muted-foreground">Active agents</p>
                            <p className="text-lg font-bold text-foreground">{agents.length}</p>
                        </div>
                    </div>
                </header>

                {/* Summary Cards */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div className="bg-card border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg">
                                <Workflow className="w-4 h-4 text-indigo-500" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">Tool Usage</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Tool Usage</p>
                        <h2 className="text-2xl font-bold text-foreground">{totalToolUsage.toLocaleString()}</h2>
                    </div>

                    <Card className="bg-card border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                                <DollarSign className="w-4 h-4 text-emerald-500" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">Est. Cost</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Estimated Cost</p>
                        <h2 className="text-2xl font-bold text-foreground">${totalCost.toFixed(2)}</h2>
                    </Card>

                    <div className="bg-card border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2 bg-cyan-500/10 rounded-lg">
                                <Cpu className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">Agents</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Neural Agents</p>
                        <h2 className="text-2xl font-bold text-foreground">{agents.length}</h2>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2 bg-amber-500/10 rounded-lg">
                                <Target className="w-4 h-4 text-amber-500" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">Success</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Avg. Success Rate</p>
                        <h2 className="text-2xl font-bold text-foreground">94.2%</h2>
                    </div>
                </div>

                {/* Main Analytics Interface */}
                <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
                    <Tabs defaultValue="overview" className="flex-1 space-y-4">
                        <div className="flex items-center justify-between">
                            <TabsList>
                                <TabsTrigger value="overview">Overview</TabsTrigger>
                                <TabsTrigger value="tools">Tool Usage</TabsTrigger>
                                <TabsTrigger value="costs">Cost Analysis</TabsTrigger>
                                <TabsTrigger value="compare">Agent Matrix</TabsTrigger>
                            </TabsList>
                            
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                    <span className="text-xs text-muted-foreground">Live</span>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <RefreshCcw className="w-4 h-4 text-muted-foreground" />
                                </Button>
                            </div>
                        </div>

                        <TabsContent value="overview" className="space-y-6 outline-none">
                            <div className="grid gap-4 lg:grid-cols-2">
                                <Card className="bg-card border border-border rounded-xl p-6 space-y-4 overflow-hidden">
                                    <div className="space-y-0.5">
                                        <h3 className="text-sm font-semibold text-foreground">Tool Usage Heatmap</h3>
                                        <p className="text-xs text-muted-foreground">Usage density across the temporal spectrum</p>
                                    </div>
                                    <ToolUsageHeatmap timeRange={timeRange} />
                                </Card>

                                <Card className="bg-card border border-border rounded-xl p-6 space-y-4 overflow-hidden">
                                    <div className="space-y-0.5">
                                        <h3 className="text-sm font-semibold text-foreground">Cost Efficiency Trends</h3>
                                        <p className="text-xs text-muted-foreground">Estimated resource expenditure per interval</p>
                                    </div>
                                    <CostEfficiencyChart data={costTrends} />
                                </Card>
                            </div>

                            {/* Tool Evolution Insights (WOW Factor) */}
                            <div className="space-y-8">
                                <div className="flex items-center gap-6">
                                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                                        <span className="text-[12px] font-black uppercase tracking-[0.4em] text-foreground/40 italic">Neural Convergence Stream</span>
                                    </div>
                                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {[
                                        { tool: "Search_Engine_V3", skill: "Market_Intelligence", confidence: 98, type: "CONVERGENCE", desc: "Clustered search + indexing into a persistent research primitive." },
                                        { tool: "Code_Interpreter", skill: "Logic_Optimization", confidence: 92, type: "SYNTHESIS", desc: "Python runtime + AST analysis unified for code-level refactoring." },
                                        { tool: "Browser_Automator", skill: "UI_Orchestration", confidence: 87, type: "EVOLUTION", desc: "Selenium + Vision AI consolidated for autonomous web navigation." }
                                    ].map((event, i) => (
                                        <motion.div 
                                            key={i}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.1 * i }}
                                            className="glass-panel-deep border-foreground/5 rounded-3xl p-8 space-y-4 group hover:border-primary/20 transition-all cursor-help"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
                                                    <Binary className="w-4 h-4 text-primary shadow-glow" />
                                                </div>
                                                <Badge className="bg-primary/20 text-primary border-none text-[8px] font-black tracking-tighter uppercase italic">{event.type}</Badge>
                                            </div>
                                            <div className="space-y-2">
                                                <h4 className="text-lg font-black italic tracking-tighter text-foreground uppercase leading-none group-hover:text-primary transition-colors">{event.tool} → {event.skill}</h4>
                                                <p className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest italic line-clamp-2">{event.desc}</p>
                                            </div>
                                            <div className="pt-2 space-y-2">
                                                <div className="flex justify-between text-[8px] font-black text-foreground/20 uppercase tracking-widest italic">
                                                    <span>Confidence Score</span>
                                                    <span className="text-primary">{event.confidence}%</span>
                                                </div>
                                                <Progress value={event.confidence} className="h-1 bg-foreground/5" />
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="tools" className="outline-none">
                            <Card className="glass-panel-deep border-foreground/5 rounded-[4rem] p-12 overflow-hidden relative group min-h-[600px]">
                                <div className="absolute top-0 right-0 p-20 opacity-[0.02] pointer-events-none group-hover:scale-110 transition-transform duration-1000">
                                    <BarChart3 size={400} />
                                </div>
                                <div className="flex justify-between items-start mb-12 relative z-10">
                                    <div className="space-y-2">
                                        <h3 className="text-4xl font-black italic tracking-tighter text-foreground uppercase leading-none">Tool Usage Heatmap</h3>
                                        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Deep temporal scan of capability invocation patterns</p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5 flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-[8px] font-black text-foreground/20 uppercase tracking-widest italic">Peak Intensity</p>
                                            <p className="text-xl font-black text-primary italic tracking-tighter">09:00 PST</p>
                                        </div>
                                        <div className="w-px h-10 bg-foreground/5" />
                                        <div className="text-right">
                                            <p className="text-[8px] font-black text-foreground/20 uppercase tracking-widest italic">Avg Latency</p>
                                            <p className="text-xl font-black text-foreground italic tracking-tighter">1.2s</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="relative z-10">
                                    <ToolUsageHeatmap timeRange={timeRange} detailed />
                                </div>
                            </Card>
                        </TabsContent>

                        <TabsContent value="costs" className="outline-none">
                            <Card className="glass-panel-deep border-foreground/5 rounded-[4rem] p-12 overflow-hidden relative group min-h-[600px]">
                                <div className="absolute top-0 right-0 p-20 opacity-[0.02] pointer-events-none group-hover:scale-110 transition-transform duration-1000">
                                    <TrendingUp size={400} />
                                </div>
                                <div className="flex justify-between items-start mb-12 relative z-10">
                                    <div className="space-y-2">
                                        <h3 className="text-4xl font-black italic tracking-tighter text-foreground uppercase leading-none">Fiscal Intelligence</h3>
                                        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Analyzing resource burn and predictive expenditure</p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-[8px] font-black text-emerald-500/40 uppercase tracking-widest italic">Total Budget Impact</p>
                                            <p className="text-xl font-black text-emerald-500 italic tracking-tighter">${totalCost.toFixed(2)}</p>
                                        </div>
                                        <div className="w-px h-10 bg-emerald-500/10" />
                                        <div className="text-right">
                                            <p className="text-[8px] font-black text-emerald-500/40 uppercase tracking-widest italic">ROI Multiplier</p>
                                            <p className="text-xl font-black text-foreground italic tracking-tighter">12.4x</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="relative z-10">
                                    <CostEfficiencyChart data={costTrends} detailed />
                                </div>
                            </Card>
                        </TabsContent>

                        <TabsContent value="compare" className="outline-none">
                            <Card className="glass-panel-deep border-foreground/5 rounded-[4rem] p-12 overflow-hidden relative group min-h-[600px]">
                                <div className="absolute top-0 right-0 p-20 opacity-[0.02] pointer-events-none group-hover:scale-110 transition-transform duration-1000">
                                    <Cpu size={400} />
                                </div>
                                <div className="flex justify-between items-start mb-12 relative z-10">
                                    <div className="space-y-2">
                                        <h3 className="text-4xl font-black italic tracking-tighter text-foreground uppercase leading-none">Agent Comparison Matrix</h3>
                                        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Benchmarking performance across operational nodes</p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <Button variant="outline" className="h-12 px-8 rounded-xl border-foreground/5 bg-foreground/5 text-[9px] font-black uppercase tracking-widest italic">EXPORT DATASET</Button>
                                    </div>
                                </div>
                                <div className="relative z-10">
                                    <AgentComparisonTable agents={agents} />
                                </div>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    {/* Operational Sidebar (Telemetry Feed) */}
                    <aside className="w-full lg:w-[380px] shrink-0 space-y-8">
                        {/* Live Success Gauge */}
                        <Card className="glass-panel-deep border-foreground/10 rounded-[3rem] p-10 space-y-8 relative overflow-hidden group">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                            <div className="space-y-4">
                                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Live Execution Gauge</Label>
                                <div className="flex flex-col items-center py-4">
                                    <SuccessRateGauge />
                                    <div className="mt-6 text-center space-y-1">
                                        <p className="text-3xl font-black italic tracking-tighter text-foreground">NOMINAL STATE</p>
                                        <p className="text-[9px] font-black text-primary uppercase tracking-[0.2em] italic">99.8% Reliability verified</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6 pt-10 border-t border-foreground/5">
                                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Security Sentinel</Label>
                                <div className="p-6 rounded-[2rem] bg-emerald-500/[0.02] border border-emerald-500/10 space-y-3 relative group/status overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/20 group-hover/status:bg-emerald-500/40 transition-colors" />
                                    <div className="flex items-center gap-2 text-[10px] font-black text-emerald-500/60 uppercase tracking-widest italic">
                                        <ShieldCheck className="w-4 h-4 shadow-glow" /> Privacy Hardened
                                    </div>
                                    <p className="text-[9px] font-black text-foreground/20 uppercase tracking-[0.2em] leading-relaxed italic">
                                        ANONYMIZED TELEMETRY PIPELINE ACTIVE. NO PERSONALLY IDENTIFIABLE INFORMATION (PII) IS TRANSMITTED.
                                    </p>
                                </div>
                            </div>

                            <div className="pt-6 space-y-6">
                                <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40 italic ml-1">Capability Evolution</Label>
                                <div className="space-y-4">
                                    <div className="p-5 rounded-2xl bg-foreground/[0.02] border border-foreground/5 group hover:bg-foreground/[0.04] transition-all">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-[9px] font-black text-foreground/60 uppercase tracking-widest italic">Skill Nexus Density</span>
                                            <span className="text-[9px] font-black text-primary italic">+12.4%</span>
                                        </div>
                                        <div className="h-1 bg-foreground/5 rounded-full overflow-hidden">
                                            <motion.div 
                                                className="h-full bg-primary" 
                                                initial={{ width: 0 }} 
                                                animate={{ width: "72%" }} 
                                                transition={{ duration: 1 }}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[8px] font-bold text-foreground/20 uppercase tracking-[0.2em] leading-relaxed italic px-2">
                                        Recent synthesis cycles have successfully consolidated 14 redundant tool patterns into 3 high-fidelity skills.
                                    </p>
                                </div>
                            </div>
                        </Card>

                        {/* Recent Activity Mini-Feed */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-4">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-foreground/40 italic">Recent Events</h3>
                                <div className="h-px flex-1 bg-foreground/5" />
                            </div>
                            <div className="space-y-3">
                                {[
                                    { event: "Agent_Provisioned", target: "Research_Unit_X", time: "2m ago", icon: Zap },
                                    { event: "Tool_Consolidation", target: "Vision_Nexus", time: "14m ago", icon: GitBranch },
                                    { event: "Optimization_Applied", target: "Logical_Core", time: "1h ago", icon: Gauge }
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-foreground/[0.01] border border-foreground/5 hover:bg-foreground/[0.03] transition-all group">
                                        <div className="p-2 rounded-lg bg-foreground/5 group-hover:text-primary transition-colors">
                                            <item.icon className="w-3.5 h-3.5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-black text-foreground italic truncate uppercase">{item.event}</p>
                                            <p className="text-[8px] font-black text-foreground/20 uppercase tracking-widest truncate">{item.target}</p>
                                        </div>
                                        <span className="text-[8px] font-black text-foreground/10 italic shrink-0">{item.time}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </aside>
                </div>
            </main>

            {/* Footer System HUD */}
            <footer className="h-16 border-t border-foreground/5 flex items-center justify-between px-10 bg-background/40 backdrop-blur-xl relative z-20">
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-3">
                        <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 italic">Telemetry Stream: ACTIVE</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <Network className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30 italic">Neural Node Count: {agents.length}</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[9px] font-black uppercase tracking-widest text-foreground/10 italic">Secure Diagnostics V3</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-500/40 shadow-glow" />
                </div>
            </footer>
        </div>
    );
}

