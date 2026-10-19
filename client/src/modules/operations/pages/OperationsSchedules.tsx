import React from "react";
import { useLocation } from "wouter";
import { ArrowRight, CalendarClock, Clock3, History, PlayCircle, Repeat2, ShieldCheck, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function OperationsSchedules() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-rose-300 shadow-[0_0_16px_rgba(251,113,133,0.55)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-300">Operations / Schedules</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Schedules</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Define when work should run, attach missions or agents, and review execution outcomes from one control point.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => setLocation("/operations/schedules/rules")} className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase hover:bg-foreground/[0.08]">
              <CalendarClock className="mr-2 h-4 w-4" /> Manage rules
            </Button>
            <Button onClick={() => setLocation("/operations/schedules/automations")} className="h-11 rounded-xl px-5 text-[10px] font-black uppercase">
              <PlayCircle className="mr-2 h-4 w-4" /> View automations
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-label="Scheduling workflow">
          {[
            { label: "1. Define", detail: "Create reusable timing rules", icon: Repeat2, tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
            { label: "2. Attach", detail: "Connect missions, agents, or workstreams", icon: Workflow, tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
            { label: "3. Observe", detail: "Review runs and execution history", icon: History, tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
          ].map(({ label, detail, icon: Icon, tone }) => (
            <Card key={label} className="border-foreground/10 bg-foreground/[0.04]">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold text-foreground">{detail}</p></div>
                <div className={`rounded-xl border p-3 ${tone}`}><Icon className="h-5 w-5" /></div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {[
            { title: "Schedule rules", description: "Create daily, weekly, monthly, interval, or cron-based recurrence patterns that automations can reuse.", helper: "Timing and recurrence", action: "Open schedule rules", href: "/operations/schedules/rules", icon: CalendarClock, tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
            { title: "Scheduled automations", description: "Attach executable work to a rule, control its state, inspect the next run, and review execution history.", helper: "Work and outcomes", action: "Open automations", href: "/operations/schedules/automations", icon: Clock3, tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
          ].map(({ title, description, helper, action, href, icon: Icon, tone }) => (
            <Card key={href} className="group border-foreground/10 bg-foreground/[0.04] transition-colors hover:border-foreground/20 hover:bg-foreground/[0.06]">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className={`rounded-xl border p-3 ${tone}`}><Icon className="h-5 w-5" /></div>
                  <span className="rounded-full border border-foreground/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">{helper}</span>
                </div>
                <div className="pt-3"><CardTitle className="text-base font-black uppercase text-foreground">{title}</CardTitle><CardDescription className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">{description}</CardDescription></div>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => setLocation(href)} className="h-10 rounded-xl border-foreground/10 bg-background/30 px-4 text-[10px] font-black uppercase group-hover:bg-foreground group-hover:text-background">
                  {action}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="border-foreground/10 bg-foreground/[0.03]">
          <CardContent className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-300" /><div><p className="text-xs font-bold text-foreground">Safe scheduling boundary</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Rules control timing; automations control the work, active state, and execution evidence.</p></div></div>
            <Button variant="ghost" onClick={() => setLocation("/operations")} className="justify-start text-[10px] font-black uppercase sm:justify-center">Back to operations</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
