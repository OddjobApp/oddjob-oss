import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('react-map-gl', () => ({
  default: ({ children }: any) => <div data-testid="mock-react-map">{children}</div>,
  Marker: ({ children, onClick }: any) => (
    <div data-testid="mock-marker" onClick={onClick}>
      {children}
    </div>
  ),
  NavigationControl: () => <div data-testid="mock-nav-control" />,
  Source: ({ children }: any) => <div data-testid="mock-geojson-source">{children}</div>,
  Layer: () => <div data-testid="mock-layer" />,
}));

import { TurnRow } from './TurnRow';
import { MapSurface } from '@domain-ui/core/ui/components/shared/MapSurface';

describe('TurnRow Map Artifact Rendering', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders an interactive map surface for assistant_map artifacts', async () => {
    const turn: any = {
      id: 201,
      speakerType: 'agent',
      speakerName: 'Navigator',
      content: 'Here are the closest operational facilities.',
      artifacts: [
        {
          tool: 'render_map',
          payload: {
            type: 'assistant_map',
            title: 'Nearest Dispatch Facilities',
            description: 'Top 2 closest service depots',
            markers: [
              { lat: 34.0522, lng: -118.2437, label: 'Downtown Depot', description: 'Available 24/7' },
              { lat: 34.0736, lng: -118.4004, label: 'Westside Station', description: 'Rapid dispatch unit' },
            ],
            center: { lat: 34.0629, lng: -118.322 },
            zoom: 12,
          },
        },
      ],
    };

    render(
      <TurnRow
        turn={turn}
        names={['Navigator']}
        onArtifactSubmit={vi.fn()}
        currentUserId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('assistant-map-surface')).toBeInTheDocument();
    });

    expect(screen.getByText('Nearest Dispatch Facilities')).toBeInTheDocument();
    expect(screen.getByText('Top 2 closest service depots')).toBeInTheDocument();
    expect(screen.getByText('2 pins')).toBeInTheDocument();
    expect(screen.getAllByText('Downtown Depot').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Westside Station').length).toBeGreaterThan(0);
  });

  it('renders an interactive map surface for type: map artifacts', async () => {
    const turn: any = {
      id: 202,
      speakerType: 'agent',
      speakerName: 'Navigator',
      content: 'Here is the requested location map.',
      artifacts: [
        {
          tool: 'render_map',
          payload: {
            type: 'map',
            title: 'Single Site Map',
            markers: [
              { lat: 37.7749, lng: -122.4194, label: 'SF Headquarters' },
            ],
          },
        },
      ],
    };

    render(
      <TurnRow
        turn={turn}
        names={['Navigator']}
        onArtifactSubmit={vi.fn()}
        currentUserId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('assistant-map-surface')).toBeInTheDocument();
    });

    expect(screen.getByText('Single Site Map')).toBeInTheDocument();
    expect(screen.getByText('1 pin')).toBeInTheDocument();
    expect(screen.getAllByText('SF Headquarters').length).toBeGreaterThan(0);
  });

  it('renders MapSurface component directly with markers and coordinates', () => {
    const markers = [
      { lat: 40.7128, lng: -74.006, label: 'NYC Operations', description: 'Main office' },
    ];

    render(
      <MapSurface
        title="Regional Operations"
        description="Active East Coast Hub"
        markers={markers}
      />
    );

    expect(screen.getByTestId('assistant-map-surface')).toBeInTheDocument();
    expect(screen.getByText('Regional Operations')).toBeInTheDocument();
    expect(screen.getByText('Active East Coast Hub')).toBeInTheDocument();
    expect(screen.getAllByText('NYC Operations').length).toBeGreaterThan(0);
    expect(screen.getByText('Main office')).toBeInTheDocument();
    expect(screen.getByText(/40.7128/)).toBeInTheDocument();
  });
  it('renders route line and numbered waypoint pins for assistant_map artifacts with a route', async () => {
    const turn: any = {
      id: 203,
      speakerType: 'agent',
      speakerName: 'Navigator',
      content: 'Here is the mapped route with stops.',
      artifacts: [
        {
          tool: 'render_map',
          payload: {
            type: 'assistant_map',
            title: 'Delivery Route',
            markers: [],
            route: {
              waypoints: [
                { lat: 34.0522, lng: -118.2437, label: 'Depot' },
                { lat: 34.0629, lng: -118.322, label: 'Mid Stop' },
                { lat: 34.1, lng: -118.4, label: 'Destination' },
              ],
              points: [[-118.2437, 34.0522], [-118.322, 34.0629], [-118.4, 34.1]],
              snapped: true,
              distanceKm: 12.4,
              durationMin: 18,
            },
          },
        },
      ],
    };

    render(
      <TurnRow
        turn={turn}
        names={['Navigator']}
        onArtifactSubmit={vi.fn()}
        currentUserId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('assistant-map-surface')).toBeInTheDocument();
    });

    expect(screen.getByTestId('map-route-badge')).toHaveTextContent('12.4 km · 18 min');
    expect(screen.getByTestId('mock-geojson-source')).toBeInTheDocument();
    expect(screen.getAllByTestId('map-waypoint-pin')).toHaveLength(3);
    expect(screen.getByText('3 stops')).toBeInTheDocument();
  });
});

