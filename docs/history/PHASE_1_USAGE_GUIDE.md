# Phase 1 Usage Guide - Quick Reference

**For developers implementing Phase 2 features**

---

## Setup: Using the Design System in Components

### 1. Import Design Tokens

```typescript
import {
  colors,
  statusBadges,
  spacing,
  typography,
  shadows,
  transitions,
} from "@oddjob/design-system";

// Use in styles
const cycleCardStyle = {
  backgroundColor: colors.neutral[50],
  borderColor: colors.primary[300],
  padding: spacing[4],
  boxShadow: shadows.md,
};

// Use in conditions
if (mission.status === "completed") {
  color = colors.success[500];
} else if (mission.status === "running") {
  color = colors.accent[500];
}
```

### 2. Use Icon Registry

```typescript
import { iconRegistry, getStatusIcon, getMissionTypeIcon } from "@oddjob/design-system";

// Get by category
const Icon = iconRegistry.status.completed;         // CheckCircle2
const ActionIcon = iconRegistry.actions.delete;    // Trash2

// Use type-safe getters
const StatusIcon = getStatusIcon("running");        // Activity
const MissionIcon = getMissionTypeIcon("research"); // Lightbulb

// In React
<StatusIcon className="w-5 h-5" style={{ color: colors.warning[500] }} />
```

### 3. Use Status Badge Styling

```typescript
import { statusBadges } from "@oddjob/design-system";

const badge = statusBadges.completed;
// Returns: {
//   bg: "#f0fdf4",           (light green background)
//   text: "#15803d",         (dark green text)
//   border: "#bbf7d0",       (light green border)
//   icon: "CheckCircle2",
//   label: "Completed"
// }

<div
  style={{
    background: badge.bg,
    border: `1px solid ${badge.border}`,
    color: badge.text,
  }}
>
  {badge.label}
</div>
```

### 4. Use Design System Hooks

```typescript
import { useStatusColor, useContrastColor } from "@oddjob/design-system";

export function StatusBadge({ status }) {
  const bgColor = useStatusColor(status);     // Gets right color for status
  const textColor = useContrastColor(bgColor); // Gets white or black for contrast

  return (
    <span style={{ background: bgColor, color: textColor }}>
      {status}
    </span>
  );
}
```

---

## Real-Time Updates: Subscribing to Events

### Example: Live Mission Progress

```typescript
import { useMissionRealtime } from "@/hooks/useRealTimeSync";

export function MissionProgress({ missionId }) {
  const { mission, progress, cost } = useMissionRealtime(missionId);

  return (
    <div>
      <ProgressBar value={progress} max={100} />
      <span>Cost: ${cost}</span>
      <span>Status: {mission?.status}</span>
    </div>
  );
  // Re-renders automatically when WebSocket sends updates
}
```

### Example: Raw Event Subscription

```typescript
import { useRealTimeSync } from "@/hooks/useRealTimeSync";

export function CycleActivityLog({ cycleId }) {
  const { isConnected, subscribe } = useRealTimeSync();

  useEffect(() => {
    // Subscribe to mission updates
    const unsub = subscribe("mission.updated", (event) => {
      if (event.data.cycleId === cycleId) {
        console.log("Mission updated:", event.data);
      }
    });

    return unsub;
  }, [cycleId, subscribe]);

  return <div>{isConnected ? "Live" : "Offline"}</div>;
}
```

### Event Types Available

```typescript
// Cycle events
"cycle.created"
"cycle.updated"
"cycle.status_changed"
"cycle.progress_updated"

// Mission events
"mission.created"
"mission.updated"
"mission.status_changed"
"mission.progress_updated"
"mission.cost_updated"

// Other
"phase.completed"
"approval.requested"
"error.recovery"
```

---

## View Mode Management: Multiple Views

### Example: Cycle with 3 Views

