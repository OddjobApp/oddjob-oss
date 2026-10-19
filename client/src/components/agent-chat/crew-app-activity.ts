export interface CrewAppActivityEvent {
  id: string; timestamp: string; type: string; agentName: string; summary: string;
}
export interface CrewAppActivity {
  appTitle: string; events: CrewAppActivityEvent[]; error?: string;
}
export function readCrewAppActivity(data: unknown, roomKey: string): { events: CrewAppActivityEvent[]; error?: string } | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.source !== 'crew-app-activity' || message.version !== 1 || message.roomKey !== roomKey) return null;
  if (typeof message.error === 'string') return { events: [], error: message.error.slice(0, 500) };
  if (!Array.isArray(message.events)) return null;
  const entries = message.events.slice(0, 100).filter((event) => event && ['id', 'timestamp', 'type', 'agentName', 'summary'].every((key) => typeof event[key] === 'string'));
  return { events: entries.map((event) => ({ id: event.id.slice(0, 128), timestamp: event.timestamp, type: event.type.slice(0, 64), agentName: event.agentName.slice(0, 200), summary: event.summary.slice(0, 4000) })) };
}

export function mergeCrewAppActivity(previous: CrewAppActivityEvent[], incoming: CrewAppActivityEvent[]) {
  return [...new Map([...previous, ...incoming].map((event) => [event.id, event])).values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)).slice(-500);
}
