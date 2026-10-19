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

export default function MetricGrid({ 
  metrics, 
  columns = 4,
  className 
}: MetricGridProps) {
  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  }[columns];

  return (
    <div className={cn("grid grid-cols-1 gap-4", gridCols, className)}>
      {metrics.map((metric, i) => {
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
              className="bg-white/5 border-white/5 hover:bg-white/10 transition-all duration-300"
            />
          </motion.div>
        );
      })}
    </div>
  );
}
