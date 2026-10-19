import { subDays, subMonths } from "date-fns";

export interface DemoCostStats {
  dailyCosts: { date: string; cost: number }[];
  modelCosts: { model: string; cost: number }[];
  topPipelines: { pipelineId: number; name: string; totalCost: number }[];
  topAgents: { agentId: number; name: string; totalCost: number }[];
  totalSpend: number;
  orgBudget: {
    monthlyBudget: number;
    currentMonthSpend: number;
    resetDay: number;
    lastResetAt: string | null;
  } | null;
  activeMissions: {
    id: number;
    name: string;
    budgetLimit: number;
    currentSpend: number;
  }[];
  spendHistory: {
    month: number;
    year: number;
    totalSpend: number;
    budgetLimit: number;
    date: string;
  }[];
  insights: {
    id: string;
    type: "warning" | "optimization" | "success";
    title: string;
    description: string;
    impact: string;
    actionLabel?: string;
    actionPath?: string;
  }[];
}

export class DemoSeedService {
  /**
   * Generates realistic demo statistics for the cost dashboard.
   */
  static getCostDashboardStats(): DemoCostStats {
    const today = new Date();
    const dailyCosts: { date: string; cost: number }[] = [];

    // Generate 30 days of daily cost data (oscillating realistically between $20 and $180)
    for (let i = 29; i >= 0; i--) {
      const d = subDays(today, i);
      const dateStr = d.toISOString().split("T")[0];
      const baseCost = 45 + Math.sin(i * 0.5) * 25 + (i % 7 === 0 ? 80 : 0);
      dailyCosts.push({
        date: dateStr,
        cost: Math.round(baseCost * 100) / 100,
      });
    }

    const totalSpend = dailyCosts.reduce((sum, item) => sum + item.cost, 0);

    // 3 Months of spend history
    const m1 = subMonths(today, 1);
    const m2 = subMonths(today, 2);
    const m3 = subMonths(today, 3);

    const spendHistory = [
      {
        month: m3.getMonth() + 1,
        year: m3.getFullYear(),
        totalSpend: 1845,
        budgetLimit: 2500,
        date: m3.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      },
      {
        month: m2.getMonth() + 1,
        year: m2.getFullYear(),
        totalSpend: 2150,
        budgetLimit: 2500,
        date: m2.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      },
      {
        month: m1.getMonth() + 1,
        year: m1.getFullYear(),
        totalSpend: 2420,
        budgetLimit: 2500,
        date: m1.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      },
    ];

    // Model cost attribution (2 entries)
    const modelCosts = [
      { model: "gpt-4o", cost: Math.round(totalSpend * 0.65) },
      { model: "llama3.2", cost: Math.round(totalSpend * 0.35) },
    ];

    // Top pipelines and agents
    const topPipelines = [
      { pipelineId: 101, name: "Knowledge Extraction & Mapping Pipeline", totalCost: Math.round(totalSpend * 0.45) },
      { pipelineId: 102, name: "Codebase Semantic Scouting & Validation", totalCost: Math.round(totalSpend * 0.35) },
      { pipelineId: 103, name: "Continuous Integration Testing Suite", totalCost: Math.round(totalSpend * 0.20) },
    ];

    const topAgents = [
      { agentId: 201, name: "Scout Agent Alpha", totalCost: Math.round(totalSpend * 0.55) },
      { agentId: 202, name: "Synthesis Architect", totalCost: Math.round(totalSpend * 0.45) },
    ];

    // 3 Demo missions with spend/budget
    const activeMissions = [
      {
        id: 991,
        name: "Enterprise Database Migration & Shadowing",
        budgetLimit: 1500,
        currentSpend: 1120,
      },
      {
        id: 992,
        name: "Autonomous Vulnerability Remediation Patching",
        budgetLimit: 800,
        currentSpend: 340,
      },
      {
        id: 993,
        name: "Automated Regression Audit Suite (Sprint 12)",
        budgetLimit: 500,
        currentSpend: 490,
      },
    ];

    // 3 Cost insights
    const insights = [
      {
        id: "insight-demo-1",
        type: "warning" as const,
        title: "Mission approaching budget exhaustion",
        description: "The 'Automated Regression Audit Suite' mission has consumed 98% of its allocated $500 threshold with 4 days remaining in the cycle.",
        impact: "Requires attention soon to avoid operational disruption.",
        actionLabel: "Adjust Mission Limit",
        actionPath: "/control/policies",
      },
      {
        id: "insight-demo-2",
        type: "optimization" as const,
        title: "SLM routing candidate detected",
        description: "The 'Codebase Semantic Scouting' pipeline performs 1,200/day syntax checking tasks using GPT-4o. These are highly suitable for local Llama-3.2 routing.",
        impact: "Estimated savings of $120.00/month (82% reduction).",
        actionLabel: "Enable Local Routing",
        actionPath: "/insights/prediction/config",
      },
      {
        id: "insight-demo-3",
        type: "success" as const,
        title: "Local routing efficiency nominal",
        description: "Local Ollama models executed 8,421 tasks this month, saving $242.10 in external API costs compared to baseline cloud costs.",
        impact: "Total external cloud spend decreased by 34.2% month-over-month.",
      },
    ];

    return {
      dailyCosts,
      modelCosts,
      topPipelines,
      topAgents,
      totalSpend,
      orgBudget: {
        monthlyBudget: 2500,
        currentMonthSpend: Math.round(totalSpend),
        resetDay: 1,
        lastResetAt: subDays(today, today.getDate() - 1).toISOString(),
      },
      activeMissions,
      spendHistory,
      insights,
    };
  }

  /**
   * Generates realistic operational cycles for Predictive VSM.
   */
  static getDemoCycles() {
    return [
      {
        id: 991,
        name: "Enterprise Database Migration & Shadowing",
        objective: "Assess reliability, verify data integrity, and shadow target transactions using autonomous validation checks.",
        status: "running",
        organizationId: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: 992,
        name: "Autonomous Vulnerability Remediation Patching",
        objective: "Scan server environments, evaluate CVE severities, and generate/verify PR patches locally before review.",
        status: "running",
        organizationId: 1,
        createdAt: new Date().toISOString(),
      },
    ];
  }
}
