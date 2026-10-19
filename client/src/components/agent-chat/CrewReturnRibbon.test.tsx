import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const route = vi.hoisted(() => ({ location: '/workspace/chat/room1' }));
vi.mock('wouter', () => ({ useLocation: () => [route.location] }));
import { CrewReturnRibbon, readReturnRoom } from './CrewReturnRibbon';
afterEach(() => { cleanup(); sessionStorage.clear(); });
describe('Return to CREW', () => {
  it('preserves the room and organization across navigation and reload, and can be dismissed', () => {
    route.location = '/workspace/chat/room1';
    window.history.replaceState({}, '', '/workspace/chat/room1?orgId=342');
    const view = render(<CrewReturnRibbon />);
    expect(screen.queryByRole('navigation')).toBeNull();
    route.location = '/settings'; window.history.replaceState({}, '', '/settings?orgId=342');
    view.rerender(<CrewReturnRibbon />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/workspace/chat/room1?orgId=342');
    view.unmount(); render(<CrewReturnRibbon />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/workspace/chat/room1?orgId=342');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss return-to-room ribbon' }));
    expect(screen.queryByRole('navigation')).toBeNull();
  });
  it('rejects external destinations and hides the ribbon in a different organization', () => {
    expect(readReturnRoom(JSON.stringify({ href: 'https://example.com/workspace/chat/room1', title: 'Room' }))).toBeNull();
    sessionStorage.setItem('crew-return-room', JSON.stringify({ href: '/workspace/chat/room1?orgId=342', title: 'Room' }));
    route.location = '/settings'; window.history.replaceState({}, '', '/settings?orgId=473');
    render(<CrewReturnRibbon />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
