import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GeneratedImageCard, formatImageAsMarkdown } from './GeneratedImageCard';

afterEach(cleanup);

describe('GeneratedImageCard', () => {
  const sampleUrl = 'https://oaidalleapiprodscus.blob.core.windows.net/test-image.png';
  const sampleTitle = 'Q3 Revenue Trajectory Chart';
  const sampleDesc = 'Isometric 3D chart displaying quarterly revenue scaling from 2M to 5M';

  it('formats image embed as valid Markdown', () => {
    const md = formatImageAsMarkdown(sampleUrl, sampleTitle, sampleDesc);
    expect(md).toContain(`![${sampleTitle}](${sampleUrl})`);
    expect(md).toContain(`*${sampleDesc}*`);
  });

  it('renders image, title, description, and action buttons', () => {
    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
      />
    );

    expect(screen.getByText(sampleTitle)).toBeTruthy();
    expect(screen.getByText(sampleDesc)).toBeTruthy();
    expect(screen.getByRole('img')).toHaveAttribute('src', sampleUrl);
    expect(screen.getByRole('button', { name: /Insert in Scribe/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy markdown/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open original/ })).toBeTruthy();
  });

  it('dispatches scribe:insert-text event on Insert in Scribe click', async () => {
    const insertedEvents: any[] = [];
    const listener = (e: Event) => insertedEvents.push((e as CustomEvent).detail);
    window.addEventListener('scribe:insert-text', listener);

    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Insert in Scribe/ }));

    expect(insertedEvents.length).toBe(1);
    expect(insertedEvents[0].text).toContain(`![${sampleTitle}](${sampleUrl})`);
    expect(insertedEvents[0].source).toBe('assistant_image');
    expect(insertedEvents[0].imageUrl).toBe(sampleUrl);
    expect(await screen.findByText('Inserted in Scribe')).toBeTruthy();

    window.removeEventListener('scribe:insert-text', listener);
  });

  it('copies Markdown embed code to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Copy markdown/ }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`![${sampleTitle}](${sampleUrl})`));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('toggles image zoom on zoom button click', () => {
    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
      />
    );

    const img = screen.getByRole('img');
    expect(img.className).toContain('max-h-[480px]');

    // The zoom control appears once there is an image to zoom.
    fireEvent.load(img);
    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(img.className).toContain('max-h-[800px]');

    fireEvent.click(screen.getByTitle('Zoom out'));
    expect(img.className).toContain('max-h-[480px]');
  });

  it('displays placeholder preview initially and transitions on load', () => {
    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
      />
    );

    const placeholder = screen.getByTestId('image-placeholder-preview');
    expect(placeholder).toBeTruthy();
    expect(screen.getByText('Loading the image…')).toBeTruthy();

    const img = screen.getByRole('img');
    expect(img.className).toContain('opacity-0');

    // Simulate image loaded
    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');
  });

  it('displays error preview state when image fails to load', () => {
    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
      />
    );

    const img = screen.getByRole('img');
    fireEvent.error(img);

    expect(screen.getByRole('alert')).toHaveTextContent('The image did not load');
    expect(screen.getByText('The link may have expired. Open the original to check.')).toBeTruthy();
  });

  it('renders synthesizing state when isGenerating is set to true', () => {
    render(
      <GeneratedImageCard
        url={sampleUrl}
        title={sampleTitle}
        description={sampleDesc}
        isGenerating={true}
      />
    );

    expect(screen.getByText('Generating the image…')).toBeTruthy();
  });
});
