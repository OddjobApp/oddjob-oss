/**
 * Layout Formal Verification & Synthesis Service
 * Main Facade for App Forge, Scaffold Assembly, and QA Pipelines
 */

import { QFLRACompiler } from "./qf-lra-compiler.js";
import { SMTLayoutSolver } from "./smt-layout-solver.js";
import { MaxSMTSynthesizer } from "./maxsmt-synthesizer.js";
import {
  LayoutNode,
  ProofCertificate,
  SynthesizedRepair,
  ViewportBounds
} from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LayoutFormalService");

export const DEFAULT_VIEWPORT: ViewportBounds = {
  minWidth: 320,
  maxWidth: 2560,
  minHeight: 480,
  maxHeight: 1440
};

export class LayoutFormalService {
  private compiler: QFLRACompiler;
  private solver: SMTLayoutSolver;
  private synthesizer: MaxSMTSynthesizer;

  constructor() {
    this.compiler = new QFLRACompiler();
    this.solver = new SMTLayoutSolver();
    this.synthesizer = new MaxSMTSynthesizer();
  }

  /**
   * Verify layout invariants without making modifications
   */
  public verify(root: LayoutNode, viewport: ViewportBounds = DEFAULT_VIEWPORT): ProofCertificate {
    logger.info(`[LayoutFormalService] Formally verifying layout tree '${root.id}' across W ∈ [${viewport.minWidth}, ${viewport.maxWidth}]`);
    const certificate = this.solver.verify(root, viewport);
    
    if (certificate.status === "PASSED") {
      logger.info(`[LayoutFormalService] ✅ Verification PASSED for '${root.id}'. (${certificate.solverExecutionTimeMs}ms)`);
    } else {
      logger.warn(`[LayoutFormalService] ❌ Verification FAILED for '${root.id}'. Found ${certificate.violations.length} violation(s).`);
    }

    return certificate;
  }

  /**
   * Verify layout and automatically synthesize optimal mathematical repairs if violations are detected
   */
  public verifyAndSynthesize(root: LayoutNode, viewport: ViewportBounds = DEFAULT_VIEWPORT): {
    certificate: ProofCertificate;
    repair?: SynthesizedRepair;
    repairedTree?: LayoutNode;
  } {
    const initialCert = this.verify(root, viewport);

    if (initialCert.status === "PASSED") {
      return { certificate: initialCert };
    }

    logger.info(`[LayoutFormalService] Synthesizing optimal layout repair using MaxSMT...`);
    const repair = this.synthesizer.synthesize(root, viewport);

    return {
      certificate: initialCert,
      repair
    };
  }

  /**
   * Export SMT-LIB2 / Z3 scripts for offline theorem proving or external audit
   */
  public exportSMT(root: LayoutNode, viewport: ViewportBounds = DEFAULT_VIEWPORT): {
    smtLib2: string;
    pythonZ3: string;
  } {
    const compiled = this.compiler.compile(root, viewport);
    return {
      smtLib2: this.compiler.toSMTLIB2(compiled),
      pythonZ3: this.solver.generatePythonZ3Script(root, viewport)
    };
  }
}

export const layoutFormalService = new LayoutFormalService();
