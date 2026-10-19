import { parseRouteFile } from "./route-parser";

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

const result = parseRouteFile(content, "test.tsx", "core");
console.log("Results:", result.length);
for (const r of result) {
  console.log(`  path=${r.path} component=${r.componentName}`);
}
