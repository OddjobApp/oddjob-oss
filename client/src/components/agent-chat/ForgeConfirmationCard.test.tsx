import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgeConfirmationCard } from './ForgeConfirmationCard';

const PAYLOAD = {
  type: 'forge_confirmation_card' as const,
  name: 'Warehouse Inventory',
  requirements: 'track pallets in and out of the yard',
};

afterEach(cleanup);

describe('ForgeConfirmationCard', () => {
  it('shows what will be built before anything is provisioned', () => {
    render(<ForgeConfirmationCard payload={PAYLOAD} onArtifactSubmit={vi.fn()} />);

    expect(screen.getByTestId('forge-confirm-name')).toHaveValue('Warehouse Inventory');
    expect(screen.getByTestId('forge-confirm-requirements')).toHaveTextContent('track pallets in and out');
  });

  /*
   * The exact string the orchestrator's parser accepts. If this drifts, the
   * button stops starting builds — silently, because a message that does not
   * parse just falls through to ordinary conversation.
   */
  it('confirms with the precise string the orchestrator parses', async () => {
    const onArtifactSubmit = vi.fn();
    render(<ForgeConfirmationCard payload={PAYLOAD} onArtifactSubmit={onArtifactSubmit} />);

    fireEvent.click(screen.getByTestId('forge-confirm-build'));

    expect(onArtifactSubmit).toHaveBeenCalledWith('Build "Warehouse Inventory" now.');
  });

  it('carries an edited name into the confirmation', async () => {
    const onArtifactSubmit = vi.fn();
    render(<ForgeConfirmationCard payload={PAYLOAD} onArtifactSubmit={onArtifactSubmit} />);

    const input = screen.getByTestId('forge-confirm-name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Yard Tracker');
    fireEvent.click(screen.getByTestId('forge-confirm-build'));

    expect(onArtifactSubmit).toHaveBeenCalledWith('Build "Yard Tracker" now.');
  });

  /*
   * Each press provisions a container. A double click must not buy two.
   */
  it('cannot start two builds', () => {
    const onArtifactSubmit = vi.fn();
    render(<ForgeConfirmationCard payload={PAYLOAD} onArtifactSubmit={onArtifactSubmit} />);

    const button = screen.getByTestId('forge-confirm-build');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onArtifactSubmit).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it('will not build something with no name', async () => {
    const onArtifactSubmit = vi.fn();
    render(<ForgeConfirmationCard payload={PAYLOAD} onArtifactSubmit={onArtifactSubmit} />);

    await userEvent.clear(screen.getByTestId('forge-confirm-name'));

    expect(screen.getByTestId('forge-confirm-build')).toBeDisabled();
    fireEvent.click(screen.getByTestId('forge-confirm-build'));
    expect(onArtifactSubmit).not.toHaveBeenCalled();
  });
});
