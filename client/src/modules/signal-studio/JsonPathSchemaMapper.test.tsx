import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { JsonPathSchemaMapper } from './JsonPathSchemaMapper';

vi.mock('@domain-ui/core/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(async (method: string, path: string, body?: any) => {
    if (path.includes('/test-mapping')) {
      return {
        json: async () => ({
          success: true,
          event: {
            sourceEntryId: '368924000',
            eventType: 'Operational_Disruption',
            targetSector: 'Supply_Chain',
            jurisdiction: 'Port of Long Beach',
            severity: 'High',
            latitude: 33.7432,
            longitude: -118.2673,
            h3Index: '8729a435bffffff',
            subjectId: 'PACIFIC CARRIER',
            rawText: 'Excessive berth dwell time at Long Beach Terminal Pier 400',
          },
          errors: [],
        }),
      };
    }
    if (path.includes('/infer-schema')) {
      return {
        json: async () => ({
          title: 'InferredSchema',
          totalFieldsCount: 5,
          confidenceAverage: 0.95,
        }),
      };
    }
    return { json: async () => ({}) };
  }),
}));

describe('JsonPathSchemaMapper', () => {
  it('renders the mapping studio with presets and fields', () => {
    render(<JsonPathSchemaMapper />);

    expect(screen.getByText(/JSONPath Schema Mapping Studio/i)).toBeInTheDocument();
    expect(screen.getByText(/Live Ingress Webhook Endpoint/i)).toBeInTheDocument();
    expect(screen.getByText(/Inbound Sample Payload/i)).toBeInTheDocument();
    expect(screen.getByText(/Universal Event Primitive Mappings/i)).toBeInTheDocument();

    // Check presets
    expect(screen.getByRole('button', { name: /maritime/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /power/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /distressed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cyber/i })).toBeInTheDocument();
  });

  it('switches presets and updates payload and mapping', () => {
    render(<JsonPathSchemaMapper />);

    const energyBtn = screen.getByRole('button', { name: /power/i });
    fireEvent.click(energyBtn);

    const textarea = screen.getByPlaceholderText(/Paste raw JSON payload/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('ERCOT-FREQ-8821');
  });

  it('runs test mapping and renders the transformed event preview', async () => {
    render(<JsonPathSchemaMapper />);

    const testBtn = screen.getByRole('button', { name: /test mapping/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText(/Valid Primitive/i)).toBeInTheDocument();
      // Shown in the preview and in the success toast.
      expect(screen.getAllByText(/8729a435bffffff/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/PACIFIC CARRIER/i).length).toBeGreaterThan(0);
    });
  });
});
