import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { TrendingUp, BarChart3, PieChart as PieIcon, Activity, Calendar } from "lucide-react";

interface DatasetRecord {
  id: string;
  [key: string]: any;
}

interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any;
}

const CHART_COLORS = ["#CD7F32", "#4B3D33", "#A68D7B", "#2D241E", "#8B6914", "#D4A574"];

interface PlatformDatasetChartBlockProps {
  collection: string;
  xField: string;
  yField: string;
  chartType?: "line" | "bar" | "area" | "pie";
  title?: string;
  color?: string;
  dateRangeFilter?: boolean;
  height?: string;
  aggregation?: "sum" | "count" | "avg" | "min" | "max";
}

export default function PlatformDatasetChartBlock({
  collection,
  xField,
  yField,
  chartType = "line",
  title = "Dataset Analytics",
  color = "#CD7F32",
  dateRangeFilter = false,
  height = "400px",
  aggregation = "sum",
}: PlatformDatasetChartBlockProps) {
  const [data, setData] = useState<DatasetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      // Set height directly. This used a --dynamic-height custom property read by
      // a .dynamic-height class that only exists in the platform stylesheet, so
      // inside a forged app the height fell back to auto and the block collapsed.
      containerRef.current.style.height = height;
    }
  }, [height]);
  const [activeType, setActiveType] = useState(chartType);

  useEffect(() => {
    fetchData();
  }, [collection, dateRange]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let url = `/api/oddjob/datasets/${collection}/records`;
      if (dateRangeFilter && dateRange !== "all") {
        const days = parseInt(dateRange);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        url += `?since=${since}`;
      }
      
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData(result.records ?? result.data ?? result ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load dataset");
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!data.length) return [];

    // For pie charts, aggregate by xField and sum yField
    if (activeType === "pie") {
      const grouped = data.reduce((acc, record) => {
        const key = String(record[xField] ?? "Unknown");
        const val = parseFloat(record[yField]) || 0;
        acc[key] = (acc[key] || 0) + val;
        return acc;
      }, {} as Record<string, number>);

      return Object.entries(grouped)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    }

    // For other charts, format data points
    return data.map(record => ({
      name: formatXValue(record[xField]),
      value: parseFloat(record[yField]) || 0,
      raw: record,
    })).slice(0, 100);
  }, [data, xField, yField, activeType]);

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const values = chartData.map(d => d.value);
    const total = values.reduce((a, b) => a + b, 0);
    const avg = total / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    return { total, avg: Math.round(avg * 100) / 100, max, min, count: values.length };
  }, [chartData]);

  const formatXValue = (val: any): string => {
    if (val === null || val === undefined) return "—";
    if (val instanceof Date || (typeof val === "string" && !isNaN(Date.parse(val)))) {
      return new Date(val).toLocaleDateString();
    }
    return String(val);
  };

  const formatYValue = (val: number): string => {
    if (val >= 1000000) return (val / 1000000).toFixed(1) + "M";
    if (val >= 1000) return (val / 1000).toFixed(1) + "K";
    return val.toLocaleString();
  };

  const renderChart = (): React.ReactElement | null => {
    const commonProps = {
      data: chartData,
      margin: { top: 10, right: 30, left: 0, bottom: 0 },
    };

    switch (activeType) {
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} />
            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickFormatter={formatYValue} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
              itemStyle={{ color: "#fff" }}
              formatter={(value: number) => [formatYValue(value), yField]}
            />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ fill: color, r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        );
      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} />
            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickFormatter={formatYValue} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
              itemStyle={{ color: "#fff" }}
              formatter={(value: number) => [formatYValue(value), yField]}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        );
      case "area":
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} />
            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickFormatter={formatYValue} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
              itemStyle={{ color: "#fff" }}
              formatter={(value: number) => [formatYValue(value), yField]}
            />
            <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.3} />
          </AreaChart>
        );
      case "pie":
        return (
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
              itemStyle={{ color: "#fff" }}
              formatter={(value: number, name: string) => [formatYValue(value), name]}
            />
            <Legend verticalAlign="bottom" height={36} iconType="circle" />
          </PieChart>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-xl font-bold text-foreground">{title}</CardTitle>
          {stats && (
            <Badge variant="outline" className="bg-foreground/5 text-foreground/60 border-foreground/10">
              {stats.count.toLocaleString()} records
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dateRangeFilter && (
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
              <SelectTrigger className="w-32 bg-foreground/5 border-foreground/10 text-foreground text-xs">
                <Calendar className="w-3 h-3 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-foreground/10">
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="flex bg-foreground/5 rounded-lg p-1 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${activeType === "line" ? "bg-foreground/10 text-foreground" : "text-foreground/40"}`}
              onClick={() => setActiveType("line")}
            >
              <Activity className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${activeType === "bar" ? "bg-foreground/10 text-foreground" : "text-foreground/40"}`}
              onClick={() => setActiveType("bar")}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${activeType === "area" ? "bg-foreground/10 text-foreground" : "text-foreground/40"}`}
              onClick={() => setActiveType("area")}
            >
              <TrendingUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${activeType === "pie" ? "bg-foreground/10 text-foreground" : "text-foreground/40"}`}
              onClick={() => setActiveType("pie")}
            >
              <PieIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48 bg-foreground/5" />
            <Skeleton className="h-[300px] w-full bg-foreground/5" />
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-foreground/30">
            No data available for {collection}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            {stats && (
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-3 rounded-lg bg-foreground/5">
                  <p className="text-xs text-foreground/40 uppercase tracking-wider">Total</p>
                  <p className="text-lg font-bold text-foreground">{formatYValue(stats.total)}</p>
                </div>
                <div className="p-3 rounded-lg bg-foreground/5">
                  <p className="text-xs text-foreground/40 uppercase tracking-wider">Average</p>
                  <p className="text-lg font-bold text-foreground">{formatYValue(stats.avg)}</p>
                </div>
                <div className="p-3 rounded-lg bg-foreground/5">
                  <p className="text-xs text-foreground/40 uppercase tracking-wider">Max</p>
                  <p className="text-lg font-bold text-foreground">{formatYValue(stats.max)}</p>
                </div>
                <div className="p-3 rounded-lg bg-foreground/5">
                  <p className="text-xs text-foreground/40 uppercase tracking-wider">Min</p>
                  <p className="text-lg font-bold text-foreground">{formatYValue(stats.min)}</p>
                </div>
              </div>
            )}
            <div ref={containerRef}>
              <ResponsiveContainer width="100%" height="100%">
                {renderChart() || <div />}
              </ResponsiveContainer>
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
