import type { NextApiRequest, NextApiResponse } from "next";

// ─── Type Definitions ─────────────────────────────────────────────────────────

interface KPIMetric {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  icon: "users" | "revenue" | "sessions" | "conversion";
}

interface TrendPoint {
  label: string;
  sessions: number;
  revenue: number;
}

interface ChannelBreakdown {
  name: string;
  visits: number;
  conversions: number;
}

interface TrafficSource {
  name: string;
  value: number;
  color: string;
}

interface MetricsResponse {
  metrics: KPIMetric[];
  trend: TrendPoint[];
  channels: ChannelBreakdown[];
  trafficSources: TrafficSource[];
}

// ─── Deterministic Data Generator ────────────────────────────────────────────

function seedVal(base: number, offset: number): number {
  return Math.abs(Math.sin(base * 9.301 + offset * 49.157 + 0.719));
}

function generateTrend(days: number): TrendPoint[] {
  const now = new Date();
  const isHourly = days === 1;
  const count = isHourly ? 24 : days;
  const points: TrendPoint[] = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    let label: string;
    let base: number;

    if (isHourly) {
      d.setHours(d.getHours() - (count - 1 - i));
      label = `${d.getHours().toString().padStart(2, "0")}:00`;
      base = d.getDate() * 100 + i;
    } else {
      d.setDate(d.getDate() - (count - 1 - i));
      label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      base = d.getDate() + d.getMonth() * 31;
    }

    const weekendFactor = (!isHourly && [0, 6].includes(d.getDay())) ? 0.65 : 1;
    points.push({
      label,
      sessions: Math.round((600 + seedVal(base, 1) * 1800 + Math.sin(i * 0.25) * 300) * weekendFactor),
      revenue: Math.round((1200 + seedVal(base, 2) * 4000 + Math.cos(i * 0.2) * 600) * weekendFactor),
    });
  }
  return points;
}

function pct(curr: number, prev: number): { delta: string; positive: boolean } {
  if (prev === 0) return { delta: "+0.0%", positive: true };
  const diff = ((curr - prev) / prev) * 100;
  return { delta: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`, positive: diff >= 0 };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default function handler(req: NextApiRequest, res: NextApiResponse<MetricsResponse | { error: string }>) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const rangeStr = (req.query.range as string) || "7d";
  const days = rangeStr === "24h" ? 1 : rangeStr === "30d" ? 30 : rangeStr === "90d" ? 90 : 7;

  const trend = generateTrend(days);
  const prevTrend = generateTrend(days).map((p) => ({
    ...p,
    sessions: Math.round(p.sessions * 0.88),
    revenue: Math.round(p.revenue * 0.91),
  }));

  const totalSessions = trend.reduce((s, p) => s + p.sessions, 0);
  const prevSessions = prevTrend.reduce((s, p) => s + p.sessions, 0);
  const totalRevenue = trend.reduce((s, p) => s + p.revenue, 0);
  const prevRevenue = prevTrend.reduce((s, p) => s + p.revenue, 0);
  const uniqueUsers = Math.round(totalSessions * 0.72);
  const prevUnique = Math.round(prevSessions * 0.72);
  const convRate = 2.4 + (totalSessions / 10000) * 0.6;
  const prevConv = 2.4 + (prevSessions / 10000) * 0.6;

  const metrics: KPIMetric[] = [
    { label: "Total Sessions", value: totalSessions.toLocaleString(), ...pct(totalSessions, prevSessions), icon: "sessions" },
    { label: "Unique Users", value: uniqueUsers.toLocaleString(), ...pct(uniqueUsers, prevUnique), icon: "users" },
    { label: "Revenue", value: `$${(totalRevenue / 1000).toFixed(1)}k`, ...pct(totalRevenue, prevRevenue), icon: "revenue" },
    { label: "Conversion Rate", value: `${convRate.toFixed(2)}%`, ...pct(convRate, prevConv), icon: "conversion" },
  ];

  const ref = trend[0];
  const channels: ChannelBreakdown[] = [
    { name: "Organic", visits: Math.round(ref.sessions * 2.1), conversions: Math.round(ref.sessions * 0.08) },
    { name: "Direct", visits: Math.round(ref.sessions * 1.4), conversions: Math.round(ref.sessions * 0.06) },
    { name: "Paid", visits: Math.round(ref.sessions * 0.9), conversions: Math.round(ref.sessions * 0.12) },
    { name: "Social", visits: Math.round(ref.sessions * 0.7), conversions: Math.round(ref.sessions * 0.04) },
    { name: "Email", visits: Math.round(ref.sessions * 0.5), conversions: Math.round(ref.sessions * 0.09) },
  ];

  const trafficSources: TrafficSource[] = [
    { name: "Organic Search", value: 38, color: "#6366f1" },
    { name: "Direct", value: 24, color: "#8b5cf6" },
    { name: "Paid Search", value: 18, color: "#06b6d4" },
    { name: "Social Media", value: 12, color: "#10b981" },
    { name: "Email", value: 8, color: "#f59e0b" },
  ];

  res.status(200).json({ metrics, trend, channels, trafficSources });
}
