/**
 * Reasoning Strategies for Meta-Cognitive Planning
 * 
 * Defines different reasoning approaches agents can select based on
 * task characteristics and their own cognitive state.
 */

export type ReasoningStrategy = 
  | "chain_of_thought"
  | "tree_of_thoughts"
  | "step_by_step"
  | "analogical"
  | "abductive"
  | "deductive"
  | "inductive"
  | "critical_thinking"
  | "creative_brainstorm"
  | "first_principles"
  | "devils_advocate"
  | "systems_thinking";

export interface StrategyConfig {
  name: ReasoningStrategy;
  description: string;
  whenToUse: string[];
  whenNotToUse: string[];
  estimatedComplexity: 1 | 2 | 3 | 4 | 5;
  tokenCostEstimate: "low" | "medium" | "high";
  timeEstimate: "fast" | "medium" | "slow";
  requiresTools: boolean;
  allowsParallel: boolean;
  verificationSteps: number;
}

export const STRATEGY_DEFINITIONS: Record<ReasoningStrategy, StrategyConfig> = {
  chain_of_thought: {
    name: "chain_of_thought",
    description: "Step-by-step reasoning showing intermediate steps explicitly",
    whenToUse: [
      "Complex multi-step problems",
      "Mathematical reasoning",
      "Logical deduction required",
      "Debugging or troubleshooting",
      "When transparency is important"
    ],
    whenNotToUse: [
      "Simple factual lookup",
      "Creative generation tasks",
      "Time-critical decisions",
      "When brevity is prioritized"
    ],
    estimatedComplexity: 3,
    tokenCostEstimate: "medium",
    timeEstimate: "medium",
    requiresTools: true,
    allowsParallel: false,
    verificationSteps: 2,
  },

  tree_of_thoughts: {
    name: "tree_of_thoughts",
    description: "Explore multiple reasoning paths simultaneously and evaluate",
    whenToUse: [
      "Strategic planning",
      "Creative problem solving",
      "Decision making with trade-offs",
      "Complex search problems",
      "When multiple approaches possible"
    ],
    whenNotToUse: [
      "Simple linear tasks",
      "Time-constrained situations",
      "When single answer expected",
      "Low complexity queries"
    ],
    estimatedComplexity: 5,
    tokenCostEstimate: "high",
    timeEstimate: "slow",
    requiresTools: true,
    allowsParallel: true,
    verificationSteps: 3,
  },

  step_by_step: {
    name: "step_by_step",
    description: "Break task into sequential steps and execute in order",
    whenToUse: [
      "Procedural tasks",
      "Process workflows",
      "Data transformations",
      "Sequential dependencies",
      "Structured problem solving"
    ],
    whenNotToUse: [
      "Holistic understanding needed",
      "Interconnected system analysis",
      "When backtracking is frequent"
    ],
    estimatedComplexity: 2,
    tokenCostEstimate: "low",
    timeEstimate: "fast",
    requiresTools: true,
    allowsParallel: false,
    verificationSteps: 1,
  },

  analogical: {
    name: "analogical",
    description: "Use analogies and metaphors to solve novel problems",
    whenToUse: [
      "Novel problem domains",
      "Cross-domain learning",
      "Explaining complex concepts",
      "Pattern transfer situations",
      "Creative inspiration needed"
    ],
    whenNotToUse: [
      "Literal precision required",
      "Technical specifications",
      "Safety-critical decisions",
      "When analogy might mislead"
    ],
    estimatedComplexity: 3,
    tokenCostEstimate: "medium",
    timeEstimate: "medium",
    requiresTools: false,
    allowsParallel: false,
    verificationSteps: 2,
  },

  abductive: {
    name: "abductive",
    description: "Infer best explanation from incomplete observations",
    whenToUse: [
      "Diagnostic reasoning",
      "Root cause analysis",
      "Hypothesis generation",
      "Troubleshooting unknown issues",
      "Detective work"
    ],
    whenNotToUse: [
      "Complete information available",
      "Deductive proof needed",
      "When certainty required"
    ],
    estimatedComplexity: 4,
    tokenCostEstimate: "high",
    timeEstimate: "medium",
    requiresTools: true,
    allowsParallel: true,
    verificationSteps: 3,
  },

  deductive: {
    name: "deductive",
    description: "Apply general rules to reach specific conclusions",
    whenToUse: [
      "Logical proof tasks",
      "Policy/rule application",
      "Formal verification",
      "Constraint satisfaction",
      "When premises are certain"
    ],
    whenNotToUse: [
      "Incomplete information",
      "Probabilistic reasoning",
      "Novel situations without rules",
      "Creative tasks"
    ],
    estimatedComplexity: 2,
    tokenCostEstimate: "low",
    timeEstimate: "fast",
    requiresTools: false,
    allowsParallel: false,
    verificationSteps: 1,
  },

  inductive: {
    name: "inductive",
    description: "Infer general patterns from specific observations",
    whenToUse: [
      "Pattern recognition",
      "Trend analysis",
      "Generalization tasks",
      "Data-driven insights",
      "Learning from examples"
    ],
    whenNotToUse: [
      "When counter-examples exist",
      "Formal proof required",
      "Single instance decisions",
      "Safety-critical single-shot"
    ],
    estimatedComplexity: 3,
    tokenCostEstimate: "medium",
    timeEstimate: "medium",
    requiresTools: true,
    allowsParallel: false,
    verificationSteps: 2,
  },

  critical_thinking: {
    name: "critical_thinking",
    description: "Systematically evaluate assumptions and evidence",
    whenToUse: [
      "Evaluating claims",
      "Bias detection",
      "Source credibility assessment",
      "Argument analysis",
      "Risk evaluation"
    ],
    whenNotToUse: [
      "Simple execution tasks",
      "Creative generation phase",
      "When speed prioritized over rigor"
    ],
    estimatedComplexity: 3,
    tokenCostEstimate: "medium",
    timeEstimate: "medium",
    requiresTools: false,
    allowsParallel: false,
    verificationSteps: 2,
  },

  creative_brainstorm: {
    name: "creative_brainstorm",
    description: "Generate diverse ideas without initial judgment",
    whenToUse: [
      "Idea generation",
      "Solution exploration",
      "Design thinking",
      "Innovation tasks",
      "Divergent thinking required"
    ],
    whenNotToUse: [
      "Analysis phase",
      "Evaluation needed",
      "Single correct answer",
      "Safety-critical decisions"
    ],
    estimatedComplexity: 3,
    tokenCostEstimate: "medium",
    timeEstimate: "medium",
    requiresTools: false,
    allowsParallel: true,
    verificationSteps: 1,
  },

  first_principles: {
    name: "first_principles",
    description: "Break down to fundamental truths and rebuild",
    whenToUse: [
      "Fundamental redesign",
      "Breaking assumptions",
      "Innovative solutions",
      "Deep understanding needed",
      "Complex system design"
    ],
    whenNotToUse: [
      "Incremental improvements",
      "Time-constrained",
      "Well-understood domains",
      "Quick wins needed"
    ],
    estimatedComplexity: 5,
    tokenCostEstimate: "high",
    timeEstimate: "slow",
    requiresTools: true,
    allowsParallel: false,
    verificationSteps: 3,
  },

  devils_advocate: {
    name: "devils_advocate",
    description: "Deliberately challenge and find flaws in reasoning",
    whenToUse: [
      "Important decisions",
      "High-stakes proposals",
      "Risk assessment",
      "Quality assurance",
      "Before finalizing conclusions"
    ],
    whenNotToUse: [
      "Early ideation",
      "Morale-sensitive situations",
      "When building consensus",
      "Simple tasks"
    ],
    estimatedComplexity: 3,
    tokenCostEstimate: "medium",
    timeEstimate: "medium",
    requiresTools: false,
    allowsParallel: true,
    verificationSteps: 2,
  },

  systems_thinking: {
    name: "systems_thinking",
    description: "Analyze interconnected components and emergent behavior",
    whenToUse: [
      "Complex systems",
      "Interdependencies present",
      "Unintended consequences",
      "Feedback loops involved",
      "Holistic optimization"
    ],
    whenNotToUse: [
      "Isolated components",
      "Linear causal chains",
      "Simple cause-effect",
      "Single variable focus"
    ],
    estimatedComplexity: 4,
    tokenCostEstimate: "high",
    timeEstimate: "slow",
    requiresTools: true,
    allowsParallel: true,
    verificationSteps: 3,
  },
};

