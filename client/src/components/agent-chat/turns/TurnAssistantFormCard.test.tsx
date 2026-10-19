import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
// The form renderer is not under test: one button that submits fixed answers.
vi.mock('@/modules/forms/StudioForm', () => ({
  StudioForm: ({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => Promise<void> }) => (
    <button type="button" onClick={() => void onSubmit({ response: 'Approve' })}>Submit</button>
  ),
}));

const { TurnAssistantFormCard } = await import('./TurnAssistantFormCard');

const payload = {
  type: 'input_request',
  title: 'App HIL: Vendor Portal',
  description: 'Approve the new vendor?',
  requestId: 41,
  formId: 41,
  schema: { fields: [{ key: 'response', type: 'text', label: 'Response', required: true }] },
};

describe('TurnAssistantFormCard input request', () => {
  beforeEach(() => { apiRequest.mockReset(); });

  it('submits the request, then tells the room', async () => {
    apiRequest.mockResolvedValue({ ok: true });
    const onArtifactSubmit = vi.fn();
    render(<TurnAssistantFormCard payload={payload} onArtifactSubmit={onArtifactSubmit} />);

    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(onArtifactSubmit).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/oddjob/forms/41/submit', { data: { response: 'Approve' } });
    expect(screen.queryByTestId('input-request-error')).toBeNull();
  });

  it('shows why a refused submission failed and does not announce it', async () => {
    apiRequest.mockRejectedValue(new Error('"App HIL: Vendor Portal" is completed, so it cannot be submitted.'));
    const onArtifactSubmit = vi.fn();
    render(<TurnAssistantFormCard payload={payload} onArtifactSubmit={onArtifactSubmit} />);

    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByTestId('input-request-error')).toHaveTextContent(/Not submitted: .*is completed/);
    expect(onArtifactSubmit).not.toHaveBeenCalled();
  });
});
