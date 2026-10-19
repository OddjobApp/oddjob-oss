import { ExecutionGroup, ExecutionEvent } from "@/components/execution/ExecutionExplorer";

// This type is a placeholder for the actual type from the database
interface CycleRunEvent {
    id: number;
    runId: number;
    stepCode: string;
    eventType: string;
    timestamp: string;
    inputs: any;
    outputs: any;
    error: string | null;
    durationMs: number | null;
}

function transformEventsToGroups(events: CycleRunEvent[]): ExecutionGroup[] {
    const groups: { [key: string]: ExecutionGroup } = {};

    events.forEach(event => {
        const stepCode = event.stepCode;

        if (!groups[stepCode]) {
            groups[stepCode] = {
                id: stepCode,
                title: stepCode,
                category: "Cycle Step",
                status: "pending", // Default status
                events: [],
            };
        }

        if (event.eventType === "STEP_STARTED") {
            groups[stepCode].status = "running";
            groups[stepCode].startedAt = event.timestamp;
        }

        if (event.eventType === "STEP_COMPLETED") {
            groups[stepCode].status = "completed";
            groups[stepCode].completedAt = event.timestamp;
            groups[stepCode].durationMs = event.durationMs;
        }

        if (event.eventType === "STEP_FAILED") {
            groups[stepCode].status = "failed";
            groups[stepCode].completedAt = event.timestamp;
            groups[stepCode].durationMs = event.durationMs;
        }

        // Create an ExecutionEvent for each raw event
        const execEvent: ExecutionEvent = {
            id: String(event.id),
            timestamp: event.timestamp,
            type: event.eventType,
            title: `${event.stepCode}: ${event.eventType}`,
            description: event.error || `Step ${event.eventType.toLowerCase()}`,
            status: event.eventType === "STEP_FAILED" ? "failed" : "completed",
            metadata: {
                inputs: event.inputs,
                outputs: event.outputs,
                error: event.error,
            },
        };

        groups[stepCode].events?.push(execEvent);
    });

    return Object.values(groups);
}

export async function fetchCycleRunHistory(runId: number, filters: { status?: string; stepCode?: string } = {}): Promise<ExecutionGroup[]> {
    try {
        const queryParams = new URLSearchParams();
        if (filters.status) {
            queryParams.append('status', filters.status);
        }
        if (filters.stepCode) {
            queryParams.append('stepCode', filters.stepCode);
        }

        const response = await fetch(`/api/mission-runs/${runId}/history?${queryParams.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch history for run ${runId}`);
        }
        const events: CycleRunEvent[] = await response.json();
        return transformEventsToGroups(events);
    } catch (error) {
        console.error("Error fetching or transforming cycle run history:", error);
        return [];
    }
}
