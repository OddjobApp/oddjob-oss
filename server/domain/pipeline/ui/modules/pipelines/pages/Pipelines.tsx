import { useRoute } from "wouter";
import React, { lazy, Suspense } from "react";
import PipelineList from '../components/Pipelines.js';
import PipelineEditor from './PipelineEditor.js';
import { Section } from "@domain-ui/core/ui/components/shared/Section";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";

const PipelineDetail = lazy(() => import("../components/PipelineDetail"));

function PipelinesSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-9 w-40" />
            </div>
            <Skeleton className="h-[500px] rounded-lg" />
        </div>
    );
}

export default function PipelinesPage() {
    const [legacyMatch, legacyParams] = useRoute("/pipelines/:id");
    const [operationsMatch, operationsParams] = useRoute("/operations/workstreams/:id");
    const match = legacyMatch || operationsMatch;
    const params = operationsMatch ? operationsParams : legacyParams;

    if (match && params?.id) {
        if (params.id === "new") {
            return (
                <PipelineEditor
                    onSave={() => window.history.back()}
                    onCancel={() => window.history.back()}
                />
            );
        }
        return (
            <Suspense fallback={null}>
                <PipelineDetail />
            </Suspense>
        );
    }

    return (
        <Section fallback={<PipelinesSkeleton />}>
            <PipelineList />
        </Section>
    );
}
