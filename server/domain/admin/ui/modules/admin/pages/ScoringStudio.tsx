
import React, { lazy, Suspense } from "react";
import { Activity, Brain, Layers, Users, Key } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { ScoringOutcomeView } from './ScoringOutcomeView.js';
import { InterventionsManager } from './components/InterventionsManager.js';
import { ScoringTemplateManager } from './components/ScoringTemplateManager.js';
import { LiveSessionView } from './components/LiveSessionView.js';

const EnhancedScoringDashboard  = lazy(() => import("./EnhancedScoringDashboard"));
const AdvancedInterventionManager = lazy(() => import("./AdvancedInterventionManager"));
const AgentBrainPanelLazy        = lazy(() =>
    import("./AgentBrainPanel").then(m => ({ default: m.AgentBrainPanel }))
);
const BIVectorModelsPanel = lazy(() => import("./components/BIVectorModelsPanel"));
const BILiveScoresPanel = lazy(() => import("./components/BILiveScoresPanel"));
const BIApiKeysPanel = lazy(() => import("./components/BIApiKeysPanel"));

export default function ScoringStudio() {
    return (
        <div className="container mx-auto py-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 id="scoring-title" data-intent-id="scoring-title" className="text-3xl font-bold cursor-pointer hover:text-primary transition-colors">Scoring Studio</h1>
                    <p className="text-muted-foreground">Manage scoring rules, behavioral outcomes, vector models, and user interventions.</p>
                </div>
            </div>

            <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="bg-muted/50 flex-wrap">
                    <TabsTrigger value="dashboard" className="px-6">Enhanced Dashboard</TabsTrigger>
                    <TabsTrigger value="models" className="px-6 flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        Vector Models
                    </TabsTrigger>
                    <TabsTrigger value="scores" className="px-6 flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Live Scores
                    </TabsTrigger>
                    <TabsTrigger value="outcomes" className="px-6">Outcomes & Signals</TabsTrigger>
                    <TabsTrigger value="interventions" className="px-6">Advanced Interventions</TabsTrigger>
                    <TabsTrigger value="registry" className="px-6">Global Registry</TabsTrigger>
                    <TabsTrigger value="templates" className="px-6">Rule Templates</TabsTrigger>
                    <TabsTrigger value="debugger" className="px-6 flex items-center gap-2">
                        <Activity className="h-4 w-4" />
                        Live Debugger
                    </TabsTrigger>
                    <TabsTrigger value="agent" className="px-6 flex items-center gap-2">
                        <Brain className="h-4 w-4" />
                        Agent Brain
                    </TabsTrigger>
                    <TabsTrigger value="sdk" className="px-6 flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        SDK & Keys
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="mt-6">
                    <Suspense fallback={<div className="text-center py-6">Loading enhanced dashboard...</div>}>
                        <EnhancedScoringDashboard />
                    </Suspense>
                </TabsContent>

                <TabsContent value="models" className="mt-6">
                    <Suspense fallback={<div className="text-center py-6">Loading vector models...</div>}>
                        <BIVectorModelsPanel />
                    </Suspense>
                </TabsContent>

                <TabsContent value="scores" className="mt-6">
                    <Suspense fallback={<div className="text-center py-6">Loading live scores...</div>}>
                        <BILiveScoresPanel />
                    </Suspense>
                </TabsContent>

                <TabsContent value="outcomes" className="mt-6">
                    <ScoringOutcomeView />
                </TabsContent>

                <TabsContent value="interventions" className="mt-6">
                    <Suspense fallback={<div className="text-center py-6">Loading advanced interventions...</div>}>
                        <AdvancedInterventionManager />
                    </Suspense>
                </TabsContent>

                <TabsContent value="registry" className="mt-6">
                    <div className="bg-card border rounded-lg p-6">
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold">Global Intervention Registry</h3>
                            <p className="text-sm text-muted-foreground">Manage reusable interventions that can be triggered by any outcome.</p>
                        </div>
                        <InterventionsManager />
                    </div>
                </TabsContent>

                <TabsContent value="templates" className="mt-6">
                    <div className="bg-card border rounded-lg p-6">
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold">Scoring Rule Templates</h3>
                            <p className="text-sm text-muted-foreground">Standardize scoring logic with reusable templates for common patterns.</p>
                        </div>
                        <ScoringTemplateManager />
                    </div>
                </TabsContent>

                <TabsContent value="debugger" className="mt-6">
                    <LiveSessionView />
                </TabsContent>

                <TabsContent value="agent" className="mt-6">
                    <Suspense fallback={<div className="text-center py-6 text-muted-foreground text-sm">Loading agent brain...</div>}>
                        <AgentBrainPanelLazy />
                    </Suspense>
                </TabsContent>

                <TabsContent value="sdk" className="mt-6">
                    <Suspense fallback={<div className="text-center py-6">Loading SDK management...</div>}>
                        <BIApiKeysPanel />
                    </Suspense>
                </TabsContent>
            </Tabs>
        </div>
    );
}
