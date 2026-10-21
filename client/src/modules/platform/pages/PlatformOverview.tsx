import React from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BrainCircuit,
  Network,
  Server,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@domain-ui/core/ui/components/ui/card";
import { cn } from "@/lib/utils";

type LinkItem = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

const platformLinks: LinkItem[] = [
  {
    title: "AI Models",
    description: "Your organization's AI provider keys: Gemini, Claude (direct or Amazon Bedrock), OpenAI-compatible models, and fal.ai media.",
    href: "/platform/ai-models",
    icon: BrainCircuit,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "Connections",
    description: "Credentials, integrations, MCP tokens, SaaS connectors, and external system bridges.",
    href: "/connections",
    icon: Network,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Account & Admin",
    description: "Organizations, users, billing, licensing, and tenant administration.",
    href: "/account-admin",
    icon: Users,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Platform Maintenance",
    description: "Snapshots, documentation, software audit, evolution, autoresearch, and system graph.",
    href: "/platform-maintenance",
    icon: Server,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
];

export default function PlatformOverview() {
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Platform</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Platform
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Connections, account administration, and platform maintenance in one unified control surface.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {platformLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Card className="group h-full cursor-pointer border-foreground/10 bg-foreground/[0.04] transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]">
                  <CardContent className="flex h-full flex-col gap-4 p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className={cn("rounded-xl border p-3", item.tone)}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                    <div>
                      <h2 className="text-sm font-black uppercase tracking-tight text-foreground">{item.title}</h2>
                      <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
