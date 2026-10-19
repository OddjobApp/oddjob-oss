import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { CREW_APP_ACTIVITY_BRIDGE } from './crew-app-activity-bridge.js';

function mount(search: string, pathname = '/app/it-portal/tickets') {
  const styles: Array<{ textContent: string }> = [];
  const parent = { postMessage: vi.fn() };
  const win: Record<string, any> = { addEventListener: vi.fn(), dispatchEvent: vi.fn() };
  const history = {
    pushState: vi.fn(),
    replaceState: vi.fn(),
  };
  const document = { createElement: () => ({ textContent: '' }), head: { appendChild: (style: { textContent: string }) => styles.push(style) } };
  runInNewContext(CREW_APP_ACTIVITY_BRIDGE.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''), {
    location: { search, pathname, origin: 'http://localhost:5000' }, URLSearchParams,
    document, parent, window: win, history,
    fetch: () => new Promise(() => {}), setInterval: vi.fn(), clearInterval: vi.fn(),
  });
  return { styles, parent, window: win, history };
}

describe('CREW app presentation & navigation bridge', () => {
  it('leaves standalone workbench assistants visible', () => {
    expect(mount('?embedded=true').styles).toEqual([]);
  });

  it('hides both current and already-built assistant panels and reclaims their columns in CREW', () => {
    const { styles } = mount('?crewRoom=room&crewActivity=chat');
    const [style] = styles;
    expect(style.textContent).toContain('[data-workbench-agent-chat]');
    expect(style.textContent).toContain('Ask the agent a question...');
    expect(style.textContent).toContain('grid-template-columns:minmax(0,1fr)');
    expect(style.textContent).not.toMatch(/:has\([^(){}]*:has\(/);
  });

  it('emits crew-app-view on navigation and when window.oddjobCrew.setSelectedRecord is called', () => {
    const { parent, window: win, history } = mount('?crewRoom=room&crewActivity=chat', '/tickets');
    expect(parent.postMessage).toHaveBeenCalledWith(
      { source: 'crew-app-view', version: 1, roomKey: 'room', pathname: '/tickets' },
      'http://localhost:5000'
    );

    win.oddjobCrew.setSelectedRecord({ collection: 'it_service_desk_tickets', recordId: 'TKT-1042' });
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      {
        source: 'crew-app-view',
        version: 1,
        roomKey: 'room',
        pathname: '/tickets',
        selectedRecord: { collection: 'it_service_desk_tickets', recordId: 'TKT-1042' },
      },
      'http://localhost:5000'
    );

    history.pushState({}, '', '/agent-triage');
    expect(parent.postMessage).toHaveBeenCalledTimes(3);
  });
});
