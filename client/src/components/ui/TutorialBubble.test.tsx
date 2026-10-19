import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TutorialBubble } from './TutorialBubble';

describe('TutorialBubble', () => {
  it('renders correctly with title, description, step count and S.C.O.R.E. badge', () => {
    render(
      <TutorialBubble
        target="body"
        title="Test Symptom Detection"
        description="Explaining how the problem is diagnosed."
        scoreDimension="S"
        step={1}
        totalSteps={4}
        onNext={() => {}}
      />
    );

    expect(screen.getByTestId('tutorial-bubble')).toBeTruthy();
    expect(screen.getByText('Test Symptom Detection')).toBeTruthy();
    expect(screen.getByText('Explaining how the problem is diagnosed.')).toBeTruthy();
    expect(screen.getByTestId('tutorial-score-badge').textContent).toContain('[S]');
    expect(screen.getByText('1 / 4')).toBeTruthy();
  });

  it('triggers onNext and onPrev callbacks when clicked', () => {
    const handleNext = vi.fn();
    const handlePrev = vi.fn();

    render(
      <TutorialBubble
        target="body"
        title="Test Navigation"
        description="Checking next and prev actions."
        scoreDimension="C"
        step={2}
        totalSteps={4}
        onNext={handleNext}
        onPrev={handlePrev}
      />
    );

    const nextBtn = screen.getByTestId('tutorial-bubble-next');
    fireEvent.click(nextBtn);
    expect(handleNext).toHaveBeenCalledTimes(1);

    const prevBtn = screen.getByTestId('tutorial-bubble-prev');
    fireEvent.click(prevBtn);
    expect(handlePrev).toHaveBeenCalledTimes(1);
  });

  it('displays custom finish label on final step', () => {
    const handleComplete = vi.fn();

    render(
      <TutorialBubble
        target="body"
        title="Final Outcome"
        description="Verify verifiable outcomes."
        scoreDimension="O"
        step={4}
        totalSteps={4}
        nextLabel="Complete Mission Guide"
        onComplete={handleComplete}
      />
    );

    const finishBtn = screen.getByTestId('tutorial-bubble-next');
    expect(finishBtn.textContent).toContain('Complete Mission Guide');
    fireEvent.click(finishBtn);
    expect(handleComplete).toHaveBeenCalledTimes(1);
  });

  it('renders chained module indicator and playlist badge when provided', () => {
    render(
      <TutorialBubble
        target="body"
        title="App Forge Catalog"
        description="Access 34 production-verified enterprise blueprints."
        scoreDimension="S"
        step={2}
        totalSteps={3}
        moduleTitle="App Forge Track"
        moduleIndex={2}
        totalModules={3}
        onNext={() => {}}
      />
    );

    const moduleBadge = screen.getByTestId('tutorial-module-badge');
    expect(moduleBadge).toBeTruthy();
    expect(moduleBadge.textContent).toContain('Module 2 of 3: App Forge Track');
    expect(moduleBadge.textContent).toContain('Playlist');
  });

  it('renders keyboard shortcut, hint box, and specs/gallery footer links when provided', () => {
    render(
      <TutorialBubble
        target="body"
        title="Omnipresent Discovery"
        description="Search across all installed blueprints and cycle tools."
        scoreDimension="S"
        step={1}
        totalSteps={3}
        shortcut="⌘K"
        hint="Press Cmd+K from anywhere to summon."
        docSlug="features/command-palette"
        componentId="command-palette"
        onNext={() => {}}
      />
    );

    expect(screen.getByTestId('tutorial-shortcut-badge').textContent).toBe('⌘K');
    expect(screen.getByTestId('tutorial-hint-box').textContent).toContain('Press Cmd+K from anywhere to summon.');

    const footerLinks = screen.getByTestId('tutorial-footer-links');
    expect(footerLinks).toBeTruthy();
    expect(screen.getByText('Specs')).toBeTruthy();
    expect(screen.getByText('Gallery')).toBeTruthy();
  });

  it('advertises both what the component does and what action it performs', () => {
    render(
      <TutorialBubble
        target="body"
        title="Agent Participation Control"
        description="Autonomous specialist allocated to this mission squad."
        action="Click to toggle active deliberation participation."
        scoreDimension="R"
        step={1}
        totalSteps={2}
        onNext={() => {}}
      />
    );

    expect(screen.getByText('What It Does')).toBeTruthy();
    expect(screen.getByTestId('tutorial-description-text').textContent).toBe(
      'Autonomous specialist allocated to this mission squad.'
    );

    expect(screen.getByTestId('tutorial-action-box')).toBeTruthy();
    expect(screen.getByTestId('tutorial-action-text').textContent).toBe(
      'Click to toggle active deliberation participation.'
    );
  });

  it('does not render an action box when no action is provided', () => {
    render(
      <TutorialBubble
        target="body"
        title="Informational Status Banner"
        description="Displays the system status."
        scoreDimension="S"
        step={1}
        totalSteps={1}
        onNext={() => {}}
      />
    );

    expect(screen.getByText('What It Does')).toBeTruthy();
    expect(screen.getByTestId('tutorial-description-text').textContent).toBe(
      'Displays the system status.'
    );
    expect(screen.queryByTestId('tutorial-action-box')).toBeNull();
  });

  it('guarantees the Next button is always visible on every intermediate step and final step', () => {
    // Step 1 of 3: intermediate step
    const { unmount } = render(
      <TutorialBubble
        target="body"
        title="Step 1 Visibility"
        description={"Very long content that could overflow on smaller viewports. ".repeat(10)}
        scoreDimension="S"
        step={1}
        totalSteps={3}
        onNext={() => {}}
      />
    );

    const nextBtnStep1 = screen.getByTestId('tutorial-bubble-next');
    expect(nextBtnStep1).toBeTruthy();
    expect(nextBtnStep1.textContent).toContain('Next Step');
    unmount();

    // Step 3 of 3: final step
    render(
      <TutorialBubble
        target="body"
        title="Final Step Visibility"
        description="Ending step"
        scoreDimension="E"
        step={3}
        totalSteps={3}
        onComplete={() => {}}
      />
    );

    const finishBtn = screen.getByTestId('tutorial-bubble-next');
    expect(finishBtn).toBeTruthy();
    expect(finishBtn.textContent).toContain('Finish Tutorial');
  });

  it('prevents button overflow when nextLabel is extraordinarily long', () => {
    render(
      <TutorialBubble
        target="body"
        title="Overflow Prevention Test"
        description="Testing extraordinarily long next button labels."
        scoreDimension="C"
        step={1}
        totalSteps={7}
        nextLabel="Next: Autonomous Computer Use Agent & Virtual Desktop Browser"
        onNext={() => {}}
      />
    );

    const nextBtn = screen.getByTestId('tutorial-bubble-next');
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.className).toContain('max-w-full');
    expect(nextBtn.className).toContain('min-w-0');
    expect(nextBtn.querySelector('span')?.className).toContain('truncate');
    expect(nextBtn.getAttribute('title')).toBe('Next: Autonomous Computer Use Agent & Virtual Desktop Browser');
  });
});
