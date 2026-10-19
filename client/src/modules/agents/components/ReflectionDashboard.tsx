/**
 * Reflection Dashboard
 * 
 * View reflection logs, patterns, and quality metrics.
 */

import { useState } from "react";
import { useReflectionStats, useReflectionPatterns } from "../hooks/use-reflection";
import { 
  Brain, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Filter
} from "lucide-react";

interface IssueTypeBadgeProps {
  type: string;
}

const IssueTypeBadge = ({ type }: IssueTypeBadgeProps) => {
  const colors: Record<string, string> = {
    hallucination: "bg-purple-100 text-purple-700",
    logical_error: "bg-red-100 text-red-700",
    factual_error: "bg-orange-100 text-orange-700",
    schema_mismatch: "bg-blue-100 text-blue-700",
    inconsistency: "bg-yellow-100 text-yellow-700",
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[type] || "bg-muted text-foreground"}`}>
      {type.replace("_", " ")}
    </span>
  );
};

export function ReflectionDashboard() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<"all" | "passed" | "failed">("all");
  
  const { data: stats, isLoading: statsLoading } = useReflectionStats(days);
  const { data: patterns } = useReflectionPatterns();

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Stats is the ReflectionStats directly, not wrapped in data
  const summary = stats as any;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Reflection & Self-Correction</h1>
          <p className="text-muted-foreground mt-1">Monitor agent self-verification and quality metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={days} 
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 border border-border rounded-lg"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="p-6 bg-card rounded-lg border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Total Reflections</span>
              <Brain className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold">{summary.totalReflections}</div>
            <div className="text-sm text-muted-foreground">
              {summary.avgReflectionsPerDay.toFixed(1)} per day
            </div>
          </div>

          <div className="p-6 bg-card rounded-lg border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Pass Rate</span>
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-3xl font-bold text-green-600">
              {(summary.passRate * 100).toFixed(1)}%
            </div>
            <div className="text-sm text-muted-foreground">
              {summary.resolutionsByType?.passed || 0} passed
            </div>
          </div>

          <div className="p-6 bg-card rounded-lg border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Issues Found</span>
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <div className="text-3xl font-bold text-orange-600">
              {summary.totalReflections - (summary.resolutionsByType?.passed || 0)}
            </div>
            <div className="text-sm text-muted-foreground">
              {summary.correctionSuccessRate ? `${(summary.correctionSuccessRate * 100).toFixed(0)}% corrected` : "N/A"}
            </div>
          </div>

          <div className="p-6 bg-card rounded-lg border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Avg Confidence</span>
              <TrendingUp className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold">
              {(summary.avgConfidenceScore * 100).toFixed(0)}%
            </div>
            <div className="text-sm text-muted-foreground">
              Across all verifications
            </div>
          </div>
        </div>
      )}

      {/* Issue Types */}
      {summary?.issueTypes && (
        <div className="mb-8">
          <h2 className="font-semibold text-lg mb-4">Issues by Type</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(summary.issueTypes).map(([type, count]) => (
              <div key={type} className="p-4 bg-card rounded-lg border border-border">
                <IssueTypeBadge type={type} />
                <div className="text-2xl font-bold mt-2">{count as number}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patterns */}
      <div className="mb-8">
        <h2 className="font-semibold text-lg mb-4">Learned Patterns ({patterns?.length || 0})</h2>
        <div className="space-y-3">
          {patterns?.slice(0, 5).map((pattern: any) => (
            <div key={pattern.id} className="p-4 bg-card rounded-lg border border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <IssueTypeBadge type={pattern.patternType} />
                  <span className="font-medium">{pattern.name}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {pattern.detectionCount} detections
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-2">{pattern.description}</p>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-600">
                  Success rate: {(pattern.successRate * 100).toFixed(0)}%
                </span>
                {pattern.isAutoGenerated && (
                  <span className="text-blue-600">Auto-generated</span>
                )}
              </div>
            </div>
          ))}
          {!patterns?.length && (
            <div className="text-center p-8 text-muted-foreground bg-muted rounded-lg">
              <Brain className="w-12 h-12 mx-auto mb-3 text-foreground" />
              <p>No patterns learned yet</p>
              <p className="text-sm">Patterns will appear as agents reflect on their work</p>
            </div>
          )}
        </div>
      </div>

      {/* Daily Trends */}
      {summary?.dailyTrends && summary.dailyTrends.length > 0 && (
        <div>
          <h2 className="font-semibold text-lg mb-4">Daily Trends</h2>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="space-y-3">
              {summary.dailyTrends.map((day: any, i: number) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-24 text-sm text-muted-foreground">{day.date}</div>
                  <div className="flex-1">
                    <div className="h-8 bg-muted rounded-lg overflow-hidden flex">
                      <div 
                        className="h-full bg-green-500"
                        style={{ width: `${(day.passed / day.total) * 100}%` }}
                      />
                      <div 
                        className="h-full bg-red-500"
                        style={{ width: `${(day.corrected / day.total) * 100}%` }}
                      />
                      <div 
                        className="h-full bg-gray-400"
                        style={{ width: `${(day.escalated / day.total) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-32 text-sm text-muted-foreground">
                    {day.total} total
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded" />
                <span>Passed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded" />
                <span>Corrected</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gray-400 rounded" />
                <span>Escalated</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
