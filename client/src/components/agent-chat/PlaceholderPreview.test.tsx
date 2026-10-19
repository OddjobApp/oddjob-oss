import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlaceholderPreview } from '@oddjob/design-system';

afterEach(cleanup);

describe('PlaceholderPreview', () => {
  it('renders shimmering skeleton placeholder initially when loading', () => {
    render(
      <PlaceholderPreview
        variant="image"
        title="Synthesizing Visual Asset"
        subtitle="Prompt: Autonomous Swarm Graph"
        badgeText="Diffusing"
        isLoading={true}
      >
        <div data-testid="live-image">Loaded Image Content</div>
      </PlaceholderPreview>
    );

    expect(screen.getByTestId('placeholder-skeleton')).toBeTruthy();
    expect(screen.getByText('Synthesizing Visual Asset')).toBeTruthy();
    expect(screen.getByText('Prompt: Autonomous Swarm Graph')).toBeTruthy();
    expect(screen.getByText('Diffusing')).toBeTruthy();

    const liveContent = screen.getByTestId('placeholder-live-content');
    expect(liveContent.className).toContain('opacity-0');
  });

  it('replaces placeholder preview with live content when ready', () => {
    render(
      <PlaceholderPreview
        variant="image"
        status="ready"
        isLoading={false}
      >
        <div data-testid="live-image">Live Rendered Image</div>
      </PlaceholderPreview>
    );

    const liveContent = screen.getByTestId('placeholder-live-content');
    expect(liveContent.className).toContain('opacity-100');
    expect(screen.getByText('Live Rendered Image')).toBeTruthy();
  });

  it('renders table variant wireframe preview', () => {
    render(
      <PlaceholderPreview
        variant="table"
        title="Querying QuickBooks Ledger"
        status="loading"
      />
    );

    expect(screen.getByText('Querying QuickBooks Ledger')).toBeTruthy();
    expect(screen.getByTestId('placeholder-skeleton')).toBeTruthy();
  });

  it('renders chart variant wireframe preview', () => {
    render(
      <PlaceholderPreview
        variant="chart"
        title="Calculating Financial Ratios"
        status="loading"
      />
    );

    expect(screen.getByText('Calculating Financial Ratios')).toBeTruthy();
  });

  it('renders error state with retry button', () => {
    const handleRetry = vi.fn();
    render(
      <PlaceholderPreview
        status="error"
        errorMessage="Asset generation timed out"
        onRetry={handleRetry}
      />
    );

    expect(screen.getByText('Failed to load asset')).toBeTruthy();
    expect(screen.getByText('Asset generation timed out')).toBeTruthy();

    const retryBtn = screen.getByRole('button', { name: /Retry loading/i });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('triggers onClick handler on placeholder preview', () => {
    const handleClick = vi.fn();
    render(
      <PlaceholderPreview
        title="Mount Blueprint"
        onClick={handleClick}
        status="idle"
      />
    );

    const skeleton = screen.getByTestId('placeholder-skeleton');
    fireEvent.click(skeleton);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
