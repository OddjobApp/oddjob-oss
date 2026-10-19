import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { appNavigationGuard } from './app-navigation-guard.js';

function click(href: string, overrides: Record<string, unknown> = {}) {
  let listener: (event: any) => void = () => {};
  const assign = vi.fn();
  const location = { pathname: '/app/sdlc-workbench-fszvh', origin: 'http://localhost:5000', search: '?crewRoom=room&orgId=342&embedded=true&crewActivity=chat', assign };
  runInNewContext(appNavigationGuard('sdlc-workbench-fszvh').replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''), {
    window: { location }, location, URL, URLSearchParams,
    document: { addEventListener: (_name: string, callback: typeof listener) => { listener = callback; } },
  });
  const event = { target: { closest: () => ({ target: '', getAttribute: () => href }) }, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), button: 0, ...overrides };
  listener(event);
  return { assign, event };
}

describe('proxied app navigation', () => {
  it('keeps destination filters and hash, carries room context, and prevents competing SPA navigation', () => {
    const { assign, event } = click('/pm-workbench?tab=backlog#review');
    expect(assign).toHaveBeenCalledWith('/app/sdlc-workbench-fszvh/pm-workbench?tab=backlog&crewRoom=room&crewActivity=chat&orgId=342&embedded=true&embed=cycle#review');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });
  it.each(['/api/records', '/auth/login', '/app/other', '//example.com', 'https://example.com', '#details'])('leaves reserved or external destination %s alone', href => {
    expect(click(href).assign).not.toHaveBeenCalled();
  });
  it('preserves modified and middle-click browser behavior', () => {
    expect(click('/pm-workbench', { ctrlKey: true }).assign).not.toHaveBeenCalled();
    expect(click('/pm-workbench', { button: 1 }).assign).not.toHaveBeenCalled();
  });
});
