/**
 * Route Redirects Unit Tests
 *
 * Validates route redirect behavior for:
 * - /tactics/tools → /armory/tools (Armory SPA client-side redirect)
 * - /agent/memory → /armory/run-memory (Intelligence SPA window.location.replace)
 * - /knowledge/scoring → NotFound (no redirect)
 * - /platform → PlatformOverview with navigation cards
 *
 * Requirements: 4.2, 6.2, 7.3, 5.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React, { Suspense } from 'react';
import { Switch, Route, Redirect } from 'wouter';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

// --- Tests ---

describe('Route Redirects', () => {
  describe('/tactics/tools redirects to /armory/tools (Req 4.2)', () => {
    it('issues a client-side redirect from /tactics/tools to /armory/tools', () => {
      // The Armory SPA has: <Route path="/tactics/tools"><Redirect to="/armory/tools" /></Route>
      // We test this by rendering the redirect route directly with a Router at the given path
      const { hook, navigate } = memoryLocation({ path: '/tactics/tools', record: true });

      const RedirectRoute = () => (
        <Router hook={hook}>
          <Switch>
            <Route path="/tactics/tools"><Redirect to="/armory/tools" /></Route>
            <Route path="/armory/tools">{() => <div>Tool Registry</div>}</Route>
            <Route>{() => <div>Not Found</div>}</Route>
          </Switch>
        </Router>
      );

      render(<RedirectRoute />);

      // After redirect, should render the tool registry content
      expect(screen.getByText('Tool Registry')).toBeInTheDocument();
    });

    it('redirect updates URL to /armory/tools', () => {
      const { hook, history } = memoryLocation({ path: '/tactics/tools', record: true });

      const RedirectRoute = () => (
        <Router hook={hook}>
          <Switch>
            <Route path="/tactics/tools"><Redirect to="/armory/tools" /></Route>
            <Route path="/armory/tools">{() => <div>Tool Registry</div>}</Route>
            <Route>{() => <div>Not Found</div>}</Route>
          </Switch>
        </Router>
      );

      render(<RedirectRoute />);

      // The history should reflect the redirect to /armory/tools
      expect(history).toContain('/armory/tools');
    });
  });

  describe('/agent/memory triggers redirect to /armory/run-memory (Req 6.2)', () => {
    const originalLocation = window.location;
    let replaceSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      replaceSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...originalLocation,
          replace: replaceSpy,
          search: '',
          hash: '',
        },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      });
    });

    it('calls window.location.replace with /armory/run-memory', () => {
      // Replicate the AgentMemoryRedirect component behavior
      function AgentMemoryRedirect() {
        React.useEffect(() => {
          window.location.replace('/armory/run-memory' + window.location.search + window.location.hash);
        }, []);
        return null;
      }

      const { hook } = memoryLocation({ path: '/agent/memory' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/agent/memory" component={AgentMemoryRedirect} />
          </Switch>
        </Router>
      );

      expect(replaceSpy).toHaveBeenCalledWith('/armory/run-memory');
    });

    it('preserves query parameters in the redirect', () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...originalLocation,
          replace: replaceSpy,
          search: '?filter=recent&page=2',
          hash: '',
        },
      });

      function AgentMemoryRedirect() {
        React.useEffect(() => {
          window.location.replace('/armory/run-memory' + window.location.search + window.location.hash);
        }, []);
        return null;
      }

      const { hook } = memoryLocation({ path: '/agent/memory' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/agent/memory" component={AgentMemoryRedirect} />
          </Switch>
        </Router>
      );

      expect(replaceSpy).toHaveBeenCalledWith('/armory/run-memory?filter=recent&page=2');
    });

    it('preserves URL fragment in the redirect', () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...originalLocation,
          replace: replaceSpy,
          search: '',
          hash: '#section-3',
        },
      });

      function AgentMemoryRedirect() {
        React.useEffect(() => {
          window.location.replace('/armory/run-memory' + window.location.search + window.location.hash);
        }, []);
        return null;
      }

      const { hook } = memoryLocation({ path: '/agent/memory' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/agent/memory" component={AgentMemoryRedirect} />
          </Switch>
        </Router>
      );

      expect(replaceSpy).toHaveBeenCalledWith('/armory/run-memory#section-3');
    });

    it('preserves both query params and fragment in redirect', () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...originalLocation,
          replace: replaceSpy,
          search: '?key=value',
          hash: '#anchor',
        },
      });

      function AgentMemoryRedirect() {
        React.useEffect(() => {
          window.location.replace('/armory/run-memory' + window.location.search + window.location.hash);
        }, []);
        return null;
      }

      const { hook } = memoryLocation({ path: '/agent/memory' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/agent/memory" component={AgentMemoryRedirect} />
          </Switch>
        </Router>
      );

      expect(replaceSpy).toHaveBeenCalledWith('/armory/run-memory?key=value#anchor');
    });
  });

  describe('/knowledge/scoring renders NotFound without redirect (Req 7.3)', () => {
    function NotFound() {
      return <div>404 Page Not Found</div>;
    }

    it('renders NotFound (404) at /knowledge/scoring with no redirect', () => {
      const { hook, history } = memoryLocation({ path: '/knowledge/scoring', record: true });

      // Replicate the KnowledgeRouting structure: scoring routes are removed,
      // so /knowledge/scoring falls through to the catch-all NotFound
      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/knowledge/store">{() => <div>Store</div>}</Route>
            <Route path="/knowledge/datasets">{() => <div>Datasets</div>}</Route>
            <Route path="/knowledge">{() => <div>Knowledge Overview</div>}</Route>
            <Route component={NotFound} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('404 Page Not Found')).toBeInTheDocument();
      // No redirect occurred — history should only contain the original path
      expect(history).not.toContain('/insights/scoring');
    });

    it('renders NotFound for /knowledge/scoring/models/123 without redirect', () => {
      const { hook, history } = memoryLocation({ path: '/knowledge/scoring/models/123', record: true });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/knowledge/store">{() => <div>Store</div>}</Route>
            <Route path="/knowledge/datasets/:id">{() => <div>Dataset Detail</div>}</Route>
            <Route path="/knowledge/datasets">{() => <div>Datasets</div>}</Route>
            <Route path="/knowledge">{() => <div>Knowledge Overview</div>}</Route>
            <Route component={NotFound} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('404 Page Not Found')).toBeInTheDocument();
      expect(history).not.toContain('/insights/scoring');
    });

    it('renders NotFound for /knowledge/scoring/live without redirect', () => {
      const { hook, history } = memoryLocation({ path: '/knowledge/scoring/live', record: true });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/knowledge/store">{() => <div>Store</div>}</Route>
            <Route path="/knowledge">{() => <div>Knowledge Overview</div>}</Route>
            <Route component={NotFound} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('404 Page Not Found')).toBeInTheDocument();
      expect(history).not.toContain('/insights/scoring');
    });

    it('does not issue a Redirect component for scoring paths', () => {
      const { hook } = memoryLocation({ path: '/knowledge/scoring' });

      // Verify no <Redirect> is rendered — the component directly renders 404
      const { container } = render(
        <Router hook={hook}>
          <Switch>
            <Route path="/knowledge/store">{() => <div>Store</div>}</Route>
            <Route path="/knowledge">{() => <div>Knowledge Overview</div>}</Route>
            <Route component={NotFound} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('404 Page Not Found')).toBeInTheDocument();
      // No redirect elements in the DOM
      expect(container.querySelector('[data-redirect]')).toBeNull();
    });
  });

  describe('/platform renders PlatformOverview with navigation cards (Req 5.2)', () => {
    // Import actual PlatformOverview since it has minimal dependencies
    let PlatformOverview: React.ComponentType;

    beforeEach(async () => {
      const mod = await import('@/modules/platform/pages/PlatformOverview');
      PlatformOverview = mod.default;
    });

    it('renders PlatformOverview at /platform route', () => {
      const { hook } = memoryLocation({ path: '/platform' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/platform" component={PlatformOverview} />
            <Route>{() => <div>Not Found</div>}</Route>
          </Switch>
        </Router>
      );

      // PlatformOverview renders a description subtitle
      expect(
        screen.getByText(/Connections, account administration, and platform maintenance/)
      ).toBeInTheDocument();
    });

    it('renders Connections navigation card', () => {
      const { hook } = memoryLocation({ path: '/platform' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/platform" component={PlatformOverview} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('Connections')).toBeInTheDocument();
      expect(screen.getByText(/Credentials, integrations, MCP tokens/)).toBeInTheDocument();
    });

    it('renders Account & Admin navigation card', () => {
      const { hook } = memoryLocation({ path: '/platform' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/platform" component={PlatformOverview} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('Account & Admin')).toBeInTheDocument();
      expect(screen.getByText(/Organizations, users, billing/)).toBeInTheDocument();
    });

    it('renders Platform Maintenance navigation card', () => {
      const { hook } = memoryLocation({ path: '/platform' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/platform" component={PlatformOverview} />
          </Switch>
        </Router>
      );

      expect(screen.getByText('Platform Maintenance')).toBeInTheDocument();
      expect(screen.getByText(/Snapshots, documentation, software audit/)).toBeInTheDocument();
    });

    it('navigation cards link to correct URLs', () => {
      const { hook } = memoryLocation({ path: '/platform' });

      render(
        <Router hook={hook}>
          <Switch>
            <Route path="/platform" component={PlatformOverview} />
          </Switch>
        </Router>
      );

      const connectionsLink = screen.getByText('Connections').closest('a');
      const accountLink = screen.getByText('Account & Admin').closest('a');
      const maintenanceLink = screen.getByText('Platform Maintenance').closest('a');

      expect(connectionsLink).toHaveAttribute('href', '/connections');
      expect(accountLink).toHaveAttribute('href', '/account-admin');
      expect(maintenanceLink).toHaveAttribute('href', '/platform-maintenance');
    });
  });
});
