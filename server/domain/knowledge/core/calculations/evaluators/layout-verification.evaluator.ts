/**
 * Knowledge Graph Layout Verification Evaluator
 * Evaluates layout node geometries and mathematical invariants within Knowledge Graph formulas
 */

import { layoutFormalService } from "../../../../scaffold/formal/layout-formal.service.js";
import {
  HardInvariantViolation,
  LayoutNode,
  ProofCertificate,
  SynthesizedRepair,
  ViewportBounds
} from "../../../../scaffold/formal/types.js";

export interface LayoutEvaluationResult {
  passed: boolean;
  complianceScore: number;
  violations: HardInvariantViolation[];
  proof: ProofCertificate;
  repair?: SynthesizedRepair;
}

export const layoutVerificationEvaluator = {
  /**
   * Evaluates a LayoutNode hierarchy against formal QF_LRA invariants
   */
  evaluateLayout(
    root: LayoutNode,
    viewport?: ViewportBounds,
    autoSynthesize: boolean = false
  ): LayoutEvaluationResult {
    const vp = viewport || { minWidth: 320, maxWidth: 2560, minHeight: 480, maxHeight: 1440 };
    
    if (autoSynthesize) {
      const res = layoutFormalService.verifyAndSynthesize(root, vp);
      const passed = res.certificate.status === "PASSED" || (res.repair?.success ?? false);
      const violationCount = res.certificate.violations.length;
      const checkedCount = Math.max(1, res.certificate.checkedInvariantsCount);
      const complianceScore = Math.max(0, Math.min(100, Math.round(((checkedCount - violationCount) / checkedCount) * 100)));

      return {
        passed,
        complianceScore,
        violations: res.certificate.violations,
        proof: res.certificate,
        repair: res.repair
      };
    }

    const proof = layoutFormalService.verify(root, vp);
    const passed = proof.status === "PASSED";
    const violationCount = proof.violations.length;
    const checkedCount = Math.max(1, proof.checkedInvariantsCount);
    const complianceScore = Math.max(0, Math.min(100, Math.round(((checkedCount - violationCount) / checkedCount) * 100)));

    return {
      passed,
      complianceScore,
      violations: proof.violations,
      proof
    };
  },

  /**
   * Fast 1D containment check for horizontal tracks
   */
  validateContainment(
    containerWidth: number,
    childrenWidths: number[],
    gap: number = 0,
    padding: number = 0
  ): boolean {
    const totalGaps = Math.max(0, childrenWidths.length - 1) * gap;
    const sumChildren = childrenWidths.reduce((a, b) => a + b, 0);
    return sumChildren + totalGaps + padding * 2 <= containerWidth;
  },

  /**
   * Generates a closed-form CSS clamp() formula from boundary coordinates
   */
  synthesizeFluidClamp(
    minW: number,
    maxW: number,
    minViewport: number = 320,
    maxViewport: number = 1920
  ): string {
    const deltaW = maxViewport - minViewport;
    const deltaAllocated = maxW - minW;
    const slope = deltaW > 0 ? deltaAllocated / deltaW : 0;
    const basePx = minW - slope * minViewport;
    const vwPercent = Math.round(slope * 100 * 100) / 100;
    const baseRounded = Math.round(basePx * 10) / 10;
    const baseTerm = baseRounded >= 0 ? `+ ${baseRounded}px` : `- ${Math.abs(baseRounded)}px`;

    return `clamp(${Math.round(minW)}px, ${vwPercent}vw ${baseTerm}, ${Math.round(maxW)}px)`;
  }
};
