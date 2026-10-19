import { StreamLiveHUD } from '../StreamLiveHUD';

/**
 * EventStreamView — Wrapper that renders StreamLiveHUD inline as a first-class
 * tabbed view within the spatial dashboard (not in a dialog).
 *
 * The parent ViewContainer provides role="tabpanel", id, and aria-labelledby
 * attributes, so this component focuses solely on rendering the stream content.
 *
 * Requirements: 3.6
 */

export interface EventStreamViewProps {
  organizationId: number;
}

export function EventStreamView({ organizationId }: EventStreamViewProps) {
  return (
    <section className="h-full min-h-0 overflow-auto" data-testid="event-stream-view">
      <StreamLiveHUD organizationId={organizationId} />
    </section>
  );
}

export default EventStreamView;
