import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TutorialHost } from './TutorialHost';
import { startTutorial } from '@/lib/tutorial-engine';

describe('TutorialHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing by default when no tutorial is active', () => {
    const { container } = render(<TutorialHost />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts tutorial bubble on oddjob:start-tutorial event and steps through dimensions', () => {
    render(<TutorialHost />);

    act(() => {
      startTutorial('platform-score-tour');
    });

    // Step 1: Symptom
    expect(screen.getByTestId('tutorial-bubble')).toBeTruthy();
    expect(screen.getByText('Omnipresent Discovery (Cmd+K)')).toBeTruthy();
    expect(screen.getByTestId('tutorial-score-badge').textContent).toContain('[S]');

    // Click Next -> Step 2: Cause
    const nextBtn = screen.getByTestId('tutorial-bubble-next');
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(screen.getByText('Live Eulerian Mission Telemetry')).toBeTruthy();
    expect(screen.getByTestId('tutorial-score-badge').textContent).toContain('[C]');

    // Click Next -> Step 3: Resource
    act(() => {
      fireEvent.click(screen.getByTestId('tutorial-bubble-next'));
    });
    expect(screen.getByText('Autonomous Co-pilot Assistant')).toBeTruthy();
    expect(screen.getByTestId('tutorial-score-badge').textContent).toContain('[R]');

    // Click Next -> Step 4: Outcome
    act(() => {
      fireEvent.click(screen.getByTestId('tutorial-bubble-next'));
    });
    expect(screen.getByText('Multi-Tenant Context & Safety')).toBeTruthy();
    expect(screen.getByTestId('tutorial-score-badge').textContent).toContain('[O]');
    expect(screen.getByText('Complete Overview')).toBeTruthy();

    // Click Finish -> Completes tutorial and unmounts
    act(() => {
      fireEvent.click(screen.getByTestId('tutorial-bubble-next'));
    });

    expect(screen.queryByTestId('tutorial-bubble')).toBeNull();
  });

  it('mounts and tracks progress across chained multi-module playlists', () => {
    render(<TutorialHost />);

    act(() => {
      startTutorial('chain:developer-forge');
    });

    // Module 1 of 3: Omnipresent Discovery
    expect(screen.getByTestId('tutorial-bubble')).toBeTruthy();
    const badge = screen.getByTestId('tutorial-module-badge');
    expect(badge.textContent).toContain('Module 1 of 3: Omnipresent Discovery');
    expect(badge.textContent).toContain('Playlist');

    // Advance to Module 2 of 3: 34 Canonical App Blueprints
    act(() => {
      fireEvent.click(screen.getByTestId('tutorial-bubble-next'));
    });

    const badge2 = screen.getByTestId('tutorial-module-badge');
    expect(badge2.textContent).toContain('Module 2 of 3: 34 Canonical App Blueprints');
    expect(screen.getByText('App Forge Catalog')).toBeTruthy();

    // Advance to Module 3 of 3: Autonomous Co-pilot Assistant
    act(() => {
      fireEvent.click(screen.getByTestId('tutorial-bubble-next'));
    });

    const badge3 = screen.getByTestId('tutorial-module-badge');
    expect(badge3.textContent).toContain('Module 3 of 3: Autonomous Co-pilot Assistant');
    expect(screen.getByText('Autonomous Co-pilot Assistant')).toBeTruthy();
    expect(screen.getByTestId('tutorial-bubble-next').textContent).toContain('Complete Full Walkthrough');

    // Finish chained track
    act(() => {
      fireEvent.click(screen.getByTestId('tutorial-bubble-next'));
    });

    expect(screen.queryByTestId('tutorial-bubble')).toBeNull();
  });

  it('auto-launches tutorial when ?tutorial= query parameter is present in URL', () => {
    // Set window.location.search
    const originalSearch = window.location.search;
    delete (window as any).location;
    (window as any).location = new URL('http://localhost:5000/launchpad?tutorial=chain:developer-forge');

    render(<TutorialHost />);

    expect(screen.getByTestId('tutorial-bubble')).toBeTruthy();
    expect(screen.getByText('Omnipresent Discovery (Cmd+K)')).toBeTruthy();

    // Clean up
    delete (window as any).location;
    (window as any).location = new URL('http://localhost:5000/launchpad' + originalSearch);
  });
});
