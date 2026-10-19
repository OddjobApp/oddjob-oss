import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { SmartLink } from "@domain-ui/core/ui/components/shared/SmartLink";
type Health = "healthy" | "attention" | "unavailable";
interface Assessment { id: string; name: string; category: string; health: Health; security: string; capabilities: string[]; checks: Array<{ label: string; passed: boolean; detail: string }>; nextAction: { label: string; href: string }; }
interface Response { generatedAt: string; summary: Record<Health, number>; integrations: Assessment[]; }
const healthMeta = {
  healthy: { label: "Healthy", icon: CheckCircle2, style: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  attention: { label: "Needs attention", icon: AlertTriangle, style: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
  unavailable: { label: "Not configured", icon: Unplug, style: "text-muted-foreground bg-muted border-border" },
};
export default function IntegrationReliabilityCenter() {
  const query = useQuery<Response>({ queryKey: ["/api/integrations/reliability"], queryFn: async () => (await apiRequest("GET", "/api/integrations/reliability")).json() });
  if (query.isLoading) return <div className="p-8 text-sm text-muted-foreground">Checking integration readiness…</div>;
  if (!query.data) return <div className="p-8 text-sm text-destructive">Integration readiness could not be loaded.</div>;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">{(["healthy", "attention", "unavailable"] as Health[]).map((health) => { const meta = healthMeta[health]; const Icon = meta.icon; return <div key={health} className={`rounded-xl border p-4 ${meta.style}`}><div className="flex items-center justify-between"><span className="text-sm font-medium">{meta.label}</span><Icon className="h-4 w-4" /></div><p className="mt-2 text-3xl font-semibold">{query.data.summary[health]}</p></div>; })}</div>
    <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">Credential presence and production-readiness checks. Secrets are never returned.</p><Button variant="outline" size="sm" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    <div className="grid gap-4 xl:grid-cols-2">{query.data.integrations.map((item) => { const meta = healthMeta[item.health]; const Icon = meta.icon; return <article key={item.id} className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-foreground">{item.name}</h3><p className="text-xs uppercase tracking-wide text-muted-foreground">{item.category}</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${meta.style}`}><Icon className="h-3.5 w-3.5" />{meta.label}</span></div>
      <div className="mt-4 flex flex-wrap gap-1.5">{item.capabilities.map((capability) => <span key={capability} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{capability}</span>)}</div>
      <div className="mt-4 space-y-2">{item.checks.map((check) => <div key={check.label} className="flex gap-2 text-sm">{check.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}<div><span className="font-medium text-foreground">{check.label}</span><p className="text-xs text-muted-foreground">{check.detail}</p></div></div>)}</div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Security: {item.security}</span><SmartLink href={item.nextAction.href} className="inline-flex items-center text-sm font-medium text-primary hover:underline">{item.nextAction.label}<ExternalLink className="ml-1 h-3.5 w-3.5" /></SmartLink></div>
    </article>; })}</div>
  </div>;
}
