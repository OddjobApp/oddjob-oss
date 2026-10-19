import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock wouter before importing the component
const mockUseLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => mockUseLocation(),
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// Minimal breadcrumb UI mocks
vi.mock('@domain-ui/core/ui/components/ui/breadcrumb', () => ({
  Breadcrumb: ({ children, className }: any) => <nav aria-label="breadcrumb" className={className}>{children}</nav>,
  BreadcrumbList: ({ children }: any) => <ol>{children}</ol>,
  BreadcrumbItem: ({ children }: any) => <li>{children}</li>,
  BreadcrumbLink: ({ children }: any) => <span>{children}</span>,
  BreadcrumbPage: ({ children }: any) => <span aria-current="page">{children}</span>,
  BreadcrumbSeparator: () => <span aria-hidden="true">/</span>,
}));

vi.mock('lucide-react', () => ({
  Home: () => <svg data-testid="home-icon" />,
}));

import AppBreadcrumb from './Breadcrumb.js';

describe('AppBreadcrumb', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue(['/dashboard', vi.fn()]);
  });

  it('returns null on the dashboard route', () => {
    mockUseLocation.mockReturnValue(['/dashboard', vi.fn()]);
    const { container } = render(<AppBreadcrumb />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Home + mapped label for a known route', () => {
    mockUseLocation.mockReturnValue(['/jobs', vi.fn()]);
    render(<AppBreadcrumb />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Jobs')).toBeInTheDocument();
  });

  it('renders nested path using route label map', () => {
    mockUseLocation.mockReturnValue(['/knowledge/graph', vi.fn()]);
    render(<AppBreadcrumb />);
    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
  });

  it('formats unknown path segments with title case and hyphen removal', () => {
    mockUseLocation.mockReturnValue(['/some-custom-page', vi.fn()]);
    render(<AppBreadcrumb />);
    expect(screen.getByText('Some Custom Page')).toBeInTheDocument();
  });

  it('marks the last segment as the current page (no href)', () => {
    mockUseLocation.mockReturnValue(['/settings', vi.fn()]);
    render(<AppBreadcrumb />);
    const current = screen.getByText('Settings');
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('renders custom items when the items prop is provided', () => {
    mockUseLocation.mockReturnValue(['/pipelines/42', vi.fn()]);
    render(
      <AppBreadcrumb
        items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Pipelines', href: '/pipelines' },
          { label: 'My Pipeline' },
        ]}
      />
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Pipelines')).toBeInTheDocument();
    expect(screen.getByText('My Pipeline')).toBeInTheDocument();
  });

  it('applies a custom className to the nav element', () => {
    mockUseLocation.mockReturnValue(['/jobs', vi.fn()]);
    render(<AppBreadcrumb className="my-custom-class" />);
    expect(screen.getByRole('navigation')).toHaveClass('my-custom-class');
  });

  it('renders home icon on the first (Home) item', () => {
    mockUseLocation.mockReturnValue(['/jobs', vi.fn()]);
    render(<AppBreadcrumb />);
    expect(screen.getByTestId('home-icon')).toBeInTheDocument();
  });
});
