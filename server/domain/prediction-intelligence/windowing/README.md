# Windowing Pod

## Purpose
The Windowing Pod manages time-based and count-based windows for grouping events and quants. This supports event-driven quant generation and temporal analysis.

## Key Responsibilities
1.  **Window Creation**: Creating rolling, session, or episode windows.
2.  **Assignment**: Adding events and quants to relevant active windows.
3.  **Lifecycle**: Closing windows based on duration or limits.

## Interface
The pod implements the `WindowingPort` interface:

```typescript
export interface WindowingPort {
    createWindow(contextId: string, config: WindowConfig): Promise<Window>;
    getActiveWindows(contextId: string): Promise<Window[]>;
    addEvent(eventId: string, contextId: string, timestamp: string): Promise<string[]>;
    addQuant(quantId: string, contextId: string, timestamp: string): Promise<string[]>;
    closeWindow(id: string): Promise<void>;
}
```

## Usage
```typescript
import { windowingService } from "./windowing.service.js";

const window = await windowingService.createWindow("context-123", {
    type: "rolling",
    maxEvents: 100
});

const windowIds = await windowingService.addEvent("event-123", "context-123", now);
```
