import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TUTORIAL_SNIPPETS,
  CANONICAL_CHAINS,
  CANONICAL_TUTORIALS,
  createChainedTutorial,
  startTutorial,
  startTutorialChain,
  emitTutorialOutcome,
  getAllTutorialChains,
  getAllTutorialSnippets,
} from './tutorial-engine';

describe('tutorial-engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('contains valid atomic snippets covering S.C.O.R.E. dimensions', () => {
    const snippets = getAllTutorialSnippets();
    expect(snippets['snippet:discovery']).toBeDefined();
    expect(snippets['snippet:telemetry']).toBeDefined();
    expect(snippets['snippet:spatial-intelligence']).toBeDefined();
    expect(snippets['snippet:app-forge']).toBeDefined();
    expect(snippets['snippet:project-spaces']).toBeDefined();
    expect(snippets['snippet:copilot']).toBeDefined();
    expect(snippets['snippet:builder-pods']).toBeDefined();
    expect(snippets['snippet:cycle-builder']).toBeDefined();
    expect(snippets['snippet:hil-gates']).toBeDefined();
    expect(snippets['snippet:governance']).toBeDefined();

    // Verify all snippets have at least 1 step with title, description, and valid score dimension
    for (const [id, snippet] of Object.entries(snippets)) {
      expect(snippet.steps.length).toBeGreaterThan(0);
      expect(snippet.title).toBeTruthy();
      expect(['S', 'C', 'O', 'R', 'E']).toContain(snippet.scoreDimension);
      for (const step of snippet.steps) {
        expect(step.title).toBeTruthy();
        expect(step.description).toBeTruthy();
        expect(step.target).toBeTruthy();
      }
    }
  });

  it('contains canonical pre-composed chains with sequential module indexing', () => {
    const chains = getAllTutorialChains();
    expect(chains['chain:executive-overview']).toBeDefined();
    expect(chains['chain:developer-forge']).toBeDefined();
    expect(chains['chain:operator-flight-deck']).toBeDefined();
    expect(chains['chain:spatial-operator']).toBeDefined();
    expect(chains['chain:enterprise-architect']).toBeDefined();
    expect(chains['chain:builder-pod-mastery']).toBeDefined();
    expect(chains['chain:full-platform-immersion']).toBeDefined();

    // Test assembling full immersion chain
    const fullChain = chains['chain:full-platform-immersion'];
    const def = createChainedTutorial(fullChain);
    expect(def.id).toBe('chain:full-platform-immersion');
    expect(def.steps.length).toBe(10);

    // Verify module progression across all 10 steps
    def.steps.forEach((step, idx) => {
      expect(step.moduleIndex).toBe(idx + 1);
      expect(step.totalModules).toBe(10);
      expect(step.moduleTitle).toBeTruthy();
    });

    // Last step should have final completion label
    const lastStep = def.steps[def.steps.length - 1];
    expect(lastStep.nextLabel).toContain('Complete Overview');
  });

  it('dispatches oddjob:start-tutorial event on startTutorial', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    startTutorial('chain:spatial-operator');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('oddjob:start-tutorial');
    expect(event.detail.id).toBe('chain:spatial-operator');
    expect(event.detail.steps.length).toBe(3);
  });

  it('dispatches oddjob:start-tutorial event on startTutorialChain with definition object', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    startTutorialChain({
      id: 'chain:custom-test',
      name: 'Custom Test Chain',
      snippetIds: ['snippet:discovery', 'snippet:copilot'],
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('oddjob:start-tutorial');
    expect(event.detail.id).toBe('chain:custom-test');
    expect(event.detail.steps.length).toBe(2);
    expect(event.detail.steps[0].moduleTitle).toBe('Omnipresent Discovery');
    expect(event.detail.steps[1].moduleTitle).toBe('Autonomous Co-pilot Assistant');
  });

  it('emits tutorial completion and closed-loop outcome calibration', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    emitTutorialOutcome('chain:spatial-operator');

    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    const completedEvt = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(completedEvt.type).toBe('oddjob:tutorial-completed');
    expect(completedEvt.detail.tutorialId).toBe('chain:spatial-operator');

    const outcomeEvt = dispatchSpy.mock.calls[1][0] as CustomEvent;
    expect(outcomeEvt.type).toBe('oddjob:score-outcome');
    expect(outcomeEvt.detail.tutorialId).toBe('chain:spatial-operator');
    expect(outcomeEvt.detail.scoreVector.O).toBe(9.5);
    expect(outcomeEvt.detail.scoreVector.S).toBe(0.5);
  });
});
