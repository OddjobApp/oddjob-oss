import { lazy, Suspense, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type { MapMarker, HexCell } from './RescueMapView.js';

// mapbox-gl is ~1.8MB. RescueMap is reached statically through the rescue
// barrel, RescueStatusCard and the prediction dashboard, which put the whole map
// library into the login, CREW and mission chunks; it now loads when a map renders.
const RescueMapView = lazy(() => import('./RescueMapView.js').then((m) => ({ default: m.RescueMap })));

export function RescueMap(props: ComponentProps<typeof RescueMapView>) {
    return (
        <Suspense fallback={<div className={cn('relative w-full h-full rounded-2xl bg-muted/30 animate-pulse', props.className)} />}>
            <RescueMapView {...props} />
        </Suspense>
    );
}
