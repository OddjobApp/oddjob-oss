import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  TrendingUp, 
  Wallet, 
  AlertTriangle, 
  ArrowUpCircle, 
  Zap, 
  ShieldCheck,
  Activity,
  History
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AgentSalary {
  id: number;
  agentId: number;
  agentName: string;
  sessionId: string;
  budgetTokens: number;
  currentSpendTokens: number;
  status: 'active' | 'exhausted' | 'frozen';
  lastUpdated: string;
}

const EconomicControlTab: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [additionalTokens, setAdditionalTokens] = useState<string>("50000");
  const [currencyMode, setCurrencyMode] = useState<"USD" | "TKNS">("TKNS");

  const { data: salaries, isLoading } = useQuery<AgentSalary[]>({
    queryKey: ["/api/governor/agent-salaries"],
  });

  const { data: rateData } = useQuery<{ blendedRate: number | null }>({
    queryKey: ["/api/admin/usage/token-rate"],
    staleTime: 5 * 60 * 1000,
  });

  // Use actual blended rate from usage logs; fall back to ~Gemini Flash pricing
  const TOKEN_TO_USD_RATE = rateData?.blendedRate ?? 0.0000004;

  const formatValue = (tokens: number) => {
    if (currencyMode === "USD") {
      return (tokens * TOKEN_TO_USD_RATE).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      });
    }
    return `${tokens.toLocaleString()} TKNS`;
  };

  const increaseBudgetMutation = useMutation({
    mutationFn: async (vars: { agentId: number; sessionId: string; tokens: number }) => {
      await apiRequest("POST", "/api/governor/increase-budget", {
        agentId: vars.agentId,
        sessionId: vars.sessionId,
        additionalTokens: vars.tokens
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governor/agent-salaries"] });
      toast({
        title: "Budget Refilled",
        description: "Agent treasury has been successfully increased.",
      });
    }
  });

  if (isLoading) {
    return <div className="p-8 text-center opacity-50 animate-pulse">Analyzing Corporate Treasury...</div>;
  }

  const totalBudget = salaries?.reduce((acc, s) => acc + s.budgetTokens, 0) || 0;
  const totalSpend = salaries?.reduce((acc, s) => acc + s.currentSpendTokens, 0) || 0;
  const utilization = totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Treasury Header with Currency Mode Toggle */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-background/40 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
        <div>
          <h2 className="text-md font-bold text-foreground uppercase tracking-tight flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-400" />
            Budget & Spend Controls
          </h2>
          <p className="text-xs text-muted-foreground">
            Review spend, track burn, and add budget to active work when needed.
          </p>
        </div>
        <div className="flex items-center bg-black/40 rounded-xl p-1 border border-white/10 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurrencyMode("TKNS")}
            className={cn(
              "h-8 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
              currencyMode === "TKNS" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Tokens
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurrencyMode("USD")}
            className={cn(
              "h-8 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
              currencyMode === "USD" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-muted-foreground hover:text-foreground"
            )}
          >
            USD (ROI)
          </Button>
        </div>
      </div>

      {/* Top Level Macro Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/20 backdrop-blur-md">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-indigo-400" />
              Total Budget
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-foreground">
              {formatValue(totalBudget)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20 backdrop-blur-md">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Current Spend
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-foreground">
              {formatValue(totalSpend)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20 backdrop-blur-md">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-400" />
              Budget Utilization
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-foreground">
              {utilization.toFixed(1)}%
            </CardTitle>
            <Progress value={utilization} className="h-1 mt-2 bg-foreground/5" />
          </CardHeader>
        </Card>
      </div>

      {/* Agent Treasury Grid */}
      <div className="grid grid-cols-1 gap-4">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Active Work Budgets
          </h3>
          <Badge variant="outline" className="font-mono text-[10px]">
            {salaries?.length || 0} AGENTS ACTIVE
          </Badge>
        </div>

        {salaries?.map((salary) => {
          const agentUtilization = (salary.currentSpendTokens / salary.budgetTokens) * 100;
          const isAtRisk = agentUtilization > 85;

          return (
            <Card key={salary.id} className="group relative overflow-hidden transition-all hover:border-white/20">
              <CardContent className="p-0">
                <div className="flex items-center p-4 gap-6">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg tracking-tight">{salary.agentName || "Autonomous Worker"}</span>
                      <Badge variant={salary.status === 'active' ? 'default' : 'destructive'} className="uppercase text-[10px] px-1.5 py-0">
                        {salary.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                      SESSION: {salary.sessionId}
                    </div>
                  </div>

                  <div className="flex-1 px-4">
                    <div className="flex justify-between text-[10px] font-mono mb-1.5 opacity-70">
                      <span>BURN: {formatValue(salary.currentSpendTokens)}</span>
                      <span>LIMIT: {formatValue(salary.budgetTokens)}</span>
                    </div>
                    <Progress 
                      value={agentUtilization} 
                      className={`h-2 ${isAtRisk ? 'bg-red-500/20' : 'bg-indigo-500/20'}`}
                      indicatorClassName={isAtRisk ? 'bg-orange-500' : 'bg-indigo-500'}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex flex-col items-end">
                      <Input
                        type="number"
                        value={additionalTokens}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdditionalTokens(e.target.value)}
                        className="w-24 h-9 font-mono text-xs bg-black/20 text-foreground"
                        placeholder="+ Budget"
                      />
                      <span className="text-[9px] text-muted-foreground mt-0.5 font-mono">
                        ≈ {(parseInt(additionalTokens || "0") * TOKEN_TO_USD_RATE).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-2 border-indigo-500/50 hover:bg-indigo-500/10 text-foreground"
                      onClick={() => increaseBudgetMutation.mutate({
                        agentId: salary.agentId,
                        sessionId: salary.sessionId,
                        tokens: parseInt(additionalTokens)
                      })}
                      disabled={increaseBudgetMutation.isPending}
                    >
                      <Zap className="w-4 h-4 text-yellow-400 animate-pulse" />
                      Add Budget
                    </Button>
                  </div>
                </div>

                {/* Sub-status bar */}
                <div className="flex items-center justify-between px-4 py-2 bg-foreground/[0.02] border-t border-white/[0.05] text-[10px] text-muted-foreground font-mono">
                  <span className="flex items-center gap-1">
                    <History className="w-3 h-3" />
                    LAST UPDATE: {format(new Date(salary.lastUpdated), "HH:mm:ss")}
                  </span>
                  {isAtRisk && (
                    <span className="flex items-center gap-1 text-orange-400 animate-pulse">
                      <AlertTriangle className="w-3 h-3" />
                      SPEND LIMIT NEARLY REACHED
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {salaries?.length === 0 && (
          <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl opacity-30">
            <Wallet className="w-12 h-12 mb-4 text-foreground" />
            <p className="text-sm font-medium italic text-foreground">No active work budgets were found for this run.</p>
          </div>
        )}
      </div>

      {/* Governance Policy Insights */}
      <Card className="bg-black/40 border-white/5 shadow-2xl">
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2 text-foreground">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            Budget Guardrails
          </CardTitle>
          <CardDescription>
            Automated controls currently protect this run from overspending.
          </CardDescription>
        </CardHeader>
        <CardContent>
           <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-indigo-500/20 text-indigo-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">Automatic Scaling Block</div>
                    <div className="text-xs text-muted-foreground">Additional work is being limited because the run is near its budget guardrail.</div>
                  </div>
                </div>
                <Badge variant="outline" className="text-orange-400 border-orange-400/30">ACTIVE</Badge>
              </div>
           </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EconomicControlTab;
