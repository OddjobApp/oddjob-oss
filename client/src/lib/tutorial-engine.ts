/**
 * Browser-side tutorial engine.
 *
 * The registry (snippets, chains, tutorials and the pure helpers over them)
 * lives in @shared/tutorials/registry so the server can read it without
 * importing client code. This module re-exports all of it, so importing from
 * "@/lib/tutorial-engine" still gets you everything it always did, and adds
 * the three functions that need `window`.
 */

export * from "@shared/tutorials/registry";

import {
  CANONICAL_CHAINS,
  CANONICAL_TUTORIALS,
  TUTORIAL_SNIPPETS,
  createChainedTutorial,
  type TutorialChain,
  type TutorialDefinition,
} from "@shared/tutorials/registry";

/** Launches an instructive tutorial chain playlist */
export function startTutorialChain(chainIdOrDef: string | TutorialChain) {
  const chain = typeof chainIdOrDef === "string" ? CANONICAL_CHAINS[chainIdOrDef] : chainIdOrDef;
  if (!chain) {
    console.warn("[TutorialEngine] Unknown chain:", chainIdOrDef);
    return;
  }
  const tutorialDef = createChainedTutorial(chain);
  startTutorial(tutorialDef);
}

/** Dispatches a global event to start a tutorial or chained playlist */
export function startTutorial(tutorialIdOrDef: string | TutorialDefinition | TutorialChain) {
  let def: TutorialDefinition | undefined;

  if (typeof tutorialIdOrDef === "string") {
    if (CANONICAL_CHAINS[tutorialIdOrDef]) {
      def = createChainedTutorial(CANONICAL_CHAINS[tutorialIdOrDef]);
    } else if (CANONICAL_TUTORIALS[tutorialIdOrDef]) {
      def = CANONICAL_TUTORIALS[tutorialIdOrDef];
    } else if (TUTORIAL_SNIPPETS[tutorialIdOrDef]) {
      // A lone snippet is launchable as a one-module chain. Without this,
      // every "snippet:*" id fell through to the warning below -- which is
      // what the component gallery's "Live Demo" button passes, so it could
      // never start anything.
      const snippet = TUTORIAL_SNIPPETS[tutorialIdOrDef];
      def = createChainedTutorial({
        id: snippet.id,
        name: snippet.title,
        snippetIds: [snippet.id],
      });
    }
  } else if ("snippetIds" in tutorialIdOrDef) {
    def = createChainedTutorial(tutorialIdOrDef);
  } else {
    def = tutorialIdOrDef;
  }

  if (!def) {
    console.warn("[TutorialEngine] Unknown tutorial or chain:", tutorialIdOrDef);
    return;
  }

  window.dispatchEvent(
    new CustomEvent("oddjob:start-tutorial", {
      detail: def,
    })
  );
}

/** Dispatches closed-loop vector calibration upon tutorial completion */
export function emitTutorialOutcome(tutorialId: string) {
  // 1. Emit application event
  window.dispatchEvent(
    new CustomEvent("oddjob:tutorial-completed", {
      detail: { tutorialId, timestamp: Date.now() },
    })
  );

  // 2. Closed-loop score vector update: Outcome surges to 9.5, Symptom drops to 0.5
  window.dispatchEvent(
    new CustomEvent("oddjob:score-outcome", {
      detail: {
        tutorialId,
        scoreVector: { S: 0.5, C: 2.0, O: 9.5, R: 3.0, E: 0.5 },
        suppressInterventions: true,
      },
    })
  );

  console.log(`[TutorialEngine] Tutorial ${tutorialId} completed. Closed-loop Outcome calibrated to 9.5.`);
}
