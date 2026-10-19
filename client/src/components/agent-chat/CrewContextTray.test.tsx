import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CrewContextTray } from './CrewContextTray';

describe('Selected context tray', () => {
  it('previews the selected source and removes only the selected context', () => {
    const item: any = { turnId: 42, tool: 'gmail_get_message', itemId: 'm1', item: { title: 'Meeting request', kind: 'email', platform: 'google', body: 'Meet at noon' } };
    const onRemove = vi.fn(); const onClear = vi.fn();
    render(<CrewContextTray items={[item]} onRemove={onRemove} onClear={onClear} />);
    expect(screen.getByText('Meet at noon')).not.toBeVisible();
    fireEvent.click(screen.getByText('Meeting request'));
    expect(screen.getByText('Meet at noon')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Source turn 42' })).toHaveAttribute('href', '#turn-42');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Meeting request from context' }));
    expect(onRemove).toHaveBeenCalledWith(item);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