/**
 * Get strategy recommendations based on task characteristics
 */
export function recommendStrategies(
  taskDescription: string,
  complexity: "low" | "medium" | "high",
  hasData: boolean,
  requiresCreativity: boolean,
  timeConstraint: "none" | "loose" | "tight"
): ReasoningStrategy[] {
  const strategies: ReasoningStrategy[] = [];

  // Base recommendations by complexity
  if (complexity === "low") {
    strategies.push("step_by_step", "deductive");
  } else if (complexity === "medium") {
    strategies.push("chain_of_thought", "inductive", "critical_thinking");
  } else {
    strategies.push("tree_of_thoughts", "systems_thinking", "abductive");
  }

  // Data-driven tasks
  if (hasData) {
    if (!strategies.includes("inductive")) strategies.push("inductive");
    if (!strategies.includes("abductive")) strategies.push("abductive");
  }

  // Creative tasks
  if (requiresCreativity) {
    strategies.push("creative_brainstorm", "analogical", "first_principles");
  }

  // Time constraints
  if (timeConstraint === "tight") {
    // Remove slow strategies
    return strategies.filter(s => 
      STRATEGY_DEFINITIONS[s].timeEstimate !== "slow"
    );
  }

  // Always add devil's advocate for high stakes
  if (complexity === "high" || taskDescription.includes("important")) {
    if (!strategies.includes("devils_advocate")) {
      strategies.push("devils_advocate");
    }
  }

  return strategies;
}
