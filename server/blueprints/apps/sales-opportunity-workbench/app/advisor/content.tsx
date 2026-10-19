"use client";

import React, { useEffect, useState } from 'react';
import { MessageSquare, TrendingUp, Target, Users, BookOpen, Sparkles, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  records,
  knowledge,
  SalesCollections,
  fmtCurrency,
  type Opportunity,
  type Forecast,
} from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";

const GREETING = `Hi - I'm your AI Sales Advisor. I answer using your actual pipeline data: opportunities, forecasts, and engagement history. I never invent figures.

Try asking:
- "What's my weighted pipeline value for this quarter?"
- "Which deals are at risk of slipping?"
- "What's my forecast vs quota attainment?"
- "Which opportunities need immediate attention?"`;

interface PipelineSnapshot {
  total: number;
  weighted: number;
  committed: number;
  count: number;
}

export default function AdvisorContent() {
  const [pipeline, setPipeline] = useState<PipelineSnapshot | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [knowledgeResults, setKnowledgeResults] = useState<Array<{ content: string; score: number; source: string }>>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [insights, setInsights] = useState<Array<{ type: string; title: string; description: string; severity: 'high' | 'medium' | 'low' }>>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opps, forecasts] = await Promise.all([
          records.list(SalesCollections.opportunities),
          records.list(SalesCollections.forecasts),
        ]);
        if (cancelled) return;

        // Calculate pipeline snapshot
        const openOpps = (opps as Opportunity[]).filter(o => !o.outcome || o.outcome === null);
        const total = openOpps.reduce((sum, o) => sum + (o.amount || 0), 0);
        const weighted = openOpps.reduce((sum, o) => {
          const stageWeight = { PROSPECT: 0.2, QUALIFIED: 0.5, PROPOSAL: 0.7, NEGOTIATION: 0.9 };
          return sum + (o.amount || 0) * (stageWeight[o.stage as keyof typeof stageWeight] || 0.5);
        }, 0);
        const committed = openOpps.reduce((sum, o) => {
          const stageWeight = { PROSPECT: 0.1, QUALIFIED: 0.3, PROPOSAL: 0.6, NEGOTIATION: 0.8 };
          return sum + (o.amount || 0) * (stageWeight[o.stage as keyof typeof stageWeight] || 0.3);
        }, 0);

        setPipeline({ total: Math.round(total), weighted: Math.round(weighted), committed: Math.round(committed), count: openOpps.length });
        
        // Get latest forecast
        const sortedForecasts = (forecasts as Forecast[]).sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
        setForecast(sortedForecasts[0] || null);

        // Generate insights from pipeline data
        const generatedInsights = generatePipelineInsights(openOpps as Opportunity[], { total, weighted, committed, count: openOpps.length });
        setInsights(generatedInsights);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Generate insights based on pipeline analysis
  const generatePipelineInsights = (opps: Opportunity[], snapshot: PipelineSnapshot) => {
    const insights: Array<{ type: string; title: string; description: string; severity: 'high' | 'medium' | 'low' }> = [];

    // Check for stalled deals (no recent activity)
    const stalledDeals = opps.filter(o => {
      const lastActivity = new Date(o.opened_at || o._createdAt || '');
      const daysSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceActivity > 14 && o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST';
    });

    if (stalledDeals.length > 0) {
      insights.push({
        type: 'stalled_deals',
        title: `${stalledDeals.length} Stalled Deal${stalledDeals.length > 1 ? 's' : ''}`,
        description: `Deals with no activity for 14+ days. Consider follow-up or requalification.`,
        severity: stalledDeals.length > 3 ? 'high' : 'medium'
      });
    }

    // Check for concentration risk (too much pipeline in few deals)
    if (opps.length > 0) {
      const sortedByValue = [...opps].sort((a, b) => (b.amount || 0) - (a.amount || 0));
      const top3Value = sortedByValue.slice(0, 3).reduce((sum, o) => sum + (o.amount || 0), 0);
      const concentrationRatio = top3Value / snapshot.total;

      if (concentrationRatio > 0.6) {
        insights.push({
          type: 'concentration_risk',
          title: 'High Pipeline Concentration',
          description: `${Math.round(concentrationRatio * 100)}% of pipeline value is in top 3 deals. Diversification recommended.`,
          severity: concentrationRatio > 0.8 ? 'high' : 'medium'
        });
      }
    }

    // Check for stage imbalance
    const stageDistribution = opps.reduce((acc, o) => {
      acc[o.stage] = (acc[o.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const prospectCount = stageDistribution['PROSPECT'] || 0;
    const qualifiedCount = stageDistribution['QUALIFIED'] || 0;

    if (prospectCount > 0 && qualifiedCount === 0) {
      insights.push({
        type: 'stage_imbalance',
        title: 'No Qualified Opportunities',
        description: 'Pipeline has prospects but no qualified deals. Focus on advancing prospects to qualified stage.',
        severity: 'medium'
      });
    }

    // Check for low weighted vs total ratio
    const weightedRatio = snapshot.weighted / snapshot.total;
    if (weightedRatio < 0.3) {
      insights.push({
        type: 'pipeline_quality',
        title: 'Low Pipeline Quality',
        description: `Weighted pipeline is only ${Math.round(weightedRatio * 100)}% of total. Many early-stage deals.`,
        severity: 'medium'
      });
    }

    return insights;
  };

  return (
    <main className="min-h-screen bg-[#09090b] text-white">
      {/* Header */}
      <header className="border-b border-slate-800/60 bg-slate-950/40 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Sales AI Advisor</h1>
            <p className="text-xs text-slate-400">Conversational guidance grounded in your real pipeline - powered by Gemini</p>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,1.4fr)] gap-8">
        {/* Context rail */}
        <aside className="space-y-4">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Pipeline Snapshot</h2>

          <SnapshotCard
            icon={<TrendingUp className="w-4 h-4 text-sky-400" />}
            label="Weighted Pipeline"
            value={pipeline ? fmtCurrency(pipeline.weighted) : error ? '-' : '...'}
            sub={pipeline ? `${pipeline.count} open opportunities` : undefined}
          />
          <SnapshotCard
            icon={<Target className="w-4 h-4 text-emerald-400" />}
            label="Committed Pipeline"
            value={pipeline ? fmtCurrency(pipeline.committed) : error ? '-' : '...'}
            sub={pipeline ? `${Math.round((pipeline.committed / pipeline.total) * 100)}% of total` : undefined}
          />
          <SnapshotCard
            icon={<Users className="w-4 h-4 text-purple-400" />}
            label="Total Pipeline"
            value={pipeline ? fmtCurrency(pipeline.total) : error ? '-' : '...'}
          />

          {forecast && (
            <div className="mt-4 p-4 rounded-xl bg-slate-900/40 border border-slate-800/60">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Latest Forecast</p>
              <p className="text-sm text-slate-300">{fmtCurrency(forecast.weighted_pipeline)}</p>
              <p className="text-[10px] text-slate-500 mt-1">{new Date(forecast.generated_at).toLocaleDateString()}</p>
            </div>
          )}

          <div className="mt-6 p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs leading-relaxed text-slate-400">
            <p className="font-semibold text-slate-300 mb-1.5">Advisory only</p>
            The Sales AI Advisor provides insights and recommendations based on your pipeline data. All deal stage changes and strategic decisions require your approval in the Workbench.
          </div>

          {/* Knowledge Store Integration */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5" />
                Sales Knowledge Base
              </h2>
              <button
                onClick={async () => {
                  setKnowledgeLoading(true);
                  try {
                    const result = await knowledge.query("sales pipeline best practices deal closing negotiation", 5);
                    setKnowledgeResults(result.results || []);
                  } catch (e) {
                    console.error('Failed to query knowledge:', e);
                  } finally {
                    setKnowledgeLoading(false);
                  }
                }}
                disabled={knowledgeLoading}
                className="text-[10px] text-sky-400 hover:text-sky-300 disabled:opacity-50"
              >
                {knowledgeLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {knowledgeLoading ? (
              <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-center">
                <Sparkles className="w-4 h-4 text-slate-500 mx-auto mb-2 animate-pulse" />
                <p className="text-[10px] text-slate-500">Searching knowledge base...</p>
              </div>
            ) : knowledgeResults.length > 0 ? (
              <div className="space-y-2">
                {knowledgeResults.slice(0, 3).map((result, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/60 transition-colors">
                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">{result.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[9px] text-slate-600">{result.source}</span>
                      <span className="text-[9px] text-sky-400">{Math.round(result.score * 100)}% match</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-center">
                <p className="text-[10px] text-slate-500">No relevant knowledge found</p>
              </div>
            )}
          </div>

          {/* Agent-Driven Insights */}
          <div className="mt-4">
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              Pipeline Insights
            </h2>

            {insights.length === 0 ? (
              <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-center">
                <CheckCircle className="w-4 h-4 text-emerald-500/40 mx-auto mb-2" />
                <p className="text-[10px] text-slate-500">No issues detected. Pipeline looks healthy!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {insights.map((insight, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border ${
                      insight.severity === 'high' 
                        ? 'bg-red-500/10 border-red-500/20' 
                        : insight.severity === 'medium'
                        ? 'bg-amber-500/10 border-amber-500/20'
                        : 'bg-slate-900/40 border-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {insight.severity === 'high' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-white mb-1">{insight.title}</p>
                        <p className="text-[9px] text-slate-400 leading-relaxed">{insight.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Agent Chat */}
        <section>
          <AgentChat
            agentName="Sales Advisor"
            agentRole="AI Sales Advisor"
            defaultGreeting={GREETING}
            pipelineContext={pipeline || undefined}
          />
        </section>
      </div>
    </main>
  );
}

function SnapshotCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
