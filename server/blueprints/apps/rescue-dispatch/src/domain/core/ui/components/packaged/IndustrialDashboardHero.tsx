import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, ArrowUpRight, ArrowDownRight, Activity, Zap, Shield, Globe } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { StatCard } from '../ui/stat-card.js';
import { Badge } from '../ui/badge.js';

interface ChartData {
  name: string;
  value: number;
}

interface IndustrialDashboardHeroProps {
  title?: string;
  subtitle?: string;
  data?: ChartData[];
  stats?: {
    label: string;
    value: string;
    change: number;
    trend: 'up' | 'down';
    icon: 'activity' | 'zap' | 'shield' | 'globe';
  }[];
}

const defaultData = [
  { name: '00:00', value: 400 },
  { name: '04:00', value: 300 },
  { name: '08:00', value: 600 },
  { name: '12:00', value: 800 },
  { name: '16:00', value: 500 },
  { name: '20:00', value: 900 },
  { name: '23:59', value: 1100 },
];

const iconMap: Record<string, LucideIcon> = {
  activity: Activity,
  zap: Zap,
  shield: Shield,
  globe: Globe,
};

export default function IndustrialDashboardHero({
  title = "System Overview",
  subtitle = "Real-time industrial telemetry and mission status.",
  data = defaultData,
  stats = [
    { label: "Active Missions", value: "12", change: 8, trend: 'up', icon: 'activity' },
    { label: "Energy Flux", value: "847 kW", change: -2, trend: 'down', icon: 'zap' },
    { label: "Shield Integrity", value: "99.4%", change: 0.1, trend: 'up', icon: 'shield' },
  ]
}: IndustrialDashboardHeroProps) {
  return (
    <div className="space-y-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            <span className="relative flex h-2 w-2 mr-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live Telemetry
          </Badge>
          <Badge variant="outline" className="bg-white/5 text-white/70 border-white/10">
            v1.2.0-ghost
          </Badge>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <StatCard
              title={stat.label}
              value={stat.value}
              icon={iconMap[stat.icon]}
              trend={{ value: Math.abs(stat.change), label: 'vs last period', positive: stat.trend === 'up' }}
              className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
            />
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Card className="bg-black/40 border-white/10 backdrop-blur-xl overflow-hidden">
          <CardHeader className="border-b border-white/5 bg-white/5">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              Activity Flux
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    dataKey="name" 
                    stroke="rgba(255,255,255,0.3)" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="rgba(255,255,255,0.3)" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(10, 10, 15, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#6366f1" 
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                    strokeWidth={2}
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
