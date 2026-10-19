/**
 * Unit tests for the HatMenu operational-mode card strip.
 *
 * These run against the REAL OperationalModeProvider and a real (in-memory)
 * wouter router rather than a mocked context. The previous version mocked the
 * hook out entirely, which is how the component and its context were able to
 * drift apart unnoticed — the context's open state went unused, ModeRouter
 * stopped reading the context at all, and every test stayed green about it.
 *
 * The suite also previously encoded a dropdown design the component no longer
 * has. It now describes the card strip that exists: a labelled trigger, a strip
 * of mode cards, and mode/route staying in agreement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { HatMenu } from './HatMenu';
import {
  OperationalModeProvider,
  useOperationalMode,
  MODE_LABELS,
  MODE_ROUTES,
  landingForMode,
  modeForPath,
  type OperationalMode,
} from '@/contexts/OperationalModeContext';

const STORAGE_KEY = 'oddjob:operational-mode';

/**
 * Stands in for the sidebar's hat icon, which is the menu's real trigger and
 * lives outside this component entirely. It reaches the menu the same way
 * AppSidebar does — through the context — and carries the same
 * `data-hat-menu-trigger` marker, so the click-outside interaction under test
 * is the one that actually ships.
 */
function SidebarHatStub() {
  const { isHatMenuOpen, toggleHatMenu } = useOperationalMode();
  return (
    <button
      type="button"
      onClick={toggleHatMenu}
      aria-expanded={isHatMenuOpen}
      data-hat-menu-trigger=""
      data-testid="hat-menu-toggle"
    >
      hat
    </button>
  );
}

function renderMenu(
  { path = '/workspace/chat', ...props }: { path?: string; defaultMode?: OperationalMode } = {},
) {
  const { hook, history } = memoryLocation({ path, record: true });
  const view = render(
    <Router hook={hook}>
      <OperationalModeProvider>
        <SidebarHatStub />
        <HatMenu {...props} />
        <div data-testid="outside">Outside</div>
      </OperationalModeProvider>
    </Router>,
  );
  return { ...view, history };
}

const openStrip = async () => {
  await userEvent.click(screen.getByTestId('hat-menu-toggle'));
  return screen.getByTestId('hat-menu-cards');
};

