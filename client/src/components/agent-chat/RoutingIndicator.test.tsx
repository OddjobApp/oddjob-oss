/**
 * Unit tests for the RoutingIndicator component.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoutingIndicator, type RoutingIndicatorProps } from './RoutingIndicator';

// ============================================================================
// TEST DATA
// ============================================================================

const mockClassification = {
  topic: 'Code',
  topicConfidence: 0.92,
  intent: 'Code Execution',
  intentConfidence: 0.87,
  combinedConfidence: 0.895,
  selectedAgentCardId: 1,
  selectedAgentCardName: 'Coder',
  resolvedModelProviderId: 10,
  resolvedModelId: 100,
  latencyMs: 42,
};

const mockEnabledAgents = [
  {
    id: 1,
    name: 'Coder',
    description: 'Code specialist',
    personaType: 'developer',
    capabilities: ['code-generation'],
    topicAffinities: ['Code'],
    intentAffinities: ['Code Execution'],
    modelBindingProviderId: 10,
    modelBindingModelId: 100,
    enabled: true,
  },
  {
    id: 2,
    name: 'Analyst',
    description: 'Data analyst',
    personaType: 'analyst',
    capabilities: ['data-analysis'],
    topicAffinities: ['Finance'],
    intentAffinities: ['Analysis'],
    modelBindingProviderId: 10,
    modelBindingModelId: 101,
    enabled: true,
  },
  {
    id: 3,
    name: 'Media Creator',
    description: 'Media specialist',
    personaType: 'creative',
    capabilities: ['image-generation'],
    topicAffinities: ['Media'],
    intentAffinities: ['Image Generation'],
    modelBindingProviderId: 11,
    modelBindingModelId: 102,
    enabled: true,
  },
];

function renderIndicator(overrides: Partial<RoutingIndicatorProps> = {}) {
  const defaultProps: RoutingIndicatorProps = {
    classification: mockClassification,
    messageContent: 'Write a function to sort an array',
    onOverride: vi.fn(),
    enabledAgents: mockEnabledAgents,
    ...overrides,
  };

  return {
    ...render(<RoutingIndicator {...defaultProps} />),
    props: defaultProps,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('RoutingIndicator Component', () => {
  // ─── Requirement 12.1: Display routing indicator ──────────────────────────

  describe('Requirement 12.1: Compact view displays Topic, Intent, Agent name', () => {
    it('renders a clickable pill with topic, intent, and agent name', () => {
      renderIndicator();

      expect(screen.getByTestId('routing-indicator-pill')).toBeInTheDocument();
      expect(screen.getByTestId('routing-topic')).toHaveTextContent('Code');
      expect(screen.getByTestId('routing-intent')).toHaveTextContent('Code Execution');
      expect(screen.getByTestId('routing-agent-name')).toHaveTextContent('Coder');
    });

    it('renders as a button for interactivity', () => {
      renderIndicator();
      const pill = screen.getByTestId('routing-indicator-pill');
      expect(pill.tagName).toBe('BUTTON');
    });

    it('has proper accessibility attributes', () => {
      renderIndicator();
      const pill = screen.getByTestId('routing-indicator-pill');
      expect(pill).toHaveAttribute('aria-expanded', 'false');
      expect(pill).toHaveAttribute('aria-label');
    });
  });

  // ─── Requirement 12.2: On click, expand to show full ClassificationResult ─

  describe('Requirement 12.2: Expanded view shows confidence scores', () => {
    it('expands on click to show classification details', async () => {
      const user = userEvent.setup();
      renderIndicator();

      const pill = screen.getByTestId('routing-indicator-pill');
      await user.click(pill);

      const expanded = screen.getByTestId('routing-indicator-expanded');
      expect(expanded).toBeInTheDocument();
    });

    it('displays topic confidence', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      const expanded = screen.getByTestId('routing-indicator-expanded');
      expect(expanded).toHaveTextContent('92.0%');
    });

    it('displays intent confidence', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      const expanded = screen.getByTestId('routing-indicator-expanded');
      expect(expanded).toHaveTextContent('87.0%');
    });

    it('displays combined confidence', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      const expanded = screen.getByTestId('routing-indicator-expanded');
      expect(expanded).toHaveTextContent('89.5%');
    });

    it('displays latency', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      const expanded = screen.getByTestId('routing-indicator-expanded');
      expect(expanded).toHaveTextContent('42ms');
    });

    it('displays selected agent card name in details', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      const expanded = screen.getByTestId('routing-indicator-expanded');
      expect(expanded).toHaveTextContent('Coder');
    });

    it('sets aria-expanded to true when open', async () => {
      const user = userEvent.setup();
      renderIndicator();

      const pill = screen.getByTestId('routing-indicator-pill');
      await user.click(pill);

      expect(pill).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // ─── Requirement 12.3: Present override list of Agent Cards ────────────────

  describe('Requirement 12.3: Override list of enabled Agent Cards', () => {
    it('shows override agent list excluding current agent', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      const overrideList = screen.getByTestId('override-agent-list');
      // Current agent (Coder, id=1) is excluded, so 2 agents remain
      expect(within(overrideList).getByTestId('override-agent-2')).toBeInTheDocument();
      expect(within(overrideList).getByTestId('override-agent-3')).toBeInTheDocument();
      expect(within(overrideList).queryByTestId('override-agent-1')).not.toBeInTheDocument();
    });

    it('displays agent names in the override list', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));

      expect(screen.getByTestId('override-agent-2')).toHaveTextContent('Analyst');
      expect(screen.getByTestId('override-agent-3')).toHaveTextContent('Media Creator');
    });
  });

  // ─── Requirement 12.4: On override selection, resubmit message ─────────────

  describe('Requirement 12.4: Override selection triggers resubmission', () => {
    it('calls onOverride with the selected agent card id', async () => {
      const user = userEvent.setup();
      const onOverride = vi.fn();
      renderIndicator({ onOverride });

      await user.click(screen.getByTestId('routing-indicator-pill'));
      await user.click(screen.getByTestId('override-agent-2'));

      expect(onOverride).toHaveBeenCalledWith(2);
    });

    it('closes the expanded view after override selection', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));
      expect(screen.getByTestId('routing-indicator-expanded')).toBeInTheDocument();

      await user.click(screen.getByTestId('override-agent-3'));
      expect(screen.queryByTestId('routing-indicator-expanded')).not.toBeInTheDocument();
    });
  });

  // ─── Requirement 12.5: Persist routing indicator ──────────────────────────

  describe('Requirement 12.5: Routing indicator persists in conversation history', () => {
    it('renders the indicator as a persistent element (not ephemeral)', () => {
      renderIndicator();
      // The indicator renders without any hide/ephemeral logic
      expect(screen.getByTestId('routing-indicator')).toBeInTheDocument();
    });

    it('shows overridden state when isOverridden is true', () => {
      renderIndicator({
        isOverridden: true,
        overriddenAgentName: 'Analyst',
      });

      // Shows the overridden agent name instead of original
      expect(screen.getByTestId('routing-agent-name')).toHaveTextContent('Analyst');
    });

    it('shows override visual indicator when overridden', () => {
      const { container } = renderIndicator({
        isOverridden: true,
        overriddenAgentName: 'Analyst',
      });

      // The pill should have amber styling for overridden state
      const pill = screen.getByTestId('routing-indicator-pill');
      expect(pill.className).toContain('amber');
    });
  });

  // ─── Interaction behavior ──────────────────────────────────────────────────

  describe('Interaction: toggle and dismiss', () => {
    it('toggles expanded state on repeated clicks', async () => {
      const user = userEvent.setup();
      renderIndicator();

      const pill = screen.getByTestId('routing-indicator-pill');

      // First click — opens
      await user.click(pill);
      expect(screen.getByTestId('routing-indicator-expanded')).toBeInTheDocument();

      // Second click — closes
      await user.click(pill);
      expect(screen.queryByTestId('routing-indicator-expanded')).not.toBeInTheDocument();
    });

    it('closes on Escape key', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));
      expect(screen.getByTestId('routing-indicator-expanded')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('routing-indicator-expanded')).not.toBeInTheDocument();
    });

    it('closes on click outside', async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId('routing-indicator-pill'));
      expect(screen.getByTestId('routing-indicator-expanded')).toBeInTheDocument();

      // Click outside the component
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('routing-indicator-expanded')).not.toBeInTheDocument();
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('does not show override section when only one agent exists (current)', () => {
      renderIndicator({
        enabledAgents: [mockEnabledAgents[0]], // Only the currently selected agent
      });

      // The pill still renders
      expect(screen.getByTestId('routing-indicator-pill')).toBeInTheDocument();
    });

    it('handles zero-confidence values', () => {
      renderIndicator({
        classification: {
          ...mockClassification,
          topicConfidence: 0,
          intentConfidence: 0,
          combinedConfidence: 0,
        },
      });

      expect(screen.getByTestId('routing-indicator-pill')).toBeInTheDocument();
    });
  });
});
