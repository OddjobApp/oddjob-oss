import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, MapPin, Radio, Send, UserRound, Wrench } from "lucide-react";

type RescueConfirmation = {
    id: string;
    status: string;
    resolvedAddress: string;
    provider: { id: string; name: string } | null;
    etaMinutes: number | null;
};

const fieldClass = "mt-2 h-11 w-full rounded-lg border border-foreground/10 bg-background/30 px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15";

export function RescueRequestPanel({ slug, sessionId }: { slug: string; sessionId: string }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [confirmation, setConfirmation] = useState<RescueConfirmation | null>(null);

    async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsSubmitting(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
            const response = await fetch(`/api/public/agents/${slug}/rescue-requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestorName: form.get("requestorName"),
                    requestorContact: form.get("requestorContact"),
                    target: form.get("target"),
                    address: form.get("address"),
                    incidentType: form.get("incidentType"),
                    priority: form.get("priority"),
                    details: form.get("details"),
                    sessionId,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "The rescue request could not be submitted.");
            setConfirmation(result);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "The rescue request could not be submitted.");
        } finally {
            setIsSubmitting(false);
        }
    }

    if (confirmation) {
        return (
            <section className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-5 text-foreground shadow-xl" aria-live="polite">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span>
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Request received</p>
                            <h2 className="mt-1 text-xl font-black tracking-tight">{confirmation.id}</h2>
                            <p className="mt-1 text-sm text-foreground">Operations Control can now see and focus this request on the live map.</p>
                        </div>
                    </div>
                    <span className="w-fit rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{confirmation.status}</span>
                </div>
                <dl className="mt-5 grid gap-3 border-t border-foreground/10 pt-4 sm:grid-cols-3">
                    <div><dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Located at</dt><dd className="mt-1 text-sm text-foreground">{confirmation.resolvedAddress}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Provider</dt><dd className="mt-1 text-sm text-foreground">{confirmation.provider?.name || "Dispatching next available"}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Estimated arrival</dt><dd className="mt-1 flex items-center gap-1.5 text-sm text-foreground"><Clock3 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />{confirmation.etaMinutes ? `${confirmation.etaMinutes} minutes` : "Pending"}</dd></div>
                </dl>
                <button type="button" onClick={() => setConfirmation(null)} className="mt-5 min-h-11 rounded-lg border border-foreground/10 px-4 text-xs font-black uppercase tracking-widest text-foreground transition hover:border-emerald-400/40 hover:text-foreground">Submit another request</button>
            </section>
        );
    }

    return (
        <section className="rounded-2xl border border-foreground/10 bg-background/80 p-5 text-foreground shadow-xl md:p-6" aria-labelledby="rescue-intake-heading">
            <div className="mb-5 flex flex-col gap-3 border-b border-foreground/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400"><AlertTriangle className="h-5 w-5" /></span>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Live operations intake</p>
                        <h2 id="rescue-intake-heading" className="mt-1 text-xl font-black tracking-tight">Request rescue support</h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Share the location and situation. Dispatch will see your request and nearby providers on the operations map.</p>
                    </div>
                </div>
                <span className="flex w-fit items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300"><Radio className="h-3.5 w-3.5" /> Control online</span>
            </div>

            <form onSubmit={submitRequest} className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-foreground"><span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" />Your name</span><input className={fieldClass} name="requestorName" autoComplete="name" required maxLength={100} placeholder="Jordan Lee" /></label>
                <label className="text-xs font-bold text-foreground"><span>Phone or email</span><input className={fieldClass} name="requestorContact" autoComplete="email" required maxLength={140} placeholder="(555) 013-2048" /></label>
                <label className="text-xs font-bold text-foreground sm:col-span-2"><span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />Incident address</span><input className={fieldClass} name="address" autoComplete="street-address" required maxLength={240} placeholder="200 N Spring St, Los Angeles, CA 90012" /></label>
                <label className="text-xs font-bold text-foreground"><span>Who or what needs help?</span><input className={fieldClass} name="target" required maxLength={140} placeholder="Person, vehicle, site, or equipment" /></label>
                <label className="text-xs font-bold text-foreground"><span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-muted-foreground" />Incident type</span><select className={fieldClass} name="incidentType" required defaultValue="Roadside rescue"><option>Roadside rescue</option><option>Medical support</option><option>Equipment recovery</option><option>Site safety</option><option>Technical recovery</option><option>Other</option></select></label>
                <label className="text-xs font-bold text-foreground"><span>Priority</span><select className={fieldClass} name="priority" defaultValue="High"><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select></label>
                <label className="text-xs font-bold text-foreground sm:col-span-2"><span>Situation details</span><textarea className={`${fieldClass} min-h-24 resize-y py-3`} name="details" maxLength={1200} placeholder="Add hazards, access instructions, or anything dispatch should know." /></label>
                {error && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200 sm:col-span-2" role="alert">{error}</div>}
                <div className="flex flex-col gap-3 pt-1 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-muted-foreground">Your contact details are shared with authorized operations personnel for this response.</p>
                    <button type="submit" disabled={isSubmitting || !sessionId} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-5 text-xs font-black uppercase tracking-widest text-foreground transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50">
                        {isSubmitting ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-border/30 border-t-zinc-950" />Locating request</> : <>Send to dispatch<Send className="h-4 w-4" /></>}
                    </button>
                </div>
            </form>
        </section>
    );
}
