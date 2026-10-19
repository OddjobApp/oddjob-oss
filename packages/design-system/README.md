# @oddjob/design-system

Unified design system for Oddjob UI - providing a single source of truth for colors, icons, tokens, and component patterns.

## Purpose

Rather than having hardcoded color values, icon imports, and styling scattered throughout the codebase, this package provides:

- **Semantic color tokens** with accessible contrast ratios
- **Icon registry** mapping semantic names to lucide-react icons
- **Typography scale** for consistent text styling
- **Spacing scale** following Tailwind conventions
- **Status badge definitions** for consistent mission/cycle states
- **Design hooks** for React components to consume tokens

## Installation

```bash
npm install @oddjob/design-system
```

## Quick Start

### Using Color Tokens

```typescript
import { colors } from "@oddjob/design-system";

const style = {
  backgroundColor: colors.success[500],    // Completed ✓
  color: colors.neutral[900],              // Good contrast
  borderColor: colors.primary[300],
};
```

### Using Icons

```typescript
import { iconRegistry, getStatusIcon } from "@oddjob/design-system";

const CompletedIcon = getStatusIcon("completed");
const RunningIcon = iconRegistry.status.running;
const ResearchIcon = iconRegistry.missionType.research;

// In React component:
<CompletedIcon className="w-5 h-5" />
```

### Using Status Badges

```typescript
import { statusBadges } from "@oddjob/design-system";

const badge = statusBadges.completed;
// Returns: { bg, text, border, icon, label }

<div style={{ background: badge.bg, color: badge.text }}>
  {badge.label}
</div>
```

### Using Hooks

```typescript
import { useStatusColor, useStatusBadge, useContrastColor } from "@oddjob/design-system";

export function MissionCard({ status }) {
  const badgeStyle = useStatusBadge(status);
  const color = useStatusColor(status);
  const textColor = useContrastColor(color);

  return (
    <div style={{ background: color, color: textColor }}>
      {badgeStyle.label}
    </div>
  );
}
```

## Token Categories

### Colors

Organized into logical groups:
- **Primary, Secondary, Accent** - Brand colors
- **Success, Warning, Danger, Info** - Semantic states
- **Manual, Recovery** - Execution-specific states
- **Neutral** - Grayscale for text and backgrounds
- **Execution** - Gantt chart specific colors

Each color has a 50-900 scale for opacity variations.

**Example Usage:**
```typescript
colors.success[500]        // Full saturation success
colors.success[100]        // Light background
colors.danger[700]         // Dark text
```

### Status Badges

Consistent styling for mission/cycle states:
- `completed` - ✓ Mission succeeded
- `running` - ⏳ Currently executing
- `paused` - ⏸ User paused
- `warning` - ⚠ Near budget/time limit
- `failed` - ✗ Execution error
- `pending` - ○ Awaiting start
- `replanning` - 🔄 Dynamic replan in progress

Each badge includes: `bg`, `text`, `border`, `icon`, `label`

### Icons

Organized into semantic groups:
- **status** - CheckCircle2, XCircle, Clock, AlertTriangle, etc.
- **execution** - Icons for each execution strategy
- **missionType** - Research, Analysis, AI Agent, Testing, etc.
- **operations** - Play, Pause, Stop, Skip, Undo, etc.
- **resources** - Budget, Tokens, Time, Efficiency
- **workflow** - Node, Edge, Merge, Branch, Loop
- **actions** - Edit, Delete, Copy, Share, etc.

**Icon Retrieval:**
```typescript
// Get by path
getIcon("status.completed")         // CheckCircle2

// Get by alias
getIconByAlias("status.completed")  // CheckCircle2

// Type-safe getters
getStatusIcon("completed")          // CheckCircle2
getExecutionIcon("dynamicAutonomous") // Zap
getMissionTypeIcon("research")      // Lightbulb
```

### Typography

Provides a consistent text scale:
- **fontSize** - xs, sm, base, lg, xl, 2xl, 3xl, 4xl, 5xl, 6xl
- **fontWeight** - thin to black
- **lineHeight** - For balanced readability
- **letterSpacing** - For varying densities

Each fontSize includes `size`, `lineHeight`, and `letterSpacing`.

### Spacing

Tailwind-based scale from 0 to 32 (128px):
```typescript
spacing[4]   // 16px (standard padding)
spacing[8]   // 32px (large spacing)
spacing[12]  // 48px (section spacing)
```

### Shadows & Elevation

From `xs` (subtle) to `2xl` (prominent) plus `inner`.

```typescript
shadows.xs    // Subtle elevation
shadows.lg    // Card elevation
shadows.2xl   // Modal/dialog elevation
```

## Design Principles

### Color Accessibility
All colors are selected to meet WCAG AA contrast requirements (4.5:1) when used with specified foreground colors.

### Semantic Over Literal
Use semantic names ("completed", "running") rather than colors ("green", "yellow") so you can change the palette globally without updating components.

### Consistent Across Modules
Cycles UI, Missions UI, and Workstreams use the same color/icon/spacing system.

### Progressive Disclosure
Use lighter color variants (50-300) for less important information, darker (600-900) for critical data.

## Migration Guide

### Converting Hardcoded Colors

**Before:**
```typescript
const C = {
  critical: "#f59e0b",
  normal: "#6366f1",
  manual: "#22d3ee",
};
```

**After:**
```typescript
import { colors } from "@oddjob/design-system";

colors.execution.critical  // "#f59e0b"
colors.execution.normal    // "#6366f1"
colors.manual[500]         // "#22d3ee"
```

### Converting Icon Imports

**Before:**
```typescript
import { CheckCircle2, Activity, AlertTriangle } from "lucide-react";
```

**After:**
```typescript
import { iconRegistry, getStatusIcon } from "@oddjob/design-system";

const checkIcon = getStatusIcon("completed");
const runningIcon = iconRegistry.status.running;
const warningIcon = iconRegistry.alerts.warning;
```

## React Component Example

```typescript
import React from "react";
import {
  colors,
  statusBadges,
  getStatusIcon,
  useStatusColor,
  useContrastColor,
} from "@oddjob/design-system";

interface MissionStatusProps {
  status: "completed" | "running" | "failed" | "pending";
  label: string;
}

export function MissionStatus({ status, label }: MissionStatusProps) {
  const badge = statusBadges[status];
  const bgColor = useStatusColor(status);
  const textColor = useContrastColor(bgColor);
  const Icon = getStatusIcon(status);

  return (
    <div
      style={{
        background: badge.bg,
        border: `1px solid ${badge.border}`,
        color: badge.text,
        padding: "8px 12px",
        borderRadius: "6px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <Icon size={16} />
      <span>{label}</span>
    </div>
  );
}
```

## File Structure

```
packages/design-system/
├── src/
│   ├── tokens.ts          # Color, spacing, typography, shadows
│   ├── icons.ts           # Icon registry and helpers
│   ├── hooks/
│   │   └── index.ts       # React hooks for consuming tokens
│   └── index.ts           # Main export file
├── dist/                  # Compiled output (after build)
├── package.json
├── tsconfig.json
└── README.md
```

## Contributing

When adding new colors, icons, or tokens:

1. **Verify contrast** - Use WCAG AA checker for new color combinations
2. **Follow semantics** - Use meaningful names, not literal colors
3. **Document usage** - Add example in README
4. **Test accessibility** - Ensure readability for color-blind users

## References

- [WCAG Color Contrast Requirements](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Lucide React Icons](https://lucide.dev/)
- [Temporal's Design System](https://temporal.io/) (inspiration)

## License

Part of Oddjob - see main LICENSE file.
