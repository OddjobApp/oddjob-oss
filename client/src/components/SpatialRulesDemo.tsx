import { useState } from "react";
import { cellToBoundary } from "h3-js";
import { DEMO_REQUESTS, SERVICE_CELLS, RESTRICTED_CELL, evaluateDemoLocation } from "./spatial-rules-demo";

const ZOOM = 12;
const SCALE = 256 * 2 ** ZOOM;
const project = (lat: number, lng: number) => [
  (lng + 180) / 360 * SCALE,
  (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * SCALE,
];
const center = project(34.0522, -118.2437);
const origin = [center[0] - 350, center[1] - 210];
const point = (lat: number, lng: number) => {
  const p = project(lat, lng);
  return [p[0] - origin[0], p[1] - origin[1]];
};
const polygon = (cell: string) => cellToBoundary(cell).map(([lat, lng]) => point(lat, lng).join(",")).join(" ");
const tileX = Math.floor(origin[0] / 256);
const tileY = Math.floor(origin[1] / 256);
const tiles = Array.from({ length: 12 }, (_, i) => ({ x: tileX + i % 4, y: tileY + Math.floor(i / 4) }));

export function SpatialRulesDemo() {
  const [selected, setSelected] = useState(0);
  const request = DEMO_REQUESTS[selected];
  const result = evaluateDemoLocation(request.cell);
  const verdict = result.eligible ? "Eligible for review" : result.inRestrictedZone ? "Blocked by restricted zone" : "Outside service coverage";
  return <div id="spatial-rules-demo" className="scroll-mt-24 space-y-5" data-testid="spatial-rules-demo">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-500">Geographic rules · Interactive example</p><h3 className="mt-2 text-2xl font-semibold">Where a request lands changes what happens next.</h3></div>
      <span className="rounded-full border px-3 py-1 text-xs">Synthetic data · No actions executed</span>
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
      <div className="min-w-0 space-y-3">
        <svg viewBox="0 0 700 420" role="img" aria-label={`Los Angeles geographic rules map. Selected ${request.id}: ${verdict}. Cyan hexagons show service coverage; the rose hexagon is restricted.`} className="block w-full overflow-hidden rounded-xl border bg-slate-100">
          {tiles.map(tile => <image key={`${tile.x}-${tile.y}`} href={`https://tile.openstreetmap.org/${ZOOM}/${tile.x}/${tile.y}.png`} x={tile.x * 256 - origin[0]} y={tile.y * 256 - origin[1]} width="256" height="256" />)}
          {SERVICE_CELLS.map(cell => <polygon key={cell} points={polygon(cell)} fill={cell === RESTRICTED_CELL ? "#f43f5e" : "#06b6d4"} fillOpacity={cell === RESTRICTED_CELL ? 0.62 : 0.28} stroke={cell === RESTRICTED_CELL ? "#9f1239" : "#0e7490"} strokeWidth="2" />)}
          {DEMO_REQUESTS.map((r, i) => { const [x, y] = point(r.coordinates[0], r.coordinates[1]); const labelX = x + (i === 1 ? 62 : i === 0 ? -28 : 0); const labelY = y + (i === 1 ? 8 : -24); return <g key={r.id}>
            <circle cx={x} cy={y} r={selected === i ? 13 : 9} fill={selected === i ? "#0f172a" : "#fff"} stroke="#0f172a" strokeWidth="3" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={selected === i ? "#fff" : "#0f172a"}>{i + 1}</text>
            <rect x={labelX - 38} y={labelY - 14} width="76" height="20" rx="5" fill="#0f172a" /><text x={labelX} y={labelY} textAnchor="middle" fontSize="11" fill="#fff">{r.id}</text>
          </g>; })}
          <rect x="0" y="399" width="700" height="21" fill="white" fillOpacity="0.94" />
          <text x="10" y="413" fontSize="10" fill="#334155">Los Angeles · H3 resolution 8 · Fictional boundaries</text>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"><text x="690" y="413" textAnchor="end" fontSize="10" fill="#334155">© OpenStreetMap contributors</text></a>
        </svg>
        <div className="flex flex-wrap gap-4 text-xs"><span><span className="mr-2 inline-block h-2.5 w-2.5 bg-cyan-500" />Service area</span><span><span className="mr-2 inline-block h-2.5 w-2.5 bg-rose-500" />Restricted zone · deny wins</span><span>① ② ③ Sample requests</span></div>
        <div className="flex flex-wrap gap-2" aria-label="Sample request selection">{DEMO_REQUESTS.map((r, i) => <button key={r.id} type="button" aria-pressed={selected === i} onClick={() => setSelected(i)} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-xs ${selected === i ? "border-cyan-500 bg-cyan-500/10" : "hover:bg-muted"}`}><strong className="block">{i + 1}. {r.id}</strong>{r.label}</button>)}</div>
      </div>
      <div className="space-y-4 rounded-xl border bg-background p-5">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Sample policy · Location checks + review</p><ol className="mt-3 space-y-3 text-sm"><li><strong>01 · Within coverage</strong><p className="mt-1 text-muted-foreground">Request location must fall inside the cyan H3 service area.</p></li><li><strong>02 · Outside restricted zone</strong><p className="mt-1 text-muted-foreground">The rose zone blocks eligibility, even inside coverage.</p></li><li><strong>03 · Human review</strong><p className="mt-1 text-muted-foreground">An eligible request still requires approval before dispatch.</p></li></ol></div>
        <div aria-live="polite" aria-atomic="true" className="space-y-2 border-t pt-4"><p className="font-semibold">{request.id} · Rule evaluation</p><p className="text-sm">{result.inServiceArea ? "✓" : "✕"} Within service area</p><p className="text-sm">{!result.inRestrictedZone ? "✓" : "✕"} Outside restricted zone</p><p className={`rounded-lg border p-3 font-semibold ${result.eligible ? "border-cyan-500/50 bg-cyan-500/10" : "border-rose-500/50 bg-rose-500/10"}`}>{verdict}</p><p className="break-all font-mono text-[10px] text-muted-foreground">H3 cell: {request.cell}</p></div>
      </div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">This browser-only demonstration calculates H3 cell membership from fictional sample locations. It illustrates geographic rule logic; it does not apply an organization policy, request approval, or dispatch a team.</p>
  </div>;
}
