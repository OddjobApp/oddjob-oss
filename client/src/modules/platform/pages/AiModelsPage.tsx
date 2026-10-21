import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, BrainCircuit, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { OrgModelSettings } from "@/modules/operations/components/OrgModelSettings";
import { OrgFalSettings } from "@/modules/operations/components/OrgFalSettings";

/**
 * The organization's own AI keys: chat and agent models (Gemini, Claude direct or
 * on Amazon Bedrock, OpenAI-compatible) and fal.ai media. They used to sit inside
 * the Cycles dashboard's Settings view, where nobody looked for them.
 */
export default function AiModelsPage() {
    const { data: settings, isLoading } = useQuery({
        queryKey: ["/api/org-settings"],
        queryFn: async () => (await apiRequest("GET", "/api/org-settings")).json(),
    });
    const organizationId: number | undefined = settings?.organizationId;

    return (
        <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                <div className="flex flex-col gap-3 border-b border-foreground/10 pb-5">
                    <Link href="/platform" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" /> Platform
                    </Link>
                    <div className="flex items-center gap-3">
                        <BrainCircuit className="h-6 w-6 text-primary" />
                        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">AI Models</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Connect your organization's own AI provider keys. All AI work runs on these keys; nothing is billed to the platform.
                    </p>
                </div>
                {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
                {!isLoading && !organizationId && (
                    <p className="text-sm text-muted-foreground">Select an organization to manage its AI keys.</p>
                )}
                {organizationId && <OrgModelSettings key={organizationId} organizationId={organizationId} />}
                {organizationId && <OrgFalSettings key={`fal-${organizationId}`} organizationId={organizationId} />}
            </div>
        </div>
    );
}
