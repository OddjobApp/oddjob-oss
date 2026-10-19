import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@domain-ui/core/ui/components/packaged/registry', () => ({
  getLazyPackagedComponent: (module: string) => (props: Record<string, unknown>) => (
    <div data-testid={`gallery-component-${module}`}>{String(props.title || module)}</div>
  ),
}));

import { createGalleryFallbackAssembly, ForgeLiveAssemblyPreview, type LiveAssemblyModel } from './ForgeLiveAssemblyPreview';

const assembly: LiveAssemblyModel = {
  title: 'Service Desk',
  slug: 'service-desk',
  source: 'component-gallery',
  phase: 'assembling',
  activeTask: 'Writing routes',
  updatedAt: '2026-09-01T00:00:00.000Z',
  previewUrl: 'http://localhost:5050/service-desk',
  files: ['src/App.tsx', 'src/routes.tsx'],
  api: createGalleryFallbackAssembly({ title: 'Service Desk', slug: 'service-desk', blueprint: 'crud-app' }).api,
  blocks: [{
    module: 'MetricGrid',
    componentName: 'Metric Grid',
    category: 'dashboard',
    description: 'Operational metrics',
    props: { title: 'Live metrics' },
    span: 12,
    status: 'assembling',
  }],
};

describe('ForgeLiveAssemblyPreview', () => {
  it('explains the initial gallery-selection state', () => {
    render(<ForgeLiveAssemblyPreview assembly={null} />);
    expect(screen.getByTestId('forge-live-assembly-waiting')).toHaveTextContent('Selecting UI components');
  });

  it('renders actual registry components on the live canvas', () => {
    render(<ForgeLiveAssemblyPreview assembly={assembly} />);
    expect(screen.getByTestId('gallery-component-MetricGrid')).toHaveTextContent('Live metrics');
    expect(screen.getByText('Writing routes')).toBeInTheDocument();
  });

  it('shows streamed files and exposes the running preview', () => {
    render(<ForgeLiveAssemblyPreview assembly={assembly} />);

    fireEvent.click(screen.getByRole('button', { name: /Files/ }));
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument();
    expect(screen.getByText('src/routes.tsx')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Runtime/ }));
    expect(screen.getByTitle('Service Desk runtime preview')).toHaveAttribute('src', assembly.previewUrl);
  });

  it('displays the assembled OpenAPI contract and endpoint inventory', () => {
    render(<ForgeLiveAssemblyPreview assembly={assembly} />);
    fireEvent.click(screen.getByRole('button', { name: /API/ }));

    expect(screen.getByTestId('forge-api-contract')).toHaveTextContent('OpenAPI 3.1.0');
    expect(screen.getByText('5 operations')).toBeInTheDocument();
    expect(screen.getByText('openapi.json')).toBeInTheDocument();
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
  });

  it('reconstructs a gallery canvas for jobs created before live metadata existed', () => {
    const fallback = createGalleryFallbackAssembly({ title: 'Legacy CRM', slug: 'legacy-crm', blueprint: 'crud-app' });
    expect(fallback.blocks.map((block) => block.module)).toEqual([
      'MetricGrid', 'MissionControlTable', 'StatusTimeline',
    ]);
    // A guess must announce itself: this model is built from the blueprint
    // name on the client, not reported by the forge.
    expect(fallback.reconstructed).toBe(true);
    expect(fallback.activeTask).toMatch(/Reconstructed locally/);
  });

  it('marks a reconstructed canvas in the header rather than passing it off as live', () => {
    const fallback = createGalleryFallbackAssembly({ title: 'Legacy CRM', slug: 'legacy-crm', blueprint: 'crud-app' });

    render(<ForgeLiveAssemblyPreview assembly={fallback} />);

    expect(screen.getByTestId('forge-live-assembly-reconstructed')).toBeInTheDocument();
    expect(screen.queryByTestId('forge-live-assembly-phase')).not.toBeInTheDocument();
  });
});
