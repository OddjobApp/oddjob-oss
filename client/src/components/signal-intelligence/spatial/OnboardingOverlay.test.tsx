/**
 * Unit tests for OnboardingOverlay component.
 * Requirements: 1.1, 1.2, 1.3, 1.6
 *
 * Tests:
 * - Renders 4-step walkthrough with correct headings and descriptions
 * - Each heading is max 50 chars, each description is max 150 chars
 * - Skip button is visible on every step and dismisses all remaining steps
 * - Persists completion state to localStorage on complete
 * - Persists completion state to localStorage on skip
 * - Does not render when localStorage key already exists
 * - Does not render when localStorage is unavailable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import {
  OnboardingOverlay,
  STEPS,
  STORAGE_KEY,
} from './OnboardingOverlay';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderOverlay(props?: Partial<{ onComplete: () => void; onSkip: () => void }>) {
  const onComplete = props?.onComplete ?? vi.fn();
  const onSkip = props?.onSkip ?? vi.fn();
  return {
    onComplete,
    onSkip,
    ...render(createElement(OnboardingOverlay, { onComplete, onSkip })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OnboardingOverlay', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe('step content validation', () => {
    it('defines exactly 4 steps', () => {
      expect(STEPS).toHaveLength(4);
    });

    it('all headings are max 50 characters', () => {
      for (const step of STEPS) {
        expect(step.heading.length).toBeLessThanOrEqual(50);
      }
    });

    it('all descriptions are max 150 characters', () => {
      for (const step of STEPS) {
        expect(step.description.length).toBeLessThanOrEqual(150);
      }
    });

    it('steps target the correct selectors in order', () => {
      const expectedSelectors = [
        '[data-onboarding="signal-feed"]',
        '[data-onboarding="impact-visualization"]',
        '[data-onboarding="view-switcher"]',
        '[data-onboarding="recommended-actions"]',
      ];
      expect(STEPS.map((s) => s.targetSelector)).toEqual(expectedSelectors);
    });
  });

  describe('rendering', () => {
    it('renders the overlay when onboarding is not complete', () => {
      renderOverlay();
      expect(screen.getByTestId('onboarding-overlay')).toBeTruthy();
    });

    it('displays step 1 heading initially', () => {
      renderOverlay();
      expect(screen.getByTestId('onboarding-heading').textContent).toBe(STEPS[0].heading);
    });

    it('displays step 1 description initially', () => {
      renderOverlay();
      expect(screen.getByTestId('onboarding-description').textContent).toBe(STEPS[0].description);
    });

    it('shows "Step 1 of 4" indicator', () => {
      renderOverlay();
      expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    });
  });

  describe('navigation', () => {
    it('advances to next step on Next click', () => {
      renderOverlay();
      fireEvent.click(screen.getByTestId('onboarding-next'));
      expect(screen.getByTestId('onboarding-heading').textContent).toBe(STEPS[1].heading);
      expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    });

    it('progresses through all 4 steps', () => {
      renderOverlay();
      for (let i = 0; i < 3; i++) {
        fireEvent.click(screen.getByTestId('onboarding-next'));
      }
      expect(screen.getByTestId('onboarding-heading').textContent).toBe(STEPS[3].heading);
      expect(screen.getByText('Step 4 of 4')).toBeTruthy();
    });

    it('shows "Get Started" button on the last step', () => {
      renderOverlay();
      for (let i = 0; i < 3; i++) {
        fireEvent.click(screen.getByTestId('onboarding-next'));
      }
      expect(screen.getByTestId('onboarding-next').textContent).toBe('Get Started');
    });

    it('calls onComplete and dismisses overlay after final step', () => {
      const onComplete = vi.fn();
      renderOverlay({ onComplete });

      // Go through all steps
      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByTestId('onboarding-next'));
      }

      expect(onComplete).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('onboarding-overlay')).toBeNull();
    });
  });

  describe('skip functionality (Req 1.6)', () => {
    it('skip button is visible on every step', () => {
      renderOverlay();
      for (let i = 0; i < STEPS.length; i++) {
        expect(screen.getByTestId('onboarding-skip')).toBeTruthy();
        if (i < STEPS.length - 1) {
          fireEvent.click(screen.getByTestId('onboarding-next'));
        }
      }
    });

    it('clicking Skip dismisses the overlay immediately', () => {
      const onSkip = vi.fn();
      renderOverlay({ onSkip });
      fireEvent.click(screen.getByTestId('onboarding-skip'));

      expect(onSkip).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('onboarding-overlay')).toBeNull();
    });

    it('clicking Skip persists completion state to localStorage', () => {
      renderOverlay();
      fireEvent.click(screen.getByTestId('onboarding-skip'));
      expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });
  });

  describe('localStorage persistence (Req 1.2)', () => {
    it('persists completion on final step', () => {
      renderOverlay();
      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByTestId('onboarding-next'));
      }
      expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('does not render when localStorage key already exists', () => {
      localStorage.setItem(STORAGE_KEY, 'true');
      renderOverlay();
      expect(screen.queryByTestId('onboarding-overlay')).toBeNull();
    });
  });

  describe('localStorage unavailable (Req 1.3)', () => {
    it('does not render overlay when localStorage throws', () => {
      // Mock localStorage to throw
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;

      Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
      Storage.prototype.getItem = () => { throw new Error('SecurityError'); };
      Storage.prototype.removeItem = () => { throw new Error('SecurityError'); };

      renderOverlay();
      expect(screen.queryByTestId('onboarding-overlay')).toBeNull();

      // Restore
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
      Storage.prototype.removeItem = originalRemoveItem;
    });
  });

  describe('accessibility', () => {
    it('renders as a dialog with aria-modal', () => {
      renderOverlay();
      const overlay = screen.getByTestId('onboarding-overlay');
      expect(overlay.getAttribute('role')).toBe('dialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
    });

    it('has an aria-label for the dialog', () => {
      renderOverlay();
      const overlay = screen.getByTestId('onboarding-overlay');
      expect(overlay.getAttribute('aria-label')).toBe('Onboarding walkthrough');
    });
  });
});
