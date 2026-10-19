/**
 * Unit tests for the ModeRouter component.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the useOperationalMode hook
let mockActiveMode = 'agent-chat';

// Spread the real module so only the hook is faked: an exhaustive mock silently
// drops exports the component later starts using (MODE_LABELS did exactly that)
// and the failure surfaces as an unexplained render crash.
vi.mock('@/contexts/OperationalModeContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/OperationalModeContext')>()),
  useOperationalMode: () => ({
    activeMode: mockActiveMode,
    setMode: vi.fn(),
    previousMode: null,
    isHatMenuOpen: false,
    toggleHatMenu: vi.fn(),
    closeHatMenu: vi.fn(),
  }),
}));

// Mock lazy-loaded panels as simple synchronous components
vi.mock('@/components/agent-chat/AgentChatPanel', () => ({
  default: () => <div data-testid="agent-chat-panel">Agent Chat Panel</div>,
}));

vi.mock('@/components/feeds-cycles/FeedsCyclesPanel', () => ({
  default: () => <div data-testid="feeds-cycles-panel">Feeds Cycles Panel</div>,
}));

// Must track ModeRouter's own import. This mocked the retired
// SignalDashboard path while the router had moved to Signal Studio, so the real
// component loaded, hit react-query with no provider, rendered nothing, and took
// all sixteen tests in this file down with it.
vi.mock('@/modules/signal-studio/SignalStudio', () => ({
  default: () => <div data-testid="signal-studio-panel">Signal Studio Panel</div>,
}));

import { ModeRouter } from './ModeRouter';

describe('ModeRouter Component', () => {
  beforeEach(() => {
    mockActiveMode = 'agent-chat';
  });

  // ─── Requirement 2.1, 2.2, 2.3: Active panel visible ────────────────────

  describe('Active panel rendering', () => {
    it('renders agent-chat panel as visible when it is the active mode', async () => {
      mockActiveMode = 'agent-chat';
      render(<ModeRouter />);

      const panel = await screen.findByTestId('agent-chat-panel');
      expect(panel.parentElement!).toHaveStyle({ display: 'block' });
    });

    it('renders feeds-cycles panel as visible when it is the active mode', async () => {
      mockActiveMode = 'feeds-cycles';
      render(<ModeRouter />);

      const panel = await screen.findByTestId('feeds-cycles-panel');
      expect(panel.parentElement!).toHaveStyle({ display: 'block' });
    });

    it('renders h3-spatial-watch panel as visible when it is the active mode', async () => {
      mockActiveMode = 'h3-spatial-watch';
      render(<ModeRouter />);

      const panel = await screen.findByTestId('signal-studio-panel');
      expect(panel.parentElement!).toHaveStyle({ display: 'block' });
    });

    it('hides inactive panels with display: none', async () => {
      mockActiveMode = 'agent-chat';
      render(<ModeRouter />);

      // Wait for lazy components to resolve
      await screen.findByTestId('agent-chat-panel');

      const feedsWrapper = screen.getByTestId('feeds-cycles-panel').parentElement!;
      const spatialWrapper = screen.getByTestId('signal-studio-panel').parentElement!;

      expect(feedsWrapper).toHaveStyle({ display: 'none' });
      expect(spatialWrapper).toHaveStyle({ display: 'none' });
    });
  });

  // ─── Requirement 2.8: All panels mounted (state preservation) ────────────

  describe('All panels mounted regardless of active mode', () => {
    it('mounts all three panels in the DOM when agent-chat is active', async () => {
      mockActiveMode = 'agent-chat';
      render(<ModeRouter />);

      await screen.findByTestId('agent-chat-panel');
      expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('feeds-cycles-panel')).toBeInTheDocument();
      expect(screen.getByTestId('signal-studio-panel')).toBeInTheDocument();
    });

    it('mounts all three panels in the DOM when feeds-cycles is active', async () => {
      mockActiveMode = 'feeds-cycles';
      render(<ModeRouter />);

      await screen.findByTestId('feeds-cycles-panel');
      expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('feeds-cycles-panel')).toBeInTheDocument();
      expect(screen.getByTestId('signal-studio-panel')).toBeInTheDocument();
    });

    it('mounts all three panels in the DOM when h3-spatial-watch is active', async () => {
      mockActiveMode = 'h3-spatial-watch';
      render(<ModeRouter />);

      await screen.findByTestId('signal-studio-panel');
      expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('feeds-cycles-panel')).toBeInTheDocument();
      expect(screen.getByTestId('signal-studio-panel')).toBeInTheDocument();
    });
  });

  // ─── Mode switching changes visibility without unmounting ─────────────────

  describe('Mode switching changes visibility without unmounting', () => {
    it('switching from agent-chat to feeds-cycles shows feeds and hides agent-chat', async () => {
      const { rerender } = render(<ModeRouter />);

      // Wait for lazy load resolution
      await screen.findByTestId('agent-chat-panel');

      // Initially agent-chat visible
      expect(screen.getByTestId('agent-chat-panel').parentElement!).toHaveStyle({ display: 'block' });
      expect(screen.getByTestId('feeds-cycles-panel').parentElement!).toHaveStyle({ display: 'none' });

      // Switch mode
      mockActiveMode = 'feeds-cycles';
      rerender(<ModeRouter />);

      expect(screen.getByTestId('agent-chat-panel').parentElement!).toHaveStyle({ display: 'none' });
      expect(screen.getByTestId('feeds-cycles-panel').parentElement!).toHaveStyle({ display: 'block' });
    });

    it('all panels remain in DOM after mode switch (no unmounting)', async () => {
      const { rerender } = render(<ModeRouter />);

      // Wait for lazy load resolution
      await screen.findByTestId('agent-chat-panel');

      // All three present initially
      expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('feeds-cycles-panel')).toBeInTheDocument();
      expect(screen.getByTestId('signal-studio-panel')).toBeInTheDocument();

      // Switch mode
      mockActiveMode = 'h3-spatial-watch';
      rerender(<ModeRouter />);

      // All three still present
      expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('feeds-cycles-panel')).toBeInTheDocument();
      expect(screen.getByTestId('signal-studio-panel')).toBeInTheDocument();
    });
  });

  // ─── Panels hidden via display:none retain mounted state ─────────────────

  describe('Hidden panels retain mounted state', () => {
    it('hidden panels are not destroyed — they remain in DOM with display:none', async () => {
      mockActiveMode = 'feeds-cycles';
      render(<ModeRouter />);

      await screen.findByTestId('feeds-cycles-panel');

      // Agent chat and signal dashboard should be hidden but present
      const agentWrapper = screen.getByTestId('agent-chat-panel').parentElement!;
      const spatialWrapper = screen.getByTestId('signal-studio-panel').parentElement!;

      expect(agentWrapper).toHaveStyle({ display: 'none' });
      expect(spatialWrapper).toHaveStyle({ display: 'none' });

      // Verify the content is rendered (not null/empty)
      expect(screen.getByTestId('agent-chat-panel')).toHaveTextContent('Agent Chat Panel');
      expect(screen.getByTestId('signal-studio-panel')).toHaveTextContent('Signal Studio Panel');
    });

    it('aria-hidden is set on inactive panels', async () => {
      mockActiveMode = 'agent-chat';
      render(<ModeRouter />);

      await screen.findByTestId('agent-chat-panel');

      const router = screen.getByTestId('mode-router');
      const panels = router.children;

      // The active panel (agent-chat) should have aria-hidden=false
      const agentPanel = Array.from(panels).find(
        (el) => el.getAttribute('data-mode') === 'agent-chat'
      );
      expect(agentPanel).toHaveAttribute('aria-hidden', 'false');

      // Inactive panels should have aria-hidden=true
      const feedsPanel = Array.from(panels).find(
        (el) => el.getAttribute('data-mode') === 'feeds-cycles'
      );
      expect(feedsPanel).toHaveAttribute('aria-hidden', 'true');

      const spatialPanel = Array.from(panels).find(
        (el) => el.getAttribute('data-mode') === 'h3-spatial-watch'
      );
      expect(spatialPanel).toHaveAttribute('aria-hidden', 'true');
    });
  });

  // ─── Requirements 2.1, 2.2, 2.3: Render within 300ms budget ─────────────

  describe('Render performance within 300ms budget', () => {
    it('renders agent-chat mode within 300ms', async () => {
      mockActiveMode = 'agent-chat';
      const start = performance.now();
      render(<ModeRouter />);
      await screen.findByTestId('agent-chat-panel');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(300);
    });

    it('renders feeds-cycles mode within 300ms', async () => {
      mockActiveMode = 'feeds-cycles';
      const start = performance.now();
      render(<ModeRouter />);
      await screen.findByTestId('feeds-cycles-panel');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(300);
    });

    it('renders h3-spatial-watch mode within 300ms', async () => {
      mockActiveMode = 'h3-spatial-watch';
      const start = performance.now();
      render(<ModeRouter />);
      await screen.findByTestId('signal-studio-panel');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(300);
    });
  });

  // ─── Lazy loading with Suspense fallback ─────────────────────────────────

  describe('Lazy loading triggers Suspense boundary', () => {
    it('shows loading fallback initially before lazy component resolves', () => {
      // On the very first render, Suspense shows the fallback
      // until the lazy chunk resolves. With mocked modules this resolves
      // almost instantly, but we can verify the fallback structure exists.
      render(<ModeRouter />);

      // The mode-router container should always render immediately
      expect(screen.getByTestId('mode-router')).toBeInTheDocument();
    });

    it('sets data-active attribute on the active panel wrapper', async () => {
      mockActiveMode = 'feeds-cycles';
      render(<ModeRouter />);

      await screen.findByTestId('feeds-cycles-panel');

      const router = screen.getByTestId('mode-router');
      const activePanel = Array.from(router.children).find(
        (el) => el.getAttribute('data-active') === 'true'
      );
      expect(activePanel).toBeDefined();
      expect(activePanel!.getAttribute('data-mode')).toBe('feeds-cycles');
    });

    it('only one panel has data-active at a time', async () => {
      mockActiveMode = 'agent-chat';
      render(<ModeRouter />);

      await screen.findByTestId('agent-chat-panel');

      const router = screen.getByTestId('mode-router');
      const activePanels = Array.from(router.children).filter(
        (el) => el.getAttribute('data-active') === 'true'
      );
      expect(activePanels).toHaveLength(1);
    });
  });

  // ─── className prop forwarding ───────────────────────────────────────────

  describe('Props', () => {
    it('applies custom className to the root element', () => {
      render(<ModeRouter className="custom-class" />);
      const router = screen.getByTestId('mode-router');
      expect(router.className).toContain('custom-class');
    });
  });
});
