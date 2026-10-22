export function ForgeShowcase() {
  return <section id="built-with-forge" aria-labelledby="forge-showcase-heading" className="space-y-8 border-t border-border py-12 sm:py-16">
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Built with App Forge</p>
        <h2 id="forge-showcase-heading" className="mt-3 text-3xl font-bold tracking-tight">Rescue Dispatch: a workspace for coordinating field response.</h2>
        <p className="mt-4 leading-7 text-muted-foreground">See how an Oddjob app blueprint brings a map, a request queue, and team readiness into one focused interface.</p>
      </div>
      <ul className="space-y-4 text-sm leading-6 text-muted-foreground">
        <li><strong className="text-foreground">See the situation.</strong> Map requests, squads, and service providers together, with controls to show each layer.</li>
        <li><strong className="text-foreground">Inspect a request.</strong> Select a queue item to focus the map and reveal its priority and status.</li>
        <li><strong className="text-foreground">Keep teams in view.</strong> Review squad readiness and the provider directory alongside the queue.</li>
      </ul>
    </div>
    <figure className="overflow-hidden rounded-2xl border border-border bg-card">
      <a href="/images/product/rescue-dispatch-map.jpg" target="_blank" rel="noopener noreferrer" aria-label="Open full-size Rescue Dispatch blueprint screenshot" className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
        <img src="/images/product/rescue-dispatch-map.jpg" alt="Rescue Dispatch App Forge blueprint preview showing a Los Angeles map with sample requests, squad readiness, and map layer controls." width={1264} height={720} loading="lazy" decoding="async" className="h-auto w-full bg-[#080a0c]" />
      </a>
      <figcaption className="space-y-3 p-6">
        <p className="text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Blueprint preview with sample data.</strong> Captured from the real Rescue Dispatch components in a local, read-only preview. Dispatch actions were disconnected; this demonstrates the interface, not a live emergency service.</p>
        <a href="/docs/app-forge" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Read the App Forge documentation</a>
      </figcaption>
    </figure>
  </section>;
}
