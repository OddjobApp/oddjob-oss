"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { TrendingUp, Users, Clock, DollarSign, AlertCircle } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

interface StatItem {
  id: string;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  icon?: string;
  description?: string;
  trend?: number; // percentage change
}

interface PlatformStatsCounterBlockProps {
  collection?: string;
  stats?: StatItem[];
  duration?: number; // animation duration in seconds
  variant?: "cards" | "simple" | "large";
  columns?: 2 | 3 | 4;
  valueField?: string;
  labelField?: string;
  prefixField?: string;
  suffixField?: string;
}

const defaultStats: StatItem[] = [
  { id: "1", label: "Active Users", value: 12500, suffix: "+", icon: "users", trend: 12 },
  { id: "2", label: "Revenue", value: 2.5, prefix: "$", suffix: "M", icon: "dollar", trend: 8 },
  { id: "3", label: "Projects", value: 850, suffix: "+", icon: "trending", trend: 24 },
  { id: "4", label: "Uptime", value: 99.9, suffix: "%", icon: "clock", trend: 0.1 },
];

const iconMap: Record<string, React.ReactNode> = {
  users: <Users className="w-6 h-6" />,
  dollar: <DollarSign className="w-6 h-6" />,
  trending: <TrendingUp className="w-6 h-6" />,
  clock: <Clock className="w-6 h-6" />,
};

function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  duration = 2,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (!isInView) return;

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      setDisplayValue(value * easeOutQuart);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration, isInView]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toFixed(num % 1 === 0 ? 0 : 1);
  };

  return (
    <span ref={ref}>
      {prefix}
      {formatNumber(displayValue)}
      {suffix}
    </span>
  );
}

export default function PlatformStatsCounterBlock({
  collection,
  stats: providedStats,
  duration = 2,
  variant = "cards",
  columns = 4,
  valueField = "value",
  labelField = "label",
  prefixField = "prefix",
  suffixField = "suffix",
}: PlatformStatsCounterBlockProps) {
  const [stats, setStats] = useState<StatItem[]>(providedStats || []);
  const [loading, setLoading] = useState(!providedStats && !!collection);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providedStats || !collection) {
      setLoading(false);
      return;
    }

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];

        const mapped: StatItem[] = records.map((record: any, idx: number) => ({
          id: record.id || `stat-${idx}`,
          label: record[labelField] || record.label || record.name || "Stat",
          value: parseFloat(record[valueField]) || 0,
          prefix: record[prefixField] || record.prefix,
          suffix: record[suffixField] || record.suffix,
          icon: record.icon,
          description: record.description,
          trend: record.trend,
        }));

        setStats(mapped.length > 0 ? mapped : defaultStats);
      } catch (e: any) {
        setError(e.message);
        setStats(defaultStats);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [collection, providedStats, valueField, labelField, prefixField, suffixField]);

  if (loading) {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-${columns} gap-4`}>
        {Array.from({ length: columns }).map((_, idx) => (
          <Skeleton key={idx} className="h-32" />
        ))}
      </div>
    );
  }

  const getTrendColor = (trend: number) => {
    if (trend > 0) return "text-green-500";
    if (trend < 0) return "text-red-500";
    return "text-gray-500";
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return "↑";
    if (trend < 0) return "↓";
    return "→";
  };

  if (variant === "simple") {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-${columns} gap-8 text-center`}>
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <div className="text-4xl md:text-5xl font-bold text-primary">
              <AnimatedNumber
                value={stat.value}
                prefix={stat.prefix}
                suffix={stat.suffix}
                duration={duration}
              />
            </div>
            <div className="text-muted-foreground mt-2">{stat.label}</div>
            {stat.trend !== undefined && (
              <div className={`text-sm mt-1 ${getTrendColor(stat.trend)}`}>
                {getTrendIcon(stat.trend)} {Math.abs(stat.trend)}%
              </div>
            )}
          </motion.div>
        ))}
      </div>
    );
  }

  if (variant === "large") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {stats.slice(0, 4).map((stat, idx) => (
          <motion.div
            key={stat.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.15 }}
          >
            <Card className="overflow-hidden">
              <CardContent className="p-8">
                <div className="flex items-center gap-4 mb-4">
                  {stat.icon && iconMap[stat.icon] && (
                    <div className="p-3 rounded-lg bg-primary/10 text-primary">
                      {iconMap[stat.icon]}
                    </div>
                  )}
                  {stat.trend !== undefined && (
                    <div className={`text-sm font-medium ${getTrendColor(stat.trend)}`}>
                      {getTrendIcon(stat.trend)} {Math.abs(stat.trend)}%
                    </div>
                  )}
                </div>
                <div className="text-5xl md:text-6xl font-bold">
                  <AnimatedNumber
                    value={stat.value}
                    prefix={stat.prefix}
                    suffix={stat.suffix}
                    duration={duration}
                  />
                </div>
                <div className="text-xl text-muted-foreground mt-2">{stat.label}</div>
                {stat.description && (
                  <p className="text-sm text-muted-foreground mt-4">{stat.description}</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    );
  }

  // Cards variant (default)
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns} gap-4`}>
      {stats.map((stat, idx) => (
        <motion.div
          key={stat.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1">
                    <AnimatedNumber
                      value={stat.value}
                      prefix={stat.prefix}
                      suffix={stat.suffix}
                      duration={duration}
                    />
                  </p>
                  {stat.trend !== undefined && (
                    <p className={`text-xs mt-1 ${getTrendColor(stat.trend)}`}>
                      {getTrendIcon(stat.trend)} {Math.abs(stat.trend)}% from last period
                    </p>
                  )}
                </div>
                {stat.icon && iconMap[stat.icon] && (
                  <div className="p-3 rounded-lg bg-primary/10 text-primary">
                    {iconMap[stat.icon]}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
