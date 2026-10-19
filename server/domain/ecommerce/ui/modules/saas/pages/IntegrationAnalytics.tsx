import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  Zap,
  RefreshCw,
  Calendar,
  Download,
  ShieldCheck,
  Cpu,
  Network,
  LayoutDashboard,
  Workflow
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import styles from "./IntegrationAnalytics.module.css";

interface AnalyticsData {
  total_connectors: number;
  connected_count: number;
  error_count: number;
  platforms: string[];
  overall_health: string;
  advanced_features: {
    bidirectional_syncs_enabled: number;
    event_workflows_configured: number;
    active_sync_tasks: number;
  };
}

interface ConnectorMetrics {
  platform: string;
  status: string;
  last_sync?: string;
  error_count: number;
  records_processed: number;
  avg_response_time: number;
  uptime_percentage: number;
}

interface SyncMetrics {
  platform: string;
  total_syncs: number;
  successful_syncs: number;
  failed_syncs: number;
  avg_sync_duration: number;
  last_sync_time?: string;
}

interface WorkflowMetrics {
  platform: string;
  total_workflows: number;
  active_workflows: number;
  executions_today: number;
  success_rate: number;
  avg_execution_time: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/90 border border-foreground/10 backdrop-blur-xl p-4 rounded-xl shadow-2xl">
        <p className="text-[10px] font-black uppercase tracking-widest text-foreground/40 mb-2 italic">{label}</p>
        <div className="space-y-1">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-8">
              <span className="text-[11px] font-bold uppercase tracking-tight text-foreground flex items-center gap-2">
                <motion.div 
                  className={cn("w-1.5 h-1.5 rounded-full", styles.dynamicBg)} 
                  animate={{ backgroundColor: entry.color }}
                  transition={{ duration: 0.3 }}
                />
                {entry.name}
              </span>
              <span className="text-[11px] font-black text-foreground font-mono">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function IntegrationAnalytics() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("24h");

  // Fetch analytics overview
  const { data: analytics, isLoading: analyticsLoading, refetch: refetchAnalytics } = useQuery<AnalyticsData>({
    queryKey: ['/api/analytics/saas/overview'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/saas/overview');
      if (!res.ok) throw new Error('Failed to fetch analytics overview');
      return res.json();
    },
  });

  // Fetch connector metrics
  const { data: realConnectorMetrics, isLoading: metricsLoading } = useQuery<ConnectorMetrics[]>({
    queryKey: ['/api/analytics/saas/metrics'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/saas/metrics');
      if (!res.ok) return [];
      return res.json();
    }
  });

  const connectorMetrics = realConnectorMetrics || [];

  /*
    These rows used to mix real and invented fields. `platform`, `error_count`
    and `last_sync` came from the API; total_syncs, successful_syncs and
    avg_sync_duration were random, and failed_syncs fell back to a random number
    whenever the real error count was zero. Sharing a row with genuine fields is
    what made the invented ones credible.

    Only measured fields are carried through now. A sync count is shown as 0
    rather than guessed, because there is no telemetry behind it.
  */
  const syncMetrics: SyncMetrics[] = connectorMetrics.map(m => ({
    platform: m.platform,
    total_syncs: 0,
    successful_syncs: 0,
    failed_syncs: m.error_count ?? 0,
    avg_sync_duration: 0,
    last_sync_time: m.last_sync
  }));

  /*
    Two hardcoded platform rows stood here — jira with 5 workflows and a 0.96
    success rate, slack with 3 and 0.99 — presented as this organisation's
    figures. No endpoint supplies workflow telemetry, so the list is empty.
  */
  const workflowMetrics: WorkflowMetrics[] = [];

  /*
    generateTimeSeriesData produced a week of per-platform sync and error counts
    entirely from Math.random(), redrawn on every render. The chart below now
    renders empty axes until a real series exists, which reads as "no data"
    rather than as a quiet week.
  */
  const generateTimeSeriesData = (_days: number = 7): Array<Record<string, unknown>> => [];

  const timeSeriesData = generateTimeSeriesData(7);

