import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudioForm } from './StudioForm';

afterEach(cleanup);

const calculator = {
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'bill', label: 'Bill', type: 'number', required: true },
    { key: 'tip', label: 'Tip', type: 'computed', formula: 'round(bill * 0.2, 2)', format: 'number' },
  ],
};

describe('StudioForm', () => {
  it('refuses a missing required answer without calling onSubmit', async () => {
    const onSubmit = vi.fn();
    render(<StudioForm schema={calculator} onSubmit={onSubmit} submitLabel="Calculate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findAllByText(/required/i)).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the answers with their computed values, with no review step', async () => {
    const onSubmit = vi.fn();
    render(<StudioForm schema={calculator} onSubmit={onSubmit} submitLabel="Calculate" />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Bill/), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'Sam', tip: 10 });
    expect(screen.queryByText('Review your answers')).not.toBeInTheDocument();
  });

  it('fills defaults from context and hides the single page heading', () => {
    render(<StudioForm schema={{ fields: [{ key: 'vin', label: 'VIN', defaultValue: '{{ vehicle.vin }}' }] }} context={{ vehicle: { vin: 'ABC123' } }} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/VIN/)).toHaveValue('ABC123');
    expect(screen.queryByRole('heading', { name: 'Form' })).not.toBeInTheDocument();
  });

  it('does not submit while disabled', () => {
    render(<StudioForm schema={calculator} onSubmit={vi.fn()} submitLabel="Calculate" disabled />);
    expect(screen.getByRole('button', { name: 'Calculate' })).toBeDisabled();
  });
});
