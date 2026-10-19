import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, Activity, Zap, Shield, Target, Users, TrendingUp } from 'lucide-react';
import { StatCard } from '../ui/stat-card.js';
import { cn } from '@/lib/utils';

interface Metric {
  label: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
  iconName?: string;
  color?: string;
}

interface MetricGridProps {
  metrics: Metric[];
  columns?: 2 | 3 | 4;
  className?: string;
}

const ICON_MAP: Record<string, LucideIcon> = {
  activity: Activity,
  zap: Zap,
  shield: Shield,
  target: Target,
  users: Users,
  trending: TrendingUp,
};

const DEFAULT_METRICS: Metric[] = [
  { label: "Status", value: "Optimal", trend: "up" },
  { label: "Throughput", value: "1.2k/s", trend: "up" },
  { label: "Latency", value: "18ms", trend: "down" },
  { label: "Health", value: "100%", trend: "neutral" },
];

export default function MetricGrid({
  metrics = DEFAULT_METRICS,
  columns = 4,
  className
}: MetricGridProps) {
  const safeMetrics = Array.isArray(metrics) && metrics.length > 0 ? metrics : DEFAULT_METRICS;
  // Container-responsive: auto-fit cards at a readable min width instead of
  // viewport breakpoints (md:grid-cols-N), which crammed/clipped cards inside the
  // narrow copilot sheet. Each card is >= 9rem, so the grid drops to fewer columns
  // (down to 1) as the container narrows — no clipping, no truncated labels.
  return (
    <div className={cn("grid gap-3 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]", className)}>
      {safeMetrics.map((metric, i) => {
        const Icon = ICON_MAP[metric.iconName || 'activity'] || Activity;
        
        return (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
          >
            <StatCard
              title={metric.label}
              value={metric.value}
              icon={Icon}
              trend={metric.change !== undefined ? { value: metric.change, label: metric.trend || 'change', positive: metric.trend === 'up' } : undefined}
              className="min-w-0 bg-muted/40 border-border hover:bg-muted/60 transition-all duration-300"
            />
          </motion.div>
        );
      })}
    </div>
  );
}