  const COLORS = {
    jira: '#3B82F6', // Blue-500
    slack: '#A855F7', // Purple-500
    github: '#F8FAFC', // Slate-50
    success: '#10B981', // Emerald-500
    error: '#F43F5E', // Rose-500
    warning: '#F59E0B', // Amber-500
    primary: '#10B981',
  };

  const syncSuccessData = syncMetrics.map(metric => ({
    platform: metric.platform,
    success: metric.successful_syncs,
    failed: metric.failed_syncs,
    success_rate: Math.round((metric.successful_syncs / metric.total_syncs) * 100)
  }));

  const uptimeData = connectorMetrics.map(metric => ({
    platform: metric.platform,
    uptime: metric.uptime_percentage,
    downtime: 100 - metric.uptime_percentage
  }));

  const responseTimeData = connectorMetrics.map(metric => ({
    platform: metric.platform,
    response_time: metric.avg_response_time
  }));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-rose-500" />;
      case 'connecting':
        return <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />;
      default:
        return <Clock className="w-4 h-4 text-foreground/40" />;
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy':
        return 'text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]';
      case 'degraded':
        return 'text-amber-500';
      case 'critical':
        return 'text-rose-500';
      default:
        return 'text-foreground/40';
    }
  };

  const filteredConnectorMetrics = selectedPlatform === 'all'
    ? connectorMetrics
    : connectorMetrics.filter(m => m.platform === selectedPlatform);

  const filteredSyncMetrics = selectedPlatform === 'all'
    ? syncMetrics
    : syncMetrics.filter(m => m.platform === selectedPlatform);

  const filteredWorkflowMetrics = selectedPlatform === 'all'
    ? workflowMetrics
    : workflowMetrics.filter(m => m.platform === selectedPlatform);

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30">
      {/* Cinematic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 cinematic-grid opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
      </div>

      <main className="container mx-auto py-12 px-6 space-y-12 max-w-7xl relative z-10">
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8"
        >
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black tracking-[0.3em] uppercase italic">
              <Activity className="w-4 h-4 shadow-[0_0_10px_rgba(var(--primary),0.5)]" />
              Systems Telemetry v9.4
            </div>
            <div className="space-y-2">
              <h1 className="text-6xl font-black tracking-tighter leading-none italic uppercase text-foreground">
                Integration <span className="text-primary font-light not-italic tracking-[-0.05em]">Analytics HUD</span>
              </h1>
              <p className="text-lg text-muted-foreground font-medium tracking-tight max-w-xl leading-relaxed">
                 Real-time diagnostics and performance monitoring for high-fidelity integration uplinks.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="h-14 w-40 bg-foreground/[0.03] border-foreground/10 rounded-2xl px-6 text-[10px] font-black uppercase tracking-widest italic transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-xl rounded-xl">
                <SelectItem value="1h">LAST HOUR</SelectItem>
                <SelectItem value="24h">LAST 24 HOURS</SelectItem>
                <SelectItem value="7d">LAST 7 DAYS</SelectItem>
                <SelectItem value="30d">LAST 30 DAYS</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-14 w-14 rounded-2xl bg-foreground/[0.03] border border-foreground/10 hover:bg-foreground/10 transition-all text-foreground/60">
              <Download className="w-5 h-5" />
            </Button>
            <Button 
               onClick={() => refetchAnalytics()}
               className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/10 transition-all active:scale-95 flex items-center gap-3"
            >
              <RefreshCw className={cn("w-4 h-4", analyticsLoading && "animate-spin")} />
              Refresh Feed
            </Button>
          </div>
        </motion.div>

        {/* Global Filter */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.1 }}
        >
          <Card className="glass-panel-deep border-foreground/10 rounded-[2rem] p-6 relative overflow-hidden group">
            <div className="flex items-center gap-4 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                <Network className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 mb-1 italic">Target Bridge Filter</div>
                <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                  <SelectTrigger className="bg-transparent border-none p-0 h-auto text-xl font-black italic uppercase tracking-tighter text-foreground focus:ring-0 shadow-none">
                    <SelectValue placeholder="ALL PLATFORMS" />
                  </SelectTrigger>
                  <SelectContent className="bg-background/95 border-foreground/10 backdrop-blur-3xl rounded-xl p-2">
                    <SelectItem value="all" className="rounded-lg px-4 py-2 text-[11px] font-black uppercase italic tracking-widest">Global Aggregate</SelectItem>
                    {analytics?.platforms.map((platform) => (
                      <SelectItem key={platform} value={platform} className="rounded-lg px-4 py-2 text-[11px] font-black uppercase italic tracking-widest">
                        {platform}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-5">
              <LayoutDashboard className="w-24 h-24" />
            </div>
          </Card>
        </motion.div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="bg-foreground/[0.03] border border-foreground/10 p-1.5 rounded-2xl backdrop-blur-xl inline-flex">
            <TabsTrigger value="overview" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Overview</TabsTrigger>
            <TabsTrigger value="connectors" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Platform Nodes</TabsTrigger>
            <TabsTrigger value="syncs" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Sync Performance</TabsTrigger>
            <TabsTrigger value="workflows" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all">Neural Workflows</TabsTrigger>
            <TabsTrigger value="errors" className="data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-all text-rose-500">Event Log</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8">
            {analyticsLoading ? (
              <div className="py-32 flex flex-col items-center justify-center space-y-4">
                <RefreshCw className="w-10 h-10 text-primary opacity-20 animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Calibrating Diagnostic Sensors...</span>
              </div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                {/* Visual Header HUD */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: 'System_Vitality', val: analytics?.overall_health, icon: Activity, detail: 'Operational Consistency', color: getHealthColor(analytics?.overall_health || 'unknown') },
                    { label: 'Active_Nodes', val: `${analytics?.connected_count}/${analytics?.total_connectors}`, icon: Network, detail: 'Platform Connectivity', color: 'text-foreground' },
                    { label: 'Current_Throughput', val: analytics?.advanced_features.active_sync_tasks, icon: Zap, detail: 'Active Sync Operations', color: 'text-primary' },
                    { label: 'Diagnostic_Alerts', val: analytics?.error_count, icon: AlertTriangle, detail: 'Recent Edge Failures', color: analytics?.error_count ?? 0 > 0 ? 'text-rose-500' : 'text-foreground/40' },
                  ].map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                    >
                      <Card className="glass-panel-deep border-foreground/10 rounded-3xl overflow-hidden relative group p-6">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="flex items-center justify-between mb-4">
                          <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic">{stat.label}</div>
                          <stat.icon className={cn("w-4 h-4 transition-transform group-hover:scale-110", stat.color)} />
                        </div>
                        <div className={cn("text-3xl font-black italic tracking-tighter uppercase", stat.color)}>
                          {stat.val}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/20 mt-1">{stat.detail}</div>
                      </Card>
                    </motion.div>
                  ))}
                </div>

                {/* Main Activity Chart */}
                <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden">
                  <CardHeader className="p-8 border-b border-foreground/5 bg-foreground/[0.01] flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-2xl font-black italic tracking-tighter uppercase text-foreground">Neural Bridge Activity</CardTitle>
                      <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic pt-1">Synchronous operation metrics and event propagation trends.</CardDescription>
                    </div>
                    <div className="flex gap-4">
                       <div className="flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-emerald-500" />
                         <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">Success</span>
                       </div>
                       <div className="flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-rose-500" />
                         <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">Failure</span>
                       </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8">
                    <ResponsiveContainer width="100%" height={350}>
                      <AreaChart data={timeSeriesData}>
                        <defs>
                          <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COLORS.success} stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.error} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COLORS.error} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                        <XAxis 
                          dataKey="date" 
                          stroke="rgba(255,255,255,0.2)" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          tick={{ fill: 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}
                        />
                        <YAxis 
                          stroke="rgba(255,255,255,0.2)" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          tick={{ fill: 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(16,185,129,0.3)', strokeWidth: 2 }} />
                        <Area
                          type="monotone"
                          dataKey="total_success"
                          stroke={COLORS.success}
                          strokeWidth={3}
                          fillOpacity={1}
                          fill="url(#successGradient)"
                          name="SUCCESS_SYNCS"
                          animationDuration={2000}
                        />
                        <Area
                          type="monotone"
                          dataKey="total_errors"
                          stroke={COLORS.error}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#errorGradient)"
                          name="FAILED_SYNCS"
                          animationDuration={2000}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Sub-Diagnostics */}
                <div className="grid gap-6 md:grid-cols-3">
                    {[
                       { label: 'Bidirectional_Links', val: analytics?.advanced_features.bidirectional_syncs_enabled, icon: RefreshCw, sub: 'Active Channels', color: 'text-blue-500' },
                       { label: 'Reactive_Pathways', val: analytics?.advanced_features.event_workflows_configured, icon: Workflow, sub: 'Neural Workflows', color: 'text-emerald-500' },
                       { label: 'IO_Operations', val: analytics?.advanced_features.active_sync_tasks, icon: Cpu, sub: 'Current Tasks', color: 'text-purple-500' },
                    ].map((feat, i) => (
                      <motion.div key={feat.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 + i * 0.1 }}>
                        <div className="glass-panel-deep border border-foreground/10 rounded-3xl p-6 flex items-center justify-between group">
                          <div className="space-y-1">
                            <div className="text-[9px] font-black uppercase tracking-widest text-foreground/20 italic">{feat.label}</div>
                            <div className={cn("text-4xl font-black italic tracking-tighter uppercase leading-none", feat.color)}>{feat.val}</div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/40 italic">{feat.sub}</div>
                          </div>
                          <feat.icon className={cn("w-10 h-10 opacity-20 group-hover:opacity-40 group-hover:scale-110 transition-all", feat.color)} />
                        </div>
                      </motion.div>
                    ))}
                </div>
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="connectors" className="space-y-8">
            <div className="grid gap-8 lg:grid-cols-2">
              <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem]">
                <CardHeader className="p-8">
                  <CardTitle className="text-xl font-black italic uppercase tracking-widest text-foreground">Node Uptime Analytics</CardTitle>
                </CardHeader>
                <CardContent className="px-8 pb-8">
                  <ResponsiveContainer width="100%" height={250}>
                    <RechartsBarChart data={uptimeData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="platform" stroke="rgba(255,255,255,0.4)" fontSize={10} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.4)" fontSize={10} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="uptime" fill={COLORS.success} radius={[4, 4, 0, 0]} name="UPTIME_%" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem]">
                <CardHeader className="p-8">
                  <CardTitle className="text-xl font-black italic uppercase tracking-widest text-foreground">Signal Latency HUD</CardTitle>
                </CardHeader>
                <CardContent className="px-8 pb-8">
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={responseTimeData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="platform" stroke="rgba(255,255,255,0.4)" fontSize={10} axisLine={false} tickLine={false} />
                      <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="response_time" stroke={COLORS.jira} strokeWidth={3} dot={{ r: 4, fill: COLORS.jira, strokeWidth: 2, stroke: '#000' }} name="LATENCY_MS" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6">
              {filteredConnectorMetrics.map((metric, i) => (
                <motion.div key={metric.platform} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}>
                  <Card className="glass-panel-deep border-foreground/10 rounded-3xl overflow-hidden group hover:border-primary/30 transition-all p-8">
                     <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
                        <div className="flex items-center gap-6">
                           <div className="w-16 h-16 rounded-2xl bg-foreground/[0.03] border border-foreground/10 flex items-center justify-center group-hover:border-primary/20 transition-all shadow-xl shadow-black/40">
                              <Cpu className="w-8 h-8 text-primary/60 group-hover:text-primary transition-colors" />
                           </div>
                           <div className="space-y-1">
                              <h3 className="text-3xl font-black italic uppercase tracking-tighter text-foreground group-hover:text-primary transition-colors">{metric.platform}</h3>
                              <div className="flex items-center gap-2">
                                {getStatusIcon(metric.status)}
                                <span className={cn("text-[10px] font-black uppercase tracking-widest italic", metric.status === 'connected' ? 'text-emerald-400' : 'text-rose-500')}>
                                  Node_{metric.status.toUpperCase()}
                                </span>
                              </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 flex-1 w-full lg:w-auto">
                           <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 mb-1 italic">Vitals Processed</div>
                              <div className="text-2xl font-black italic text-foreground flex items-center gap-2">
                                {metric.records_processed.toLocaleString()}
                                <TrendingUp className="w-4 h-4 text-emerald-500" />
                              </div>
                           </div>
                           <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 mb-1 italic">Latency Avg</div>
                              <div className="text-2xl font-black italic text-foreground">{metric.avg_response_time}ms</div>
                           </div>
                           <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 mb-1 italic">Integrity Pulse</div>
                              <div className="text-2xl font-black italic text-emerald-500">{metric.uptime_percentage}%</div>
                           </div>
                           <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-foreground/40 mb-1 italic">Last Handshake</div>
                              <div className="text-[11px] font-bold text-foreground/60 uppercase">{metric.last_sync ? new Date(metric.last_sync).toLocaleTimeString() : 'PERSISTENT'}</div>
                           </div>
                        </div>
                     </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="syncs" className="space-y-8 text-center py-24 glass-panel-deep border-foreground/10 rounded-[3rem] border-2 border-dashed">
             <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center border border-primary/20 animate-pulse mx-auto mb-8">
                <RefreshCw className="w-10 h-10 text-primary/40" />
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl font-black italic tracking-tighter uppercase text-foreground">Full Performance Audit Pending</h3>
                <p className="text-foreground/40 text-[10px] font-black uppercase tracking-widest italic max-w-sm mx-auto">Initiate a global sync cycle to generate high-fidelity performance metrics.</p>
              </div>
          </TabsContent>

          <TabsContent value="workflows" className="space-y-8">
            <div className="grid gap-6">
              {filteredWorkflowMetrics.map((metric, i) => (
                <motion.div key={metric.platform} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                  <Card className="glass-panel-deep border-foreground/10 rounded-3xl p-8 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-8 opacity-5">
                       <Workflow className="w-24 h-24" />
                     </div>
                     <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
                        <div className="flex items-center gap-6">
                           <div className="w-16 h-16 rounded-2xl bg-foreground/[0.03] border border-foreground/10 flex items-center justify-center text-primary/60">
                             <Activity className="w-8 h-8" />
                           </div>
                           <div className="space-y-1">
                             <h3 className="text-2xl font-black italic uppercase tracking-tighter text-foreground">{metric.platform} Workflow Array</h3>
                             <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/20 italic">Reactive Pathway Execution Analytics</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 flex-1">
                           <div className="text-center">
                              <div className="text-3xl font-black italic text-foreground">{metric.executions_today}</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-foreground/40 mt-1">Executions</div>
                           </div>
                           <div className="text-center">
                              <div className="text-3xl font-black italic text-emerald-500">{Math.round(metric.success_rate * 100)}%</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-emerald-500/40 mt-1">Success Rate</div>
                           </div>
                           <div className="text-center">
                              <div className="text-3xl font-black italic text-blue-500">{metric.avg_execution_time}s</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-blue-500/40 mt-1">Latency Avg</div>
                           </div>
                           <div className="text-center">
                              <div className="text-3xl font-black italic text-foreground/40">{metric.total_workflows}</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-foreground/20 mt-1">Protocols</div>
                           </div>
                        </div>
                     </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="errors" className="space-y-8">
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden">
               <CardHeader className="p-8 border-b border-foreground/5 bg-rose-500/[0.01]">
                  <CardTitle className="text-2xl font-black italic uppercase tracking-tighter text-rose-500">Security & Event Diagnostics</CardTitle>
                  <CardDescription className="text-[10px] uppercase font-black tracking-widest text-foreground/20 italic pt-1">Real-time edge failure recording and signal disruption analysis.</CardDescription>
               </CardHeader>
               <CardContent className="p-12 text-center flex flex-col items-center justify-center space-y-4">
                  <div className="w-20 h-20 rounded-3xl bg-rose-500/5 border border-rose-500/10 flex items-center justify-center mb-4">
                    <ShieldCheck className="w-10 h-10 text-emerald-500 opacity-20" />
                  </div>
                  <h4 className="text-xl font-black italic uppercase tracking-tighter text-foreground">No Signal Disruptions Detected</h4>
                  <p className="text-[10px] font-black uppercase tracking-widest italic text-foreground/40 max-w-sm">All integration nodes are reporting nominal throughput. Grid integrity is at 100%.</p>
               </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
