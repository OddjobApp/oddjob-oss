import React from "react";
import MissionsDashboard from '../components/MissionsDashboard';
import { Section } from "@domain-ui/core/ui/components/shared/Section";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";

function MissionsSkeleton() {
    return (
        <div className="min-h-screen bg-background p-4 text-foreground md:p-6">
            <div className="mx-auto max-w-[2000px] space-y-5">
                <div className="flex justify-between items-end gap-4 border-b border-foreground/10 pb-5">
                    <div className="space-y-2">
                        <Skeleton className="h-12 w-72 bg-foreground/10" />
                        <Skeleton className="h-3 w-96 bg-foreground/10" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-11 w-28 bg-foreground/10" />
                        <Skeleton className="h-11 w-36 bg-foreground/10" />
                        <Skeleton className="h-11 w-32 bg-foreground/10" />
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl bg-foreground/10" />)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl bg-foreground/10" />)}
                </div>
            </div>
        </div>
    );
}

export default function MissionsPage() {
    return (
        <Section fallback={<MissionsSkeleton />}>
            <MissionsDashboard />
        </Section>
    );
}
