import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
import { CrewDevelopmentSetup } from './CrewDevelopmentSetup';

describe('development setup', () => {
  beforeEach(() => request.mockReset());
  it('browses real cycle options and saves only the selected configuration', async () => {
    request.mockResolvedValueOnce({ json: async () => ({ cycles: [{ id: 7, name: 'Development test', status: 'planning' }], projectId: null, current: {} }) })
      .mockResolvedValueOnce({ json: async () => ({}) });
    const onSaved = vi.fn();
    render(<CrewDevelopmentSetup roomKey="room" organizationId={342} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure development' }));
    await screen.findByRole('option', { name: 'Development test · planning · #7' });
    fireEvent.change(screen.getByLabelText('Development cycle'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Repository URL'), { target: { value: 'https://github.com/example/project' } });
    fireEvent.change(screen.getByLabelText('Working branch'), { target: { value: 'codex/test' } });
    fireEvent.change(screen.getByLabelText('Test environment'), { target: { value: 'isolated fixture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(request).toHaveBeenLastCalledWith('PUT', '/api/crew/room/development-binding?orgId=342', { cycleId: 7, repositoryUrl: 'https://github.com/example/project', branch: 'codex/test', testEnvironment: 'isolated fixture' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
