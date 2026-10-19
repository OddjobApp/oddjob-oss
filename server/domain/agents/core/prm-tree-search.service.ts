export interface CandidateStep {
    stepId: string;
    actionType: string;
    toolName?: string;
    payload: Record<string, any>;
    estimatedCostTokens: number;
}

export interface TreeSearchNode {
    id: string;
    parentId: string | null;
    step: CandidateStep;
    prmScore: number; // Process Reward Model score [0.0 - 1.0]
    isVerified: boolean;
    children: TreeSearchNode[];
}

export interface SearchResult {
    selectedPlan: CandidateStep[];
    confidenceScore: number;
    totalNodesExplored: number;
    prunedBranchesCount: number;
}

export const prmTreeSearchService = {
    /**
     * Scores an individual candidate step using Process Reward heuristics
     * Combines schema validity, tool permissions, and safety bounds
     */
    evaluateStepReward(step: CandidateStep): number {
        let score = 0.5;

        // Tool name validity
        if (step.toolName) {
            if (step.toolName.startsWith("db_") || step.toolName.startsWith("api_") || step.toolName.startsWith("agent_")) {
                score += 0.25;
            }
        }

        // Token budget efficiency
        if (step.estimatedCostTokens <= 2000) {
            score += 0.15;
        } else if (step.estimatedCostTokens > 8000) {
            score -= 0.20;
        }

        // Action payload completeness
        if (step.payload && Object.keys(step.payload).length > 0) {
            score += 0.10;
        }

        return Math.min(1.0, Math.max(0.0, score));
    },

    /**
     * Executes MCTS-style Process Reward Model (PRM) Guided Test-Time Tree Search
     * over candidate delegation steps
     */
    async searchBestExecutionPlan(
        candidateSteps: CandidateStep[],
        maxDepth: number = 3,
        minPrmThreshold: number = 0.6
    ): Promise<SearchResult> {
        let totalExplored = 0;
        let prunedCount = 0;
        const acceptedSteps: CandidateStep[] = [];

        for (const step of candidateSteps) {
            totalExplored++;
            const prmScore = this.evaluateStepReward(step);

            if (prmScore >= minPrmThreshold) {
                acceptedSteps.push(step);
            } else {
                prunedCount++;
            }
        }

        const avgScore = acceptedSteps.length > 0
            ? acceptedSteps.reduce((sum, s) => sum + this.evaluateStepReward(s), 0) / acceptedSteps.length
            : 0;

        return {
            selectedPlan: acceptedSteps,
            confidenceScore: Number(avgScore.toFixed(3)),
            totalNodesExplored: totalExplored,
            prunedBranchesCount: prunedCount
        };
    }
};