```typescript
import { useViewMode } from "@/hooks/useViewMode";

export function CycleContainer({ cycle }) {
  const { mode, setViewMode, isCompact, isTimeline, isHistory } = useViewMode("timeline");

  return (
    <div>
      {/* View selector buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode("compact")}
          active={isCompact}
        >
          Compact
        </button>
        <button
          onClick={() => setViewMode("timeline")}
          active={isTimeline}
        >
          Timeline
        </button>
        <button
          onClick={() => setViewMode("history")}
          active={isHistory}
        >
          History
        </button>
      </div>

      {/* Render based on mode */}
      {isCompact && <CycleCompactView cycle={cycle} />}
      {isTimeline && <CycleTimelineView cycle={cycle} />}
      {isHistory && <CycleHistoryView cycle={cycle} />}
    </div>
  );
}
```

---

## Filtering: Unified Filter State

### Example: Mission List with Filters

```typescript
import { useFilterState } from "@/hooks/useFilterState";

export function MissionList() {
  const {
    filters,
    toggleStatus,
    toggleType,
    setSearchQuery,
    clearFilters,
    hasActiveFilters,
  } = useFilterState();

  // Filter missions
  const filtered = missions.filter((m) => {
    if (filters.status.length && !filters.status.includes(m.status)) return false;
    if (filters.type.length && !filters.type.includes(m.type)) return false;
    if (filters.searchQuery && !m.name.includes(filters.searchQuery)) return false;
    return true;
  });

  return (
    <div>
      {/* Filter UI */}
      <div className="flex gap-4">
        <div>
          <label>Status:</label>
          <input
            type="checkbox"
            onChange={() => toggleStatus("completed")}
            checked={filters.status.includes("completed")}
          />
          Completed
        </div>

        <div>
          <label>Search:</label>
          <input
            onChange={(e) => setSearchQuery(e.target.value)}
            value={filters.searchQuery}
          />
        </div>

        {hasActiveFilters() && (
          <button onClick={clearFilters}>Clear Filters</button>
        )}
      </div>

      {/* Mission list */}
      {filtered.map((m) => (
        <MissionCard key={m.id} mission={m} />
      ))}
    </div>
  );
}
```

---

## Drill-Down Panels: Inline Exploration

### Example: Mission List with Detail Panel

```typescript
import { DrillDownPanel, useDrillDown } from "@/components/DrillDownPanel";

export function MissionListWithDetails() {
  const { isOpen, item, open, close } = useDrillDown<Mission>();

  return (
    <>
      {/* Mission list */}
      {missions.map((m) => (
        <div key={m.id} onClick={() => open(m)}>
          {m.name}
        </div>
      ))}

      {/* Detail panel - slides in from right on desktop, modal on mobile */}
      <DrillDownPanel
        isOpen={isOpen}
        title={item?.name}
        subtitle={`Status: ${item?.status}`}
        onClose={close}
        size="lg"
        footer={
          <button onClick={close} className="w-full">
            Done
          </button>
        }
      >
        {item && (
          <div className="space-y-4">
            <DetailSection label="Status">{item.status}</DetailSection>
            <DetailSection label="Progress">
              <ProgressBar value={item.progress} />
            </DetailSection>
            <DetailSection label="Cost">${item.cost}</DetailSection>
          </div>
        )}
      </DrillDownPanel>
    </>
  );
}
```

### Preset for Missions

```typescript
import { MissionDrillDown, useDrillDown } from "@/components/DrillDownPanel";

export function MissionDetailsDrawer() {
  const { isOpen, item, open, close } = useDrillDown<Mission>();

  return (
    <MissionDrillDown
      isOpen={isOpen}
      mission={item}
      onClose={close}
      size="lg"
    >
      {item && <MissionDetailsContent mission={item} />}
    </MissionDrillDown>
  );
}
```

---

## Common Patterns for Phase 2

### Pattern 1: Status-Colored Cards

```typescript
import { statusBadges, useStatusColor } from "@oddjob/design-system";

export function CycleCard({ cycle }) {
  const badge = statusBadges[cycle.status];

  return (
    <div style={{ borderLeftColor: badge.text, borderLeftWidth: 4 }}>
      <h3>{cycle.name}</h3>
      <span style={{ color: badge.text }}>{badge.icon}</span>
      <span>{badge.label}</span>
    </div>
  );
}
```

### Pattern 2: Live-Updating Component

