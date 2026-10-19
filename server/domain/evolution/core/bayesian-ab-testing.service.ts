/**
 * Governed Bayesian A/B Testing & Self-Optimizing Topologies Service
 *
 * Evaluates Beta-Binomial conjugate posterior distributions comparing Control deployment topologies
 * against candidate evolution waves, and triggers automated zero-downtime canary promotions ($P(Variant > Control) >= 95%).
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BayesianAbTestingService");

export interface AbTestArm {
  armId: string; // 'control' | 'variant_a' | 'variant_b'
  topologyName: string;
  successes: number;
  failures: number;
  alpha: number; // Beta prior alpha (default 1)
  beta: number;  // Beta prior beta (default 1)
  posteriorMean: number;
  posteriorVariance: number;
}

export interface AbTestEvaluationResult {
  experimentId: string;
  organizationId: number;
  totalTrials: number;
  winningArmId: string | null;
  winProbability: number; // 0.0 to 1.0
  shouldPromote: boolean; // Win prob >= 0.95 and totalTrials >= 50
  arms: AbTestArm[];
  summary: string;
}

export class BayesianAbTestingService {
  /**
   * Evaluates Bayesian A/B experiment arms using Beta-Binomial posterior updates
   */
  evaluateExperiment(params: {
    experimentId: string;
    organizationId: number;
    controlArm: { topologyName: string; successes: number; failures: number };
    variantArm: { topologyName: string; successes: number; failures: number };
    priorAlpha?: number;
    priorBeta?: number;
  }): AbTestEvaluationResult {
    const { experimentId, organizationId, controlArm, variantArm, priorAlpha = 1, priorBeta = 1 } = params;

    logger.info(`[BayesianAbTesting] Evaluating experiment '${experimentId}' for org ${organizationId}...`);

    // Compute control posterior mean & variance
    const ctrlAlpha = priorAlpha + controlArm.successes;
    const ctrlBeta = priorBeta + controlArm.failures;
    const ctrlTotal = ctrlAlpha + ctrlBeta;
    const ctrlMean = Math.round((ctrlAlpha / ctrlTotal) * 10000) / 10000;
    const ctrlVar = (ctrlAlpha * ctrlBeta) / (ctrlTotal * ctrlTotal * (ctrlTotal + 1));

    // Compute variant posterior mean & variance
    const varAlpha = priorAlpha + variantArm.successes;
    const varBeta = priorBeta + variantArm.failures;
    const varTotal = varAlpha + varBeta;
    const varMean = Math.round((varAlpha / varTotal) * 10000) / 10000;
    const varVar = (varAlpha * varBeta) / (varTotal * varTotal * (varTotal + 1));

    const totalTrials = controlArm.successes + controlArm.failures + variantArm.successes + variantArm.failures;

    // Accelerated Monte Carlo simulation to estimate win probability P(Variant > Control)
    const simulations = 10000;
    let variantWins = 0;

    const ctrlSum = ctrlAlpha + ctrlBeta;
    const ctrlMeanFast = ctrlAlpha / ctrlSum;
    const ctrlStdDev = Math.sqrt((ctrlAlpha * ctrlBeta) / (ctrlSum * ctrlSum * (ctrlSum + 1)));

    const varSum = varAlpha + varBeta;
    const varMeanFast = varAlpha / varSum;
    const varStdDev = Math.sqrt((varAlpha * varBeta) / (varSum * varSum * (varSum + 1)));

    for (let i = 0; i < simulations; i++) {
      const u1 = Math.random() || 1e-10;
      const u2 = Math.random();
      const mag = Math.sqrt(-2.0 * Math.log(u1));
      const z0 = mag * Math.cos(2.0 * Math.PI * u2);
      const z1 = mag * Math.sin(2.0 * Math.PI * u2);

      const sampleCtrl = Math.max(0, Math.min(1, ctrlMeanFast + z0 * ctrlStdDev));
      const sampleVar = Math.max(0, Math.min(1, varMeanFast + z1 * varStdDev));

      if (sampleVar > sampleCtrl) {
        variantWins++;
      }
    }

    const winProbability = Math.round((variantWins / simulations) * 100) / 100;
    const shouldPromote = winProbability >= 0.95 && totalTrials >= 50;
    const winningArmId = winProbability >= 0.95 ? "variant_a" : winProbability <= 0.05 ? "control" : null;

    let summary = `Variant win probability P(Variant > Control) = ${winProbability * 100}%. `;
    if (shouldPromote) {
      summary += `STATISTICAL CONVERGENCE ACHIEVED ($N >= 50$). Promote topology '${variantArm.topologyName}' to active production.`;
    } else {
      summary += `Exploration in progress ($N = ${totalTrials}$). Continue canary A/B trial allocation.`;
    }

    logger.info(`[BayesianAbTesting] Evaluation complete. Win Prob: ${winProbability * 100}%, Promote: ${shouldPromote}`);

    return {
      experimentId,
      organizationId,
      totalTrials,
      winningArmId,
      winProbability,
      shouldPromote,
      arms: [
        {
          armId: "control",
          topologyName: controlArm.topologyName,
          successes: controlArm.successes,
          failures: controlArm.failures,
          alpha: ctrlAlpha,
          beta: ctrlBeta,
          posteriorMean: ctrlMean,
          posteriorVariance: Math.round(ctrlVar * 100000) / 100000,
        },
        {
          armId: "variant_a",
          topologyName: variantArm.topologyName,
          successes: variantArm.successes,
          failures: variantArm.failures,
          alpha: varAlpha,
          beta: varBeta,
          posteriorMean: varMean,
          posteriorVariance: Math.round(varVar * 100000) / 100000,
        },
      ],
      summary,
    };
  }
}

export const bayesianAbTestingService = new BayesianAbTestingService();