/** Which mode the strip currently marks active. Opens it if needed. */
async function activeMode(): Promise<string | undefined> {
  if (!screen.queryByTestId('hat-menu-cards')) await openStrip();
  return Object.keys(MODE_LABELS).find(
    mode => screen.getByTestId(`hat-mode-card-${mode}`).getAttribute('data-active') === 'true',
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('HatMenu trigger', () => {
  it('is closed on first render', () => {
    renderMenu();

    // It used to default to open, so the strip covered content on every mount.
    expect(screen.queryByTestId('hat-menu-cards')).toBeNull();
    expect(screen.getByTestId('hat-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders no trigger of its own', () => {
    // The sidebar's hat icon is the trigger. HatMenu briefly grew a second,
    // inline one, which both duplicated the control and left the sidebar icon
    // dead — it had been reaching the menu through a window global that the
    // move to context removed.
    const { container } = renderMenu();

    expect(container.querySelector('[data-testid="hat-menu-container"] button')).toBeNull();
  });

  it('opens and closes from the external trigger on repeated clicks', async () => {
    // Regression: the trigger sits outside HatMenu's subtree, so click-outside
    // treated it as outside — mousedown closed the strip and the click that
    // followed reopened it, so the icon could never close what it opened.
    renderMenu();

    await openStrip();
    expect(screen.getByTestId('hat-menu-toggle')).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByTestId('hat-menu-toggle'));
    expect(screen.queryByTestId('hat-menu-cards')).toBeNull();
    expect(screen.getByTestId('hat-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('HatMenu cards', () => {
  it.each(['/apps', '/knowledge', '/insights'])('loads the chat SPA when selected from %s', async (path) => {
    const assign = vi.fn();
    const originalLocation = window.location;
    vi.stubGlobal('location', { ...originalLocation, assign });
    try {
      const { history } = renderMenu({ path });
      await openStrip();
      await userEvent.click(screen.getByTestId('hat-mode-card-agent-chat'));
      expect(assign).toHaveBeenCalledWith('/workspace/chat');
      expect(history.at(-1)).toBe(path);
      expect(screen.queryByTestId('hat-menu-cards')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses a mobile overlay with stacked touch targets and a desktop card strip', async () => {
    renderMenu();
    const strip = await openStrip();

    expect(strip).toHaveClass('fixed', 'inset-x-3', 'top-16', 'md:static');
    expect(screen.getByTestId('hat-menu-card-grid')).toHaveClass('grid-cols-1', 'sm:grid-cols-3');
    expect(screen.getByTestId('hat-mode-card-agent-chat')).toHaveClass('min-h-16', 'sm:flex-col');
  });

  it('shows one card per mode, labelled from the shared label map', async () => {
    renderMenu();
    const strip = await openStrip();

    const cards = within(strip).getAllByRole('menuitem');
    expect(cards).toHaveLength(3);
    for (const [mode, label] of Object.entries(MODE_LABELS)) {
      expect(screen.getByTestId(`hat-mode-card-${mode}`)).toHaveTextContent(label);
    }
  });

  it('marks only the active mode', async () => {
    renderMenu();
    await openStrip();

    expect(screen.getByTestId('hat-mode-card-agent-chat')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('hat-mode-card-feeds-cycles')).not.toHaveAttribute('data-active');
    expect(screen.getByTestId('hat-mode-card-h3-spatial-watch')).not.toHaveAttribute('data-active');
  });

  it('switches mode, navigates and closes when a card is picked', async () => {
    const { history } = renderMenu();
    await openStrip();

    await userEvent.click(screen.getByTestId('hat-mode-card-feeds-cycles'));

    await waitFor(() => expect(screen.queryByTestId('hat-menu-cards')).toBeNull());
    // Navigates to the mode's LANDING page, which for Feeds & Cycles is the
    // Launchpad — deliberately not its identity route.
    expect(history.at(-1)).toBe('/launchpad');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('feeds-cycles');
    expect(await activeMode()).toBe('feeds-cycles');
  });

  it('still navigates when the already-active card is picked', async () => {
    // The recovery path: if mode and route ever disagree, the active card has
    // to be able to put you back on its route rather than just closing.
    const { history } = renderMenu({ path: '/workspace/chat' });
    await openStrip();

    await userEvent.click(screen.getByTestId('hat-mode-card-agent-chat'));

    expect(history.at(-1)).toBe('/workspace/chat');
    expect(screen.queryByTestId('hat-menu-cards')).toBeNull();
  });
});

describe('HatMenu dismissal', () => {
  it('closes on Escape', async () => {
    renderMenu();
    await openStrip();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('hat-menu-cards')).toBeNull());
  });

  it('closes when clicking outside', async () => {
    renderMenu();
    await openStrip();

    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() => expect(screen.queryByTestId('hat-menu-cards')).toBeNull());
  });

  it('stays open when clicking inside the strip', async () => {
    renderMenu();
    const strip = await openStrip();

    fireEvent.mouseDown(strip);

    expect(screen.getByTestId('hat-menu-cards')).toBeInTheDocument();
  });
});

describe('HatMenu keyboard navigation', () => {
  it('focuses the active card when opened', async () => {
    renderMenu();
    await openStrip();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('hat-mode-card-agent-chat')),
    );
  });

  it('moves focus with arrow keys and wraps at both ends', async () => {
    renderMenu();
    await openStrip();
    const [first, second, third] = ['agent-chat', 'feeds-cycles', 'h3-spatial-watch']
      .map(mode => screen.getByTestId(`hat-mode-card-${mode}`));

    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(third);

    // Wraps forward…
    fireEvent.keyDown(third, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);

    // …and backward.
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(third);
  });

  it('treats vertical arrows the same as horizontal ones', async () => {
    renderMenu();
    await openStrip();
    const first = screen.getByTestId('hat-mode-card-agent-chat');
    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('hat-mode-card-feeds-cycles'));

    fireEvent.keyDown(screen.getByTestId('hat-mode-card-feeds-cycles'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('jumps to the ends with Home and End', async () => {
    renderMenu();
    await openStrip();
    const first = screen.getByTestId('hat-mode-card-agent-chat');
    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('hat-mode-card-h3-spatial-watch'));

    fireEvent.keyDown(screen.getByTestId('hat-mode-card-h3-spatial-watch'), { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });
});

describe('HatMenu mode and route agreement', () => {
  it('adopts the mode of the route it was rendered on', async () => {
    renderMenu({ path: '/workspace/spatial' });

    expect(await activeMode()).toBe('h3-spatial-watch');
  });

  it('corrects a persisted mode that contradicts the route', async () => {
    // Previously only /workspace/spatial self-corrected, so deep-linking to any
    // other mode's route left the strip highlighting the wrong one.
    localStorage.setItem(STORAGE_KEY, 'agent-chat');

    renderMenu({ path: '/workspace/feeds' });

    expect(await activeMode()).toBe('feeds-cycles');
  });

  it('does not let a general app route claim a mode', async () => {
    // The defect this guards: feeds-cycles was routed to '/dashboard', an
    // ordinary top-level page with its own sidebar link. modeForPath therefore
    // claimed it, so merely clicking "Dashboard" in the sidebar switched the
    // active mode to Feeds & Cycles and PERSISTED it — leaving the wrong card
    // highlighted for a navigation that had nothing to do with modes.
    localStorage.setItem(STORAGE_KEY, 'agent-chat');

    renderMenu({ path: '/dashboard' });

    expect(await activeMode()).toBe('agent-chat');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('agent-chat');
  });

  it('does not let /dashboard sub-routes claim a mode either', async () => {
    // '/dashboard/costs' and '/dashboard/forms' are redirects to unrelated
    // surfaces, but the old prefix match ("startsWith('/dashboard/')") caught
    // them too.
    localStorage.setItem(STORAGE_KEY, 'agent-chat');

    renderMenu({ path: '/dashboard/costs' });

    expect(await activeMode()).toBe('agent-chat');
  });

  it('does not let a landing page claim a mode', async () => {
    // The Launchpad is where Feeds & Cycles LANDS, but it has its own sidebar
    // entry. If it were also the mode's identity route, clicking "Launchpad"
    // would flip and persist the mode — the exact defect that made /dashboard
    // hijack it.
    localStorage.setItem(STORAGE_KEY, 'agent-chat');

    renderMenu({ path: '/launchpad' });

    expect(await activeMode()).toBe('agent-chat');
    expect(modeForPath('/launchpad')).toBeNull();
  });

  it('lands Feeds & Cycles on the Launchpad', () => {
    expect(landingForMode('feeds-cycles')).toBe('/launchpad');
    // Its identity is unchanged, so /workspace/feeds still resolves the mode.
    expect(MODE_ROUTES['feeds-cycles']).toBe('/workspace/feeds');
    expect(modeForPath('/workspace/feeds')).toBe('feeds-cycles');
  });

  it('defaults a landing page to the identity route', () => {
    // Only feeds-cycles overrides; the rest must not silently diverge.
    for (const mode of ['agent-chat', 'h3-spatial-watch'] as const) {
      expect(landingForMode(mode)).toBe(MODE_ROUTES[mode]);
    }
  });

  it('keeps every mode route inside the /workspace namespace', async () => {
    // ModeRouter is mounted only at /workspace and /workspace/:rest*. A mode
    // whose route falls outside that namespace navigates somewhere that cannot
    // render its panel at all, which is exactly how feeds-cycles broke.
    for (const route of Object.values(MODE_ROUTES)) {
      expect(route.startsWith('/workspace/')).toBe(true);
      // Single trailing segment: wouter's :rest* matches only one.
      expect(route.replace('/workspace/', '').split('/')).toHaveLength(1);
    }
  });

  it('leaves the mode alone on a route that belongs to no mode', async () => {
    localStorage.setItem(STORAGE_KEY, 'feeds-cycles');

    renderMenu({ path: '/projects' });

    expect(await activeMode()).toBe('feeds-cycles');
  });
});

describe('HatMenu defaultMode', () => {
  it('applies defaultMode when the user has never chosen one', async () => {
    renderMenu({ path: '/projects', defaultMode: 'feeds-cycles' });

    expect(await activeMode()).toBe('feeds-cycles');
  });

  it('does not overwrite a mode the user already chose', async () => {
    // defaultMode used to be applied unconditionally through setMode, which
    // persists — silently erasing the user's last choice on every mount.
    localStorage.setItem(STORAGE_KEY, 'h3-spatial-watch');

    renderMenu({ path: '/projects', defaultMode: 'feeds-cycles' });

    expect(await activeMode()).toBe('h3-spatial-watch');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('h3-spatial-watch');
  });
});
