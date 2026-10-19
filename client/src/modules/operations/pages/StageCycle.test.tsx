import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StageCycle from './StageCycle';

// Mock the external hooks and components
// Spread the real module rather than replacing it: client/src/lib/queryClient.ts
// constructs `new QueryClient(...)` at import time, and a factory that returned only
// the two hooks left QueryClient undefined, so the whole suite failed to collect.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: null, isLoading: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('wouter', () => ({
  useRoute: () => [false, {}],
  useLocation: () => ['/operations/cycles/new', vi.fn()],
}));

describe('StageCycle Component', () => {
  it('renders without crashing and uses full width layout', () => {
    const { container } = render(<StageCycle />);
    
    // Intent: the page spans the container with no arbitrary max-width constraint.
    // Asserted against that property rather than an exact class list — this used to
    // require `max-w-full mx-auto` and broke when the wrapper was refactored to the
    // equivalent `w-full`, which is the same layout.
    const mainWrapper = container.firstChild as HTMLElement;
    const classes = mainWrapper.className.split(/\s+/);

    expect(classes.some(c => c === 'w-full' || c === 'max-w-full')).toBe(true);
    // e.g. max-w-7xl / max-w-4xl / max-w-screen-lg would constrain the page.
    expect(classes.filter(c => c.startsWith('max-w-') && c !== 'max-w-full')).toEqual([]);
    
    // Step 0 should render initially. The heading is "Stage New <span>Cycle</span>",
    // so the text is split across elements and getByText cannot match it — assert
    // against the heading's textContent instead.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Stage New Cycle/i);
  });
});
