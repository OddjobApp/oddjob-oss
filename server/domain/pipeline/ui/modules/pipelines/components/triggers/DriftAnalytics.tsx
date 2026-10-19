import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { 
  TrendingUp, 
  AlertCircle, 
  ShieldCheck, 
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  Clock,
  Radar
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { format } from 'date-fns';

interface DriftAnalyticsProps {
  pipelineId: number;
}

export default function DriftAnalytics({ pipelineId }: DriftAnalyticsProps) {
  const { data: scores = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/pipelines/${pipelineId}/drift-scores`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pipelines/${pipelineId}/drift-scores`);
      return res.json();
    }
  });

  const { data: prediction } = useQuery<any>({
    queryKey: [`/api/pipelines/${pipelineId}/predictive-drift`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pipelines/${pipelineId}/predictive-drift`);
      return res.json();
    }
  });

  const avgDrift = scores.length > 0 
    ? (scores.reduce((acc, s) => acc + s.driftScore, 0) / scores.length * 100).toFixed(1)
    : "0.0";

  const lastDrift = scores.length > 0 
    ? (scores[scores.length - 1].driftScore * 100).toFixed(1)
    : "0.0";

  const chartData = [...scores.map(s => ({
    date: format(new Date(s.createdAt), 'MM/dd HH:mm'),
    score: parseFloat((s.driftScore * 100).toFixed(1)),
    threshold: 20
  }))];

  // Add projection point if increasing
  if (prediction?.isIncreasing && prediction?.runsUntilBreach && chartData.length > 0) {
     const lastPoint = chartData[chartData.length - 1];
     chartData.push({
        date: 'PROJECTION',
        score: 20, // The threshold we will hit
        threshold: 20,
        isProjection: true
     } as any);
  }

  if (isLoading) {
    return (
      <div className="h-[300px] flex items-center justify-center border border-cyan-500/10 rounded-lg bg-background/20">
        <div className="animate-pulse text-cyan-500/50 uppercase text-[10px] tracking-widest">Compiling Analytics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-mono">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-background/40 border-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.05)]">
          <CardContent className="p-4 pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Average Drift</span>
              <Activity className="w-4 h-4 text-cyan-500" />
            </div>
            <div className="text-3xl font-black text-foreground italic tracking-tighter">
              {avgDrift}%
            </div>
            <div className="flex items-center gap-1 mt-1 text-[9px] text-cyan-400/70">
              <TrendingUp className="w-3 h-3" />
              <span>STABLE BASELINE</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background/40 border-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.05)]">
          <CardContent className="p-4 pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Last Deviation</span>
              <Zap className="w-4 h-4 text-magenta-500" />
            </div>
            <div className="text-3xl font-black text-foreground italic tracking-tighter">
              {lastDrift}%
            </div>
            <div className="flex items-center gap-1 mt-1 text-[9px] text-magenta-400/70 uppercase">
              {parseFloat(lastDrift) > 20 ? (
                <><ArrowUpRight className="w-3 h-3" /> THRESHOLD BREACHED</>
              ) : (
                <><ShieldCheck className="w-3 h-3" /> WITHIN TOLERANCE</>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background/40 border-green-500/20 shadow-[0_0_15px_rgba(34,211,238,0.05)]">
          <CardContent className="p-4 pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Maintenance Window</span>
              <Clock className="w-4 h-4 text-green-500" />
            </div>
            <div className="text-3xl font-black text-foreground italic tracking-tighter">
              {prediction?.runsUntilBreach ? `${prediction.runsUntilBreach} RUNS` : 'STABLE'}
            </div>
            <div className="flex items-center gap-1 mt-1 text-[9px] text-green-400/70 uppercase">
              {prediction?.predictedBreachDate 
                ? `ETA: ${format(new Date(prediction.predictedBreachDate), 'MMM dd')}` 
                : 'NO BREACH DETECTED'}
            </div>
          </CardContent>
        </Card>
      </div>

      {prediction?.isIncreasing && (
        <div className="bg-red-500/5 border border-red-500/20 p-3 rounded flex items-center gap-4 animate-pulse">
           <div className="bg-red-500 p-2 rounded">
              <Radar className="w-4 h-4 text-foreground" />
           </div>
           <div>
              <div className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Predictive Drift Warning</div>
              <div className="text-[10px] text-red-400/70">Model degradation velocity suggests a critical threshold breach in approx. {prediction.runsUntilBreach} execution cycles.</div>
           </div>
        </div>
      )}

      <Card className="bg-background/60 border-muted-foreground/20 overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Deviation Trend (Gold Baseline Shift)
          </CardTitle>
          <CardDescription className="text-[10px] uppercase text-muted-foreground">Historical drift score mapped across execution cycles</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="driftGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="#666" 
                  fontSize={8} 
                  tickLine={false} 
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  stroke="#666" 
                  fontSize={8} 
                  tickLine={false} 
                  axisLine={false}
                  tickFormatter={(value) => `${value}%`}
                  domain={[0, 100]}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#000', border: '1px solid #22d3ee', fontSize: '10px', fontFamily: 'monospace' }}
                  itemStyle={{ color: '#22d3ee' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#22d3ee" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#driftGradient)"
                  strokeDasharray="0"
                />
                <Line 
                  type="monotone" 
                  dataKey="threshold" 
                  stroke="#ef4444" 
                  strokeDasharray="5 5" 
                  strokeWidth={1}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-4">
             <div className="flex items-center gap-2">
                <div className="w-3 h-1 bg-cyan-400" />
                <span className="text-[9px] text-muted-foreground uppercase">Observed Drift</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-3 h-1 border-t border-red-500 border-dashed" />
                <span className="text-[9px] text-muted-foreground uppercase">Critical Threshold (20%)</span>
             </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
