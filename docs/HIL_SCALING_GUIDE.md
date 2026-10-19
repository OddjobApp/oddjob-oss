# Guide: The Mission Supervisor Pattern (HIL)

This guide documents the standardized pattern for integrating **Human-In-The-Loop (HIL)** workflows into Oddjob mini-apps. It is designed for use by both the **Oddjob Architect** (AI) and human developers.

## The Problem
Autonomous agents encounter situations where they shouldn't proceed without human verification (e.g., executing a trade, sending a mass email, deleting data). In these cases, the mission pauses and waits for user intervention.

## The Solution: Mission Supervisor
A "Mission Supervisor" app follows a simple 3-stage loop:
1. **Detection**: Check if the current mission has a `PAUSED` state or a pending HIL form.
2. **Presentation**: Render the `FormRenderer` component using the schema provided by the HIL backend.
3. **Resumption**: Submit the user's input/approval, which signals the `hilService` to unpause the mission and resume execution.

## Scaffolding the React Component

### 1. Import Primitives
```tsx
import FormRenderer from "@domain-ui/core/ui/components/shared/FormRenderer";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
```

### 2. Fetch Pending Forms
Apps should poll or check the pending HIL forms for their mission.
```tsx
const { data: pendingForms } = useQuery({
  queryKey: ['/api/hil/pending', missionId],
  queryFn: async () => {
    const res = await fetch(`/api/hil/pending?missionId=${missionId}`);
    return res.json();
  }
});
```

### 3. Render and Submit
```tsx
{pendingForms?.map(form => (
  <FormRenderer
    key={form.id}
    schema={form.schema}
    onSubmit={async (data) => {
      await apiRequest("POST", `/api/hil/submit/${form.id}`, data);
      toast({ title: "Approved", description: "Mission resumed." });
    }}
  />
))}
```

## Backend Configuration
Ensure that the `AppDeployment` has `hilEnabled: true`. This allows the `AppForge` to inject the necessary context into the mission runtime.

## AI Prompt Guidelines
When instructing the **Architect** to use this pattern:
- "Implement a Mission Supervisor step before the final execution."
- "Use FormRenderer to capture user confirmation for the 'output_report' stage."
- "Ensure the Zod schema matches the expected blackboard data shape."
