/**
 * Energy-Based Model (EBM) Reasoner
 * 
 * Treats reasoning as an optimization problem by minimizing an energy function.
 * Used for constraint satisfaction and optimal configuration search.
 */

import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("EBMReasoner");

export interface EBMConfiguration {
    complexity: number;
    tokenAllocation: number;
    contextRichness: number;
}

export class EBMReasonerService {
    /**
     * Compute the energy of a configuration.
     * Lower energy means a more consistent and valid state.
     */
    public computeEnergy(config: EBMConfiguration): number {
        let energy = 0;
        
        const { complexity, tokenAllocation, contextRichness } = config;

        // Constraint 1: High complexity requires high token allocation
        // If complexity is high and tokens are low, energy increases.
        const tokenDeficit = Math.max(0, complexity - tokenAllocation);
        energy += tokenDeficit * tokenDeficit * 10; // Quadratic penalty for severe deficit
        
        // Constraint 2: High context richness requires high token allocation
        const contextDeficit = Math.max(0, contextRichness - tokenAllocation);
        energy += contextDeficit * contextDeficit * 5;
        
        // Constraint 3: Avoid over-allocation (wasting resources)
        // If tokens are much higher than needed by complexity and context, energy increases slightly.
        const surplus = Math.max(0, tokenAllocation - (complexity + contextRichness) / 1.5);
        energy += surplus * surplus * 2;
        
        // Constraint 4: System limits
        if (tokenAllocation > 0.9) energy += 5; // Penalty for pushing limits
        if (complexity > 0.9 && contextRichness > 0.9 && tokenAllocation < 0.8) energy += 20; // Impossible state

        return energy;
    }

    /**
     * Optimize token allocation for a given complexity and context richness
     * using gradient descent to find the minimum energy state.
     */
    public optimizeTokens(complexity: number, contextRichness: number): { optimalTokens: number; energy: number; iterations: number } {
        let tokens = 0.5; // Initial guess
        const learningRate = 0.05;
        const iterations = 50;
        const delta = 0.001; // For numerical gradient
        
        let currentEnergy = this.computeEnergy({ complexity, tokenAllocation: tokens, contextRichness });
        
        for (let i = 0; i < iterations; i++) {
            // Compute numerical gradient: dE/dtokens
            const energyPlus = this.computeEnergy({ complexity, tokenAllocation: tokens + delta, contextRichness });
            const gradient = (energyPlus - currentEnergy) / delta;
            
            // Update tokens (moving against the gradient to minimize energy)
            const newTokens = tokens - learningRate * gradient;
            
            // Clip to valid range [0, 1]
            tokens = Math.max(0.01, Math.min(0.99, newTokens));
            
            // Recompute energy
            const newEnergy = this.computeEnergy({ complexity, tokenAllocation: tokens, contextRichness });
            
            // Convergence check
            if (Math.abs(newEnergy - currentEnergy) < 0.0001) {
                return { optimalTokens: tokens, energy: newEnergy, iterations: i + 1 };
            }
            
            currentEnergy = newEnergy;
        }

        return { optimalTokens: tokens, energy: currentEnergy, iterations };
    }
}

export const ebmReasoner = new EBMReasonerService();
