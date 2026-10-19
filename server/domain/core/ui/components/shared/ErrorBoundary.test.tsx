import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ErrorBoundary } from './ErrorBoundary.js';

// Suppress expected console.error output from React's error boundary
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Intentional test error');
  return <div>Working component</div>;
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Working component')).toBeInTheDocument();
  });

  it('renders default error UI when a child throws', () => {
    render(
      <ErrorBoundary name="TestModule">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('TestModule Failed to Load')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('This module encountered an unexpected error', { exact: false })).toBeInTheDocument();
  });

  it('uses "Component" as the default name when name prop is omitted', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Component Failed to Load')).toBeInTheDocument();
  });

  it('renders custom fallback instead of default UI when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error view</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom error view')).toBeInTheDocument();
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
  });

  it('resets error state and re-renders children when Try Again is clicked', () => {
    let shouldThrow = true;
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Try Again')).toBeInTheDocument();

    // Fix the child first
    shouldThrow = false;
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    // Then click Try Again to clear the error state
    fireEvent.click(screen.getByText('Try Again'));

    expect(screen.getByText('Working component')).toBeInTheDocument();
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
  });

  it('logs the error to console.error', () => {
    render(
      <ErrorBoundary name="LogTest">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(console.error).toHaveBeenCalled();
  });
});
