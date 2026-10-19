import React from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
} from 'recharts';

export const DEFAULT_CHART_COLORS = [
  'hsl(var(--chart-1, 243 75% 59%))',
  'hsl(var(--chart-2, 160 84% 39%))',
  'hsl(var(--chart-3, 38 92% 50%))',
  'hsl(var(--chart-4, 0 84% 60%))',
  'hsl(var(--chart-5, 199 89% 48%))',
  'hsl(262 83% 58%)',
  'hsl(24 95% 53%)',
];

export interface TurnAssistantChartCardProps {
  payload: Record<string, any>;
}

export function TurnAssistantChartCard({ payload: p }: TurnAssistantChartCardProps) {
  const COLORS = (p.colors as string[] | undefined)?.length
    ? (p.colors as string[])
    : DEFAULT_CHART_COLORS;
  const chartData = (p.data as any[]).map((d: any) => ({ name: d.label, value: d.value }));
  const ct = (p.chartType as string) || 'bar';

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card p-3.5" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="mb-2.5 border-b border-border/40 pb-2">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <ResponsiveContainer width="100%" height={240}>
        {ct === 'pie' ? (
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
              {chartData.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
            </Pie>
            <RechartsTooltip />
            <RechartsLegend />
          </PieChart>
        ) : ct === 'line' ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} label={p.xAxis ? { value: p.xAxis as string, position: 'insideBottom', offset: -4, fontSize: 11 } : undefined} />
            <YAxis tick={{ fontSize: 11 }} label={p.yAxis ? { value: p.yAxis as string, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined} />
            <RechartsTooltip />
            <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        ) : ct === 'area' ? (
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <RechartsTooltip />
            <Area type="monotone" dataKey="value" stroke={COLORS[0]} fill={COLORS[0] + '33'} strokeWidth={2} />
          </AreaChart>
        ) : ct === 'scatter' ? (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="x" name={(p.xAxis as string) || 'x'} tick={{ fontSize: 11 }} label={p.xAxis ? { value: p.xAxis as string, position: 'insideBottom', offset: -4, fontSize: 11 } : undefined} />
            <YAxis dataKey="y" name={(p.yAxis as string) || 'y'} tick={{ fontSize: 11 }} label={p.yAxis ? { value: p.yAxis as string, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined} />
            <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} formatter={(val: any, name: any, props: any) => [val, props?.payload?.label || name]} />
            <Scatter name={(p.title as string) || 'Data'} data={(p.data as any[]).map((d: any) => ({ x: d.x ?? d.value ?? 0, y: d.y ?? 0, label: d.label }))} fill={COLORS[0]} />
          </ScatterChart>
        ) : (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} label={p.xAxis ? { value: p.xAxis as string, position: 'insideBottom', offset: -4, fontSize: 11 } : undefined} />
            <YAxis tick={{ fontSize: 11 }} label={p.yAxis ? { value: p.yAxis as string, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined} />
            <RechartsTooltip />
            <Bar dataKey="value" radius={[4,4,0,0]}>
              {chartData.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