describe('MapSurface Geolocation Permission & Fallback Behavior', () => {
  const originalGeolocation = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
      writable: true,
    });
  });

  it('automatically requests location permission when no locations are present on the map', async () => {
    const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
      success({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
        },
      });
    });

    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: mockGetCurrentPosition },
      configurable: true,
      writable: true,
    });

    render(<MapSurface title="Empty Map" markers={[]} />);

    expect(mockGetCurrentPosition).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('map-user-location-pin')).toBeInTheDocument();
    });

    expect(screen.getByText('GPS Active')).toBeInTheDocument();
    expect(screen.getAllByText('Your Current Location').length).toBeGreaterThan(0);
  });

  it('allows user to trigger location request manually via Locate Me button', async () => {
    const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
      success({
        coords: {
          latitude: 34.0522,
          longitude: -118.2437,
        },
      });
    });

    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: mockGetCurrentPosition },
      configurable: true,
      writable: true,
    });

    render(
      <MapSurface
        title="Site Map"
        markers={[{ lat: 34.05, lng: -118.25, label: 'Depot' }]}
      />
    );

    const locateBtn = screen.getByTestId('map-locate-me-btn');
    fireEvent.click(locateBtn);

    expect(mockGetCurrentPosition).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('map-user-location-pin')).toBeInTheDocument();
    });
    expect(screen.getByText('GPS Active')).toBeInTheDocument();
  });

  it('displays permission denied notice when geolocation permission is rejected', async () => {
    const mockGetCurrentPosition = vi.fn().mockImplementation((_success, error) => {
      error({
        code: 1, // PERMISSION_DENIED
        message: 'User denied Geolocation',
      });
    });

    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: mockGetCurrentPosition },
      configurable: true,
      writable: true,
    });

    render(<MapSurface title="No Locations Map" markers={[]} />);

    await waitFor(() => {
      expect(screen.getByText('Location permission denied')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Allow location access in your browser settings/)
    ).toBeInTheDocument();
  });

  it('renders MapPod as an instant app artifact in TurnRow', async () => {
    const turn: any = {
      id: 205,
      speakerType: 'agent',
      speakerName: 'Navigator',
      content: 'Here is your interactive map instant app.',
      artifacts: [
        {
          tool: 'render_instant_app',
          payload: {
            type: 'instant_app',
            module: 'MapPod',
            componentName: 'Map Pod',
            title: 'Operations Map Instant App',
            props: {
              markers: [
                { lat: 47.6062, lng: -122.3321, label: 'Seattle Hub' },
              ],
            },
          },
        },
      ],
    };

    render(
      <TurnRow
        turn={turn}
        names={['Navigator']}
        onArtifactSubmit={vi.fn()}
        currentUserId="user-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('assistant-map-surface')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Operations Map Instant App').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Seattle Hub').length).toBeGreaterThan(0);
  });
});
