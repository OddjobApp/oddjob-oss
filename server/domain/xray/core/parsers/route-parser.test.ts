import { describe, it, expect } from "vitest";
import { parseRouteFile, extractDomainFromPath } from "./route-parser";

describe("route-parser", () => {
  describe("extractDomainFromPath", () => {
    it("extracts domain from server/domain/<DOMAIN>/ui/ path", () => {
      expect(extractDomainFromPath("server/domain/core/ui/components/routing/CoreRouting.tsx")).toBe("core");
      expect(extractDomainFromPath("server/domain/intelligence/ui/pages/Dashboard.tsx")).toBe("intelligence");
    });

    it("extracts module from client/src/modules/<MODULE>/ path", () => {
      expect(extractDomainFromPath("client/src/modules/missions/pages/MissionPage.tsx")).toBe("missions");
      expect(extractDomainFromPath("client/src/modules/agents/components/AgentList.tsx")).toBe("agents");
    });

    it("handles backslashes (Windows paths)", () => {
      expect(extractDomainFromPath("server\\domain\\core\\ui\\components\\routing\\CoreRouting.tsx")).toBe("core");
      expect(extractDomainFromPath("client\\src\\modules\\billing\\pages\\Billing.tsx")).toBe("billing");
    });

    it("returns 'unknown' for unrecognized paths", () => {
      expect(extractDomainFromPath("some/other/path/file.tsx")).toBe("unknown");
      expect(extractDomainFromPath("packages/shared/index.ts")).toBe("unknown");
    });
  });

  describe("parseRouteFile", () => {
    it("extracts self-closing routes with component prop", () => {
      const content = `
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/settings" component={SettingsPage} />
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: "/dashboard",
        componentName: "Dashboard",
        filePath: "server/domain/core/ui/routing.tsx",
        domain: "core",
      });
      expect(result[1]).toEqual({
        path: "/settings",
        componentName: "SettingsPage",
        filePath: "server/domain/core/ui/routing.tsx",
        domain: "core",
      });
    });

    it("extracts routes with element prop (React Router v6 style)", () => {
      const content = `<Route path="/profile" element={<ProfilePage />} />`;
      const result = parseRouteFile(content, "client/src/modules/users/routes.tsx", "users");
      expect(result).toHaveLength(1);
      expect(result[0].componentName).toBe("ProfilePage");
    });

    it("extracts multi-line routes with children", () => {
      const content = `
        <Route path="/r/:token">
          <LazyRoute component={RescuePublicPage} />
        </Route>
      `;
      const result = parseRouteFile(content, "server/domain/rescue/ui/routing.tsx", "rescue");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/r/:token");
      expect(result[0].componentName).toBe("RescuePublicPage");
    });

    it("excludes routes with :rest* wildcard catch-all", () => {
      const content = `
        <Route path="/apps/:rest*"><Reload /></Route>
        <Route path="/agents/:rest*"><Reload /></Route>
        <Route path="/dashboard" component={Dashboard} />
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/dashboard");
    });

    it("excludes routes that render only <Reload />", () => {
      const content = `
        <Route path="/armory"><Reload /></Route>
        <Route path="/apps"><Reload /></Route>
        <Route path="/billing" component={BillingPage} />
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/billing");
    });

    it("excludes routes that render only <Redirect>", () => {
      const content = `
        <Route path="/old-page"><Redirect to="/new-page" /></Route>
        <Route path="/legacy"><Redirect to="/" /></Route>
        <Route path="/active" component={ActivePage} />
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/active");
    });

    it("handles single-quoted path attributes", () => {
      const content = `<Route path='/dashboard' component={Dashboard} />`;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/dashboard");
    });

    it("skips routes with no path attribute", () => {
      const content = `
        <Route component={NotFound} />
        <Route path="/valid" component={ValidPage} />
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/valid");
    });

    it("skips self-closing routes with no component or element prop", () => {
      const content = `
        <Route path="/empty" />
        <Route path="/good" component={GoodPage} />
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/routing.tsx", "core");
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/good");
    });

    it("handles real-world CoreRouting pattern with mixed routes", () => {
      const content = `
        <Route path="/armory"><Reload /></Route>
        <Route path="/armory/:rest*"><Reload /></Route>
        <Route path="/missions/:missionId/runs/:runId" component={MissionRunPage} />
        <Route path="/missions"><Reload /></Route>
        <Route path="/missions/:rest*"><Reload /></Route>
        <Route path="/dashboard/costs" component={CostDashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/r/:token">
          <LazyRoute component={RescuePublicPage} />
        </Route>
      `;
      const result = parseRouteFile(content, "server/domain/core/ui/components/routing/CoreRouting.tsx", "core");

      const paths = result.map((r) => r.path);
      expect(paths).toContain("/missions/:missionId/runs/:runId");
      expect(paths).toContain("/dashboard/costs");
      expect(paths).toContain("/dashboard");
      expect(paths).toContain("/r/:token");

      // Excluded
      expect(paths).not.toContain("/armory");
      expect(paths).not.toContain("/armory/:rest*");
      expect(paths).not.toContain("/missions");
      expect(paths).not.toContain("/missions/:rest*");
    });

    it("extracts component from LazyRoute children pattern", () => {
      const content = `
        <Route path="/a/:slug">
          <LazyRoute component={AgentDeploymentPage} />
        </Route>
      `;
      const result = parseRouteFile(content, "server/domain/agents/ui/routing.tsx", "agents");
      expect(result).toHaveLength(1);
      expect(result[0].componentName).toBe("AgentDeploymentPage");
    });

    it("extracts component from inline JSX children", () => {
      const content = `
        <Route path="/widget">
          <WidgetContainer />
        </Route>
      `;
      const result = parseRouteFile(content, "client/src/modules/widgets/routes.tsx", "widgets");
      expect(result).toHaveLength(1);
      expect(result[0].componentName).toBe("WidgetContainer");
    });
  });
});
