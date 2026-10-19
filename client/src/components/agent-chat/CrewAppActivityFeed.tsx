import React from 'react';
import type { CrewAppActivity } from './crew-app-activity';
export function CrewAppActivityFeed({ activity }: { activity: CrewAppActivity }) {
  return <section aria-label="App activity" className="mx-4 my-3 rounded-lg border border-border/60 bg-card/60 p-3">
    <details open={Boolean(activity.error)}>
      <summary className="cursor-pointer text-xs font-medium">Organization activity · viewed through {activity.appTitle} · {activity.events.length} events</summary>
      <p className="mt-2 text-xs text-muted-foreground">Organization-wide forensic history. Events may belong to other apps, projects or missions; this feed is not bound to this room.</p>
      {activity.error && <p role="alert" className="mt-2 text-xs text-destructive">{activity.error}</p>}
      {!activity.error && activity.events.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No activity records returned yet.</p>}
      <ol className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {activity.events.map((event) => <li key={event.id} className="border-l-2 border-border pl-2 text-xs">
          <div className="flex flex-wrap gap-2 text-muted-foreground"><span>{event.agentName}</span><span>{event.type.replaceAll('_', ' ')}</span><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time></div>
          <p className="mt-1 whitespace-pre-wrap break-words">{event.summary}</p>
        </li>)}
      </ol>
    </details>
  </section>;
}