```typescript
import { useMissionRealtime } from "@/hooks/useRealTimeSync";
import { colors } from "@oddjob/design-system";

export function LiveMissionMetrics({ missionId }) {
  const { mission, progress, cost } = useMissionRealtime(missionId);

  return (
    <div className="grid grid-cols-3 gap-4">
      <MetricCard
        label="Progress"
        value={`${progress}%`}
        color={colors.primary[500]}
      />
      <MetricCard
        label="Cost"
        value={`$${cost}`}
        color={colors.accent[500]}
      />
      <MetricCard
        label="Status"
        value={mission?.status}
        color={colors.success[500]}
      />
    </div>
  );
}
```

### Pattern 3: Multi-View Container

```typescript
import { useViewMode } from "@/hooks/useViewMode";
import { spacing } from "@oddjob/design-system";

export function CycleViewer({ cycle }) {
  const { mode, setViewMode } = useViewMode("timeline");

  return (
    <div>
      <div style={{ display: "flex", gap: spacing[2] }}>
        {["compact", "timeline", "history"].map((m) => (
          <button
            key={m}
            onClick={() => setViewMode(m as any)}
            active={mode === m}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {mode === "compact" && <CycleCompactView cycle={cycle} />}
      {mode === "timeline" && <CycleTimelineView cycle={cycle} />}
      {mode === "history" && <CycleHistoryView cycle={cycle} />}
    </div>
  );
}
```

---

## Debugging & Testing

### Check Design System Tokens

```typescript
// In browser console
import { colors, statusBadges } from "@oddjob/design-system";
console.log(colors.success);           // See all success colors
console.log(statusBadges.completed);   // See completed badge styling
```

### Check Real-Time Connection

```typescript
import { useRealTimeSync } from "@/hooks/useRealTimeSync";

export function ConnectionStatus() {
  const { isConnected, isReconnecting, connectionState } = useRealTimeSync();

  return (
    <div>
      Connected: {isConnected ? "✅" : "❌"}
      Reconnecting: {isReconnecting ? "🔄" : "idle"}
      Attempt: {connectionState.reconnectAttempt}
    </div>
  );
}
```

### Check Filter State

```typescript
const { filters, isFiltered } = useFilterState();
console.log(filters); // See current filter state
console.log(isFiltered()); // True if any filters active
```

---

## Migration Checklist for Phase 2

- [ ] Replace hardcoded colors with `colors.*`
- [ ] Replace icon imports with `iconRegistry.*`
- [ ] Replace status styling with `statusBadges.*`
- [ ] Add `useRealTimeSync` to update-able components
- [ ] Add `useViewMode` to view-switcher components
- [ ] Add `useFilterState` to filterable lists
- [ ] Replace full-page navigation with `DrillDownPanel`
- [ ] Test on mobile (DrillDownPanel responsive)
- [ ] Verify WCAG AA contrast (use browser tools)
- [ ] Update TypeScript imports

---

## Architecture Overview

```
Design System (Single Source of Truth)
├── Colors (180+ definitions)
├── Icons (80+ mapped)
├── Typography, Spacing, Shadows
└── Status Badges

Real-Time Sync (WebSocket Events)
├── useRealTimeSync() - Core hook
├── useCycleRealtime() - Convenience
└── useMissionRealtime() - Convenience

View Management
├── useViewMode() - Track active view
├── useFilterState() - Filter persistence
└── DrillDownPanel - Inline explorer

Components
├── Existing Cycles UI
├── Existing Missions UI
└── NEW: DrillDownPanel (Phase 1)
```

---

## FAQ

**Q: Do I need to rebuild the design system package?**  
A: Yes, run `cd packages/design-system && npm install && npm run build` if not already built.

**Q: Can I still hardcode colors?**  
A: Yes, but don't. Use the tokens instead for consistency.

**Q: What if WebSocket is offline?**  
A: Components using `useRealTimeSync` will show disconnected state. No crashes.

**Q: How often do view preferences persist?**  
A: Automatically on every change via localStorage.

**Q: Can I combine multiple filters?**  
A: Yes, all filter types work together (status + type + cost + time + tags + search).

**Q: How deep can drill-down go?**  
A: `useDrillDown` maintains unlimited item history with `previousItems` array.

---

**Next: Start Phase 2 by reading Phase 2A task list in UI_IMPLEMENTATION_AUDIT.md**

