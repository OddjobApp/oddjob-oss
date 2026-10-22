import { BookOpen, Layers, MapPin, Route, ShieldCheck } from "lucide-react";
const examples = [
  { title: "Durable missions", icon: Route, src: "durable-missions.jpg", width: 1274, height: 717,
    detail: "Turn an operational goal into work that can pause, resume, delegate, and report progress.",
    caption: "Saved demo mission in the Oddjob organization, showing a paused run and its recorded status change. The scenario is synthetic; no pipelines or external actions ran.",
    alt: "Oddjob demo mission showing Paused execution health and a recorded pause event." },
  { title: "App Forge", icon: Layers, src: "app-forge.jpg", width: 1280, height: 720,
    detail: "Generate, validate, and evolve internal apps for recurring workflows.",
    caption: "The real Forge Studio with fictional field-operations requirements. This capture shows app specification, before generation or deployment.",
    alt: "Oddjob Forge Studio with a demo field-operations app name, URL slug, requirements, and preflight step." },
  { title: "Organizational knowledge", icon: BookOpen, src: "organizational-knowledge.jpg", width: 1170, height: 290,
    detail: "Ground work in reusable documents, mission memory, and connected knowledge.",
    caption: "A fictional Field Operations Playbook uploaded to the Oddjob organization. The library capture shows the saved document and extraction status; it does not claim a completed retrieval task.",
    alt: "Oddjob knowledge library displaying the extracted DEMO Field Operations Playbook and its summary." },
  { title: "Approvals and replay", icon: ShieldCheck, src: "approvals-replay.jpg", width: 1274, height: 717,
    detail: "Inspect actions, review approval requests, and follow execution evidence.",
    caption: "Read-only preview of the evidence UI using actual creation and pause records from the Oddjob demo run. No approval decision or computer-use replay was executed in this demonstration.",
    alt: "Oddjob evidence timeline preview displaying the recorded creation and pause of a synthetic demonstration run." },
  { title: "Spatial intelligence", icon: MapPin, src: "spatial-intelligence.jpg", width: 775, height: 320,
    detail: "Use location-bearing signals and geofences to add spatial context to operational work.",
    caption: "Detail from the live H3 editor’s draft sample selection; no operational geofence was applied. Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community.",
    alt: "Detail of Oddjob’s spatial editor showing sample selected hexagonal cells over satellite imagery, with paint and pan controls." },
];
export function CapabilityShowcase() {
  return <section aria-label="Oddjob capabilities in practice" className="grid items-start gap-6 border-t border-border py-12 md:grid-cols-2">
    {examples.map(({ title, icon: Icon, src, width, height, detail, caption, alt }) => <article key={title} className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="p-6"><Icon className="h-6 w-6" aria-hidden="true" /><h2 className="mt-4 text-xl font-semibold">{title}</h2><p className="mt-3 leading-7 text-muted-foreground">{detail}</p></div>
      <figure><a href={`/images/product/${src}`} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size ${title} demonstration screenshot`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"><img src={`/images/product/${src}`} width={width} height={height} alt={alt} loading="lazy" decoding="async" className="h-auto w-full" /></a><figcaption className="p-6 text-sm leading-6 text-muted-foreground">{caption}</figcaption></figure>
    </article>)}
  </section>;
}
